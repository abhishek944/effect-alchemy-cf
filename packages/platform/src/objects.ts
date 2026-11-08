import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KeyedQueue } from "./keyed-queue.ts";
import {
  collect,
  decodeRecord,
  digest,
  httpMetadataOf,
  type PutOptions,
  type Record_,
  type StoredObject,
  type StoredObjectHead,
  type StoredObjectList,
} from "./objects-record.ts";

const encoder = new TextEncoder();

/**
 * One directory-backed object store per process. It answers the same five
 * operations the file, profile and skills code already used against R2, so
 * those call sites keep their integrity checks unchanged.
 *
 * Bytes are content-addressed (`<hash>.<etag>.bin`) and metadata is a single
 * atomically replaced `<hash>.json`. A reader therefore can never pair new
 * metadata with old bytes: the metadata names the exact byte file it describes.
 * Reads, writes and deletes of one key share a queue, so a replace that retires
 * old bytes can never make a continuously present key look absent.
 */
export class ObjectStore {
  readonly #root: string;
  readonly #queue = new KeyedQueue();
  /** Settles once the directory exists; a failure is kept for the first caller. */
  readonly #ready: Promise<void>;

  constructor(root: string) {
    this.#root = root;
    const initialised = mkdir(root, { recursive: true }).then(() => undefined);
    // This handler only prevents a process-level unhandled rejection before the
    // first operation awaits `#ready`; the original promise still rejects.
    void initialised.catch(() => undefined);
    this.#ready = initialised;
  }

  #hash(key: string): string {
    return digest(encoder.encode(key));
  }

  #metaPath(hash: string): string {
    return join(this.#root, `${hash}.json`);
  }

  #bytesPath(hash: string, etag: string): string {
    return join(this.#root, `${hash}.${etag}.bin`);
  }

  async #record(hash: string): Promise<Record_ | null> {
    try {
      return decodeRecord(await readFile(this.#metaPath(hash), "utf8"));
    } catch {
      return null;
    }
  }

  async #replace(
    key: string,
    value: Uint8Array | ReadableStream<Uint8Array> | ArrayBuffer,
    options: PutOptions | undefined,
  ): Promise<StoredObjectHead | null> {
    const hash = this.#hash(key);
    const existing = await this.#record(hash);
    // R2 conditional semantics: an existing key is a null result, never an error,
    // so a replayed create can be resolved by reading and verifying the object.
    if (existing !== null && options?.onlyIf?.etagDoesNotMatch === "*") return null;
    const bytes =
      value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : await collect(value);
    const etag = digest(bytes);
    if (options?.sha256 !== undefined && options.sha256 !== etag)
      throw new Error("Object digest does not match the supplied sha256");
    const httpMetadata = httpMetadataOf(options);
    const record: Record_ = {
      key,
      size: bytes.byteLength,
      etag,
      uploaded: new Date().toISOString(),
      storedAt: Date.now(),
      customMetadata: { ...options?.customMetadata },
      ...(httpMetadata === undefined ? {} : { httpMetadata }),
    };
    const bytesPath = this.#bytesPath(hash, etag);
    // A content-addressed name can be written through a unique temp file: two
    // writers of identical bytes converge, and no reader sees a partial file.
    const bytesTemp = `${bytesPath}.${randomUUID()}.tmp`;
    await writeFile(bytesTemp, bytes);
    await rename(bytesTemp, bytesPath);
    const metaTemp = `${this.#metaPath(hash)}.${randomUUID()}.tmp`;
    await writeFile(metaTemp, JSON.stringify(record));
    await rename(metaTemp, this.#metaPath(hash));
    if (existing !== null && existing.etag !== etag)
      await rm(this.#bytesPath(hash, existing.etag), { force: true });
    const { storedAt: _storedAt, ...head } = record;
    return head;
  }

  async #read(key: string): Promise<StoredObject | null> {
    const hash = this.#hash(key);
    const record = await this.#record(hash);
    if (record === null) return null;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(this.#bytesPath(hash, record.etag)));
    } catch {
      return null;
    }
    const { storedAt: _storedAt, ...head } = record;
    return {
      ...head,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- owned whole-file bytes
      body: new Blob([bytes.buffer as ArrayBuffer]).stream(),
      bytes: async () => bytes,
      text: async () => new TextDecoder().decode(bytes),
    };
  }

  async put(
    key: string,
    value: Uint8Array | ReadableStream<Uint8Array> | ArrayBuffer,
    options?: PutOptions,
  ): Promise<StoredObjectHead | null> {
    await this.#ready;
    return this.#queue.run(key, () => this.#replace(key, value, options));
  }

  async head(key: string): Promise<StoredObjectHead | null> {
    await this.#ready;
    const record = await this.#record(this.#hash(key));
    if (record === null) return null;
    const { storedAt: _storedAt, ...head } = record;
    return head;
  }

  async get(key: string): Promise<StoredObject | null> {
    await this.#ready;
    return this.#queue.run(key, () => this.#read(key));
  }

  async delete(keys: readonly string[]): Promise<void> {
    await this.#ready;
    for (const key of keys) {
      await this.#queue.run(key, async () => {
        const hash = this.#hash(key);
        const record = await this.#record(hash);
        await rm(this.#metaPath(hash), { force: true });
        if (record !== null) await rm(this.#bytesPath(hash, record.etag), { force: true });
      });
    }
  }

  async list(options: {
    readonly prefix?: string;
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<StoredObjectList> {
    await this.#ready;
    const prefix = options.prefix ?? "";
    const limit = options.limit ?? 1000;
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch {
      return { objects: [], truncated: false };
    }
    const heads: StoredObjectHead[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const record = await readFile(join(this.#root, name), "utf8")
        .then((raw) => decodeRecord(raw))
        .catch(() => null);
      if (record === null || !record.key.startsWith(prefix)) continue;
      if (options.cursor !== undefined && record.key <= options.cursor) continue;
      const { storedAt: _storedAt, ...head } = record;
      heads.push(head);
    }
    heads.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    const page = heads.slice(0, limit);
    const last = page.at(-1);
    return {
      objects: page,
      truncated: heads.length > page.length,
      ...(heads.length > page.length && last !== undefined ? { cursor: last.key } : {}),
    };
  }
}
