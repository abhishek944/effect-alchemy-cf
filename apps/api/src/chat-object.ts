import { KeyValueStore, SqlClient } from "@highchat/platform";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Per-object identity, the only Durable Object member the chat code used. */
export interface ChatObjectId {
  readonly name: string;
  toString(): string;
}

/** Durable-Object-shaped storage: one SQLite database plus a key/value table. */
export interface ChatObjectStorage {
  readonly sql: SqlClient;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  transactionSync<T>(fn: () => T): T;
}

export interface ChatObjectContext {
  readonly id: ChatObjectId;
  readonly storage: ChatObjectStorage;
  waitUntil(work: Promise<unknown>): void;
}

export interface ChatObjectStub {
  /** Opaque, restart-stable owner scope; equal to the object's own id. */
  readonly id: ChatObjectId;
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

const storageFor = (sql: SqlClient): ChatObjectStorage => {
  const values = new KeyValueStore(sql);
  return {
    sql,
    get: (key) => values.get(key),
    put: (key, value) => values.put(key, value),
    delete: (key) => values.delete(key),
    transactionSync: (fn) => sql.transactionSync(fn),
  };
};

/**
 * The chat object base. Only `onRequest` ever existed on these classes, so the
 * Node runtime owns the HTTP entry and the hourly sweeps without an agent
 * runtime, alarms or WebSockets.
 */
export abstract class ChatObject<Env> {
  protected readonly ctx: ChatObjectContext;
  protected readonly env: Env;
  readonly #timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(ctx: ChatObjectContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  abstract onRequest(request: Request): Promise<Response>;

  fetch(request: Request): Promise<Response> {
    return this.onRequest(request);
  }

  /** Hourly catalog sweeps, previously Durable Object alarms. */
  async scheduleEvery(seconds: number, method: string): Promise<void> {
    if (this.#timers.has(method)) return;
    const run = () => {
      const work: unknown = Reflect.get(this, method);
      if (typeof work !== "function") return;
      void Promise.resolve(Reflect.apply(work, this, [])).catch(() => undefined);
    };
    const timer = setInterval(run, seconds * 1000);
    // A sweep must never keep the process alive on its own.
    timer.unref();
    this.#timers.set(method, timer);
  }

  close(): void {
    for (const timer of this.#timers.values()) clearInterval(timer);
    this.#timers.clear();
  }
}

const keyHash = (name: string): string => createHash("sha256").update(name).digest("hex");

/**
 * One object instance per key, plus a promise chain per key. That chain is the
 * local replacement for the Durable Object single-writer guarantee: requests
 * for one chat serialize, requests for different chats run concurrently.
 */
export class ChatObjectRegistry<Env> {
  readonly #env: Env;
  readonly #root: string;
  readonly #create: (ctx: ChatObjectContext, env: Env) => ChatObject<Env>;
  readonly #instances = new Map<string, ChatObject<Env>>();
  readonly #queues = new Map<string, Promise<void>>();

  constructor(input: {
    readonly root: string;
    readonly env: Env;
    readonly create: (ctx: ChatObjectContext, env: Env) => ChatObject<Env>;
  }) {
    this.#root = input.root;
    this.#env = input.env;
    this.#create = input.create;
  }

  #instance(name: string): ChatObject<Env> {
    const existing = this.#instances.get(name);
    if (existing !== undefined) return existing;
    const directory = join(this.#root, "chat");
    mkdirSync(directory, { recursive: true });
    const sql = new SqlClient(join(directory, `${keyHash(name)}.sqlite`));
    const object = this.#create(
      {
        id: { name, toString: () => name },
        storage: storageFor(sql),
        waitUntil: (work) => void work.catch(() => undefined),
      },
      this.#env,
    );
    this.#instances.set(name, object);
    return object;
  }

  #serialize<T>(name: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(name) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(name, settled);
    void settled.then(() =>
      this.#queues.get(name) === settled ? this.#queues.delete(name) : false,
    );
    return next;
  }

  stub(name: string): ChatObjectStub {
    const object = this.#instance(name);
    return {
      id: { name, toString: () => name },
      fetch: (input, init) =>
        this.#serialize(name, async () => object.fetch(new Request(input, init))),
    };
  }

  close(): void {
    for (const object of this.#instances.values()) object.close();
    this.#instances.clear();
  }
}
