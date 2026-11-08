import { createHash } from "node:crypto";
import { Schema } from "effect";

/** The R2 metadata subset this application actually reads and writes. */
export interface ObjectMetadata {
  readonly contentType?: string;
  readonly cacheControl?: string;
  readonly contentEncoding?: string;
  readonly contentDisposition?: string;
  readonly contentLanguage?: string;
}

export interface StoredObjectHead {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly uploaded: string;
  readonly httpMetadata?: ObjectMetadata;
  readonly customMetadata: Record<string, string>;
}

export interface StoredObject extends StoredObjectHead {
  readonly body: ReadableStream<Uint8Array>;
  /** Always absent: a whole-object read has no range. Present for shape parity. */
  readonly range?: { readonly offset: number; readonly length: number };
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

export interface StoredObjectList {
  readonly objects: readonly StoredObjectHead[];
  readonly truncated: boolean;
  readonly cursor?: string;
}

export interface PutOptions {
  readonly httpMetadata?: ObjectMetadata;
  readonly customMetadata?: Record<string, string>;
  /** Verified against the stored bytes; a mismatch never commits. */
  readonly sha256?: string;
  /** Create-only precondition: an existing key is a conflict, never a rewrite. */
  readonly onlyIf?: { readonly etagDoesNotMatch?: string };
}

/** The on-disk sidecar: a head plus the local write ordering marker. */
export interface Record_ extends StoredObjectHead {
  readonly storedAt: number;
}

const HttpMetadata = Schema.Record(Schema.String, Schema.String);

const StoredRecord = Schema.Struct({
  key: Schema.String,
  size: Schema.Number,
  etag: Schema.String,
  uploaded: Schema.String,
  storedAt: Schema.Number,
  httpMetadata: Schema.optionalKey(HttpMetadata),
  customMetadata: HttpMetadata,
});

/** A torn or foreign sidecar is never a listable object. */
export const decodeRecord = (raw: string): Record_ | null => {
  try {
    return Schema.decodeUnknownSync(StoredRecord)(JSON.parse(raw));
  } catch {
    return null;
  }
};

/** The R2 metadata subset actually written, without undefined entries. */
export const httpMetadataOf = (options: PutOptions | undefined): ObjectMetadata | undefined => {
  const metadata = options?.httpMetadata;
  if (metadata === undefined) return undefined;
  const kept = Object.entries(metadata).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return Object.fromEntries(kept);
};

export const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const collect = async (body: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};
