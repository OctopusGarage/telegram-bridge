import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { appStateFile } from "./state-dir.js";

export type QueuedMessage = {
  id: string;
  text: string;
  chatId: string | number;
  sessionName: string;
  action: string;
  resolve: (output: string) => void;
  reject: (err: Error) => void;
  notify?: ((text: string) => void) | undefined;
};

export type PersistedMessage = {
  id: string;
  text: string;
  chatId: string | number;
  sessionName: string;
  action: string;
};

export type QueueHandler = (msg: QueuedMessage) => Promise<void>;

export function newMessageId(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export class MessageQueue {
  private readonly sessionQueues = new Map<string, QueuedMessage[]>();
  private readonly processingSessions = new Set<string>();
  private handler: QueueHandler | undefined;
  private readonly maxSize: number;
  private readonly maxConcurrentSessions: number;
  private readonly currentMessage = new Map<string, QueuedMessage>();
  private readonly persistPath: string;
  private readonly legacyPersistPath: string;
  private persistScheduled = false;

  constructor(maxSize = 30, persistPath = appStateFile(".queue/pending.json"), maxConcurrentSessions = Infinity) {
    this.maxSize = maxSize;
    this.maxConcurrentSessions = maxConcurrentSessions;
    this.persistPath = persistPath;
    this.legacyPersistPath = nodePath.join(process.cwd(), ".queue", "pending.json");
    this.ensurePersistDir();
  }

  private ensurePersistDir(): void {
    const dir = nodePath.dirname(this.persistPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // best-effort
    }
  }

  private getQueue(sessionName: string, create = true): QueuedMessage[] | undefined {
    const queue = this.sessionQueues.get(sessionName);
    if (!queue && create) {
      const newQueue: QueuedMessage[] = [];
      this.sessionQueues.set(sessionName, newQueue);
      return newQueue;
    }
    return queue;
  }

  private ensureQueue(sessionName: string): QueuedMessage[] {
    const queue = this.getQueue(sessionName, true);
    if (!queue) {
      throw new Error(`Failed to create queue for session: ${sessionName}`);
    }
    return queue;
  }

  private purgeEmptyQueue(sessionName: string): void {
    const queue = this.getQueue(sessionName, false);
    if (queue && queue.length === 0 && !this.processingSessions.has(sessionName)) {
      this.sessionQueues.delete(sessionName);
    }
  }

  size(sessionName?: string): number {
    if (sessionName) {
      return this.getQueue(sessionName, false)?.length ?? 0;
    }

    let total = 0;
    for (const q of this.sessionQueues.values()) {
      total += q.length;
    }
    return total;
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  private persist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    setTimeout(() => {
      if (!this.persistScheduled) return;
      this.persistScheduled = false;
      this.writePersistedNow();
    }, 0);
  }

  flushPending(): void {
    if (!this.persistScheduled) return;
    this.persistScheduled = false;
    this.writePersistedNow();
  }

  private writePersistedNow(): void {
    const messages: PersistedMessage[] = [];
    const sessionNames = new Set<string>([
      ...this.sessionQueues.keys(),
      ...this.currentMessage.keys(),
    ]);
    const seenIds = new Set<string>();

    const appendPersisted = (sessionName: string, msg: QueuedMessage): void => {
      if (seenIds.has(msg.id)) return;
      seenIds.add(msg.id);
      messages.push({
        id: msg.id,
        text: msg.text,
        chatId: msg.chatId,
        sessionName,
        action: msg.action,
      });
    };

    for (const sessionName of sessionNames) {
      const current = this.currentMessage.get(sessionName);
      if (current) {
        appendPersisted(sessionName, current);
      }

      const queue = this.sessionQueues.get(sessionName);
      if (!queue) continue;
      for (const msg of queue) {
        appendPersisted(sessionName, msg);
      }
    }

    try {
      fs.writeFileSync(this.persistPath, JSON.stringify(messages, null, 2), "utf-8");
    } catch {
      // best-effort
    }
  }

  clearPersisted(): void {
    const clearTargets = new Set([this.persistPath, this.legacyPersistPath]);
    for (const target of clearTargets) {
      try {
        fs.rmSync(target, { force: true });
      } catch {
        // best-effort
      }
    }
  }

  private parsePersisted(raw: string): PersistedMessage[] {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is PersistedMessage => {
      if (item === null || typeof item !== "object") return false;
      return (
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.text === "string" &&
        item.text.length > 0 &&
        (typeof item.chatId === "string" || typeof item.chatId === "number") &&
        typeof item.sessionName === "string" &&
        item.sessionName.length > 0 &&
        typeof item.action === "string" &&
        item.action.length > 0
      );
    });
  }

  private readPersisted(pathValue: string): PersistedMessage[] {
    try {
      const raw = fs.readFileSync(pathValue, "utf-8");
      return this.parsePersisted(raw);
    } catch {
      return [];
    }
  }

  loadPersisted(): PersistedMessage[] {
    const primary = this.readPersisted(this.persistPath);
    if (primary.length > 0) return primary;

    try {
      fs.accessSync(this.persistPath);
    } catch {
      return this.readPersisted(this.legacyPersistPath);
    }

    return [];
  }

  setHandler(handler: QueueHandler): void {
    this.handler = handler;
  }

  private hasDuplicateText(sessionName: string, chatId: string | number, text: string): boolean {
    const sameMessage = (m: QueuedMessage | undefined): boolean =>
      m !== undefined && m.action === "command" && m.chatId === chatId && m.text === text;

    if (sameMessage(this.currentMessage.get(sessionName))) return true;

    const q = this.getQueue(sessionName, false);
    if (!q) return false;
    for (const msg of q) {
      if (sameMessage(msg)) return true;
    }

    return false;
  }

  enqueue(msg: QueuedMessage): "queued" | "duplicate" | false {
    const queue = this.ensureQueue(msg.sessionName);
    if (queue.length >= this.maxSize) {
      return false;
    }

    if (msg.action === "command" && this.hasDuplicateText(msg.sessionName, msg.chatId, msg.text)) {
      return "duplicate";
    }

    queue.push(msg);
    this.persist();
    void this.processSession(msg.sessionName);
    return "queued";
  }

  clear(): void {
    for (const msg of this.currentMessage.values()) {
      msg.reject(new Error("bot stopped"));
    }
    for (const queue of this.sessionQueues.values()) {
      for (const msg of queue) {
        msg.reject(new Error("bot stopped"));
      }
      queue.length = 0;
    }
    this.sessionQueues.clear();
    this.processingSessions.clear();
    this.currentMessage.clear();
    this.persistScheduled = false;
    this.clearPersisted();
  }

  private async runHandler(msg: QueuedMessage, sessionName: string): Promise<void> {
    if (!this.handler) {
      msg.reject(new Error("Queue handler not set"));
      return;
    }

    try {
      await this.handler(msg);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      msg.reject(err);
    } finally {
      if (this.currentMessage.get(sessionName)?.id === msg.id) {
        this.currentMessage.delete(sessionName);
      }
    }
  }

  private async processSession(sessionName: string): Promise<void> {
    if (this.processingSessions.has(sessionName)) return;
    if (this.processingSessions.size >= this.maxConcurrentSessions) {
      setTimeout(() => void this.processSession(sessionName), 1000);
      return;
    }

    const queue = this.getQueue(sessionName, false);
    if (!queue) {
      this.purgeEmptyQueue(sessionName);
      return;
    }
    if (queue.length === 0) {
      this.purgeEmptyQueue(sessionName);
      return;
    }

    const msg = queue.shift();
    if (!msg) return;

    this.processingSessions.add(sessionName);
    this.currentMessage.set(sessionName, msg);

    await this.runHandler(msg, sessionName);

    this.processingSessions.delete(sessionName);

    this.persist();
    void this.processSession(sessionName);
  }

  isSessionProcessing(sessionName: string): boolean {
    return this.processingSessions.has(sessionName);
  }

  getCurrentMessage(sessionName: string): QueuedMessage | undefined {
    return this.currentMessage.get(sessionName);
  }

  getSessionNames(): string[] {
    const names = new Set<string>();
    for (const name of this.processingSessions) {
      names.add(name);
    }
    for (const name of this.sessionQueues.keys()) {
      if (this.sessionQueues.get(name)?.length) {
        names.add(name);
      }
    }
    return [...names];
  }

  getSessionQueue(sessionName: string): readonly QueuedMessage[] {
    return [...(this.getQueue(sessionName, false) ?? [])];
  }

  clearSession(sessionName: string): void {
    const queue = this.getQueue(sessionName, false);
    if (queue) {
      while (queue.length > 0) {
        const msg = queue.shift();
        if (msg) msg.reject(new Error("Session removed, message cancelled"));
      }
      this.sessionQueues.delete(sessionName);
    }
    const inFlight = this.currentMessage.get(sessionName);
    if (inFlight) {
      inFlight.reject(new Error("Session removed, message cancelled"));
      this.currentMessage.delete(sessionName);
    }
    this.processingSessions.delete(sessionName);
    this.persist();
  }
}
