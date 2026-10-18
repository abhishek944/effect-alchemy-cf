/**
 * Typed server-side client for the owner catalog `/files/*` routes.
 *
 * Only Worker code uses this; it carries the catalog stub, not any browser
 * identity. Any transport error, non-decoding response or unavailable binding
 * throws, so callers fail closed instead of assuming a successful write.
 */
import type * as cf from "@cloudflare/workers-types";
import { Option, Schema } from "effect";
import { FileDescriptor } from "./chat-attachment-schema.ts";
import { ChatFilesFailure, type ChatFilesResult } from "./chat-files-model.ts";
import type {
  ChatFilesAbort,
  ChatFilesCommit,
  ChatFilesPrepare,
  ChatFilesPrepareResult,
  ChatFilesRelease,
  ChatFilesRemove,
  ChatFilesRemoveResult,
  ChatFilesReserve,
  ChatFilesReserveResult,
  ChatFilesStaged,
  ChatFilesSweep,
  ChatFilesUsageView,
} from "./chat-files-ops.ts";
import type { ChatFilesSweepReport } from "./chat-files-model.ts";
import { chatFilesObjectScope } from "./chat-files-store.ts";

export class ChatFilesCatalogUnavailable extends Error {
  constructor() {
    super("The owner file catalog is unavailable.");
    this.name = "ChatFilesCatalogUnavailable";
  }
}

const ReserveValue = Schema.Struct({
  status: Schema.Literals(["reserved", "existing"]),
  file: FileDescriptor,
});
const PrepareValue = Schema.Struct({
  files: Schema.Array(FileDescriptor),
  digests: Schema.Array(Schema.String),
  byteSize: Schema.Number,
  hasImage: Schema.Boolean,
});
const CommitValue = Schema.Struct({ files: Schema.Array(FileDescriptor) });
const ListValue = Schema.Struct({ files: Schema.Array(FileDescriptor) });
const UsageValue = Schema.Struct({
  retainedBytes: Schema.Number,
  stagedBytes: Schema.Number,
  reservedBytes: Schema.Number,
  pendingBytes: Schema.Number,
  usedBytes: Schema.Number,
  quotaBytes: Schema.Number,
});
const ReleaseValue = Schema.Struct({ released: Schema.Number });
const RemoveValue = Schema.Struct({
  result: Schema.Literals(["removed", "in_use", "not_found"]),
});
const SweepValue = Schema.Struct({
  deleted: Schema.Number,
  promoted: Schema.Number,
  failed: Schema.Number,
  deferred: Schema.Number,
  retainedBytes: Schema.Number,
  stagedBytes: Schema.Number,
  pendingBytes: Schema.Number,
});

const FailureEnvelope = Schema.Struct({ ok: Schema.Literal(false), code: ChatFilesFailure });

/**
 * Reads the shared `{ ok: true, value } | { ok: false, code }` envelope. The
 * outer shape is checked structurally so the value schema keeps its own type.
 */
const decodeEnvelope = <S extends Schema.ConstraintDecoder<unknown>>(
  value: S,
  raw: unknown,
): ChatFilesResult<S["Type"]> => {
  if (typeof raw !== "object" || raw === null) throw new ChatFilesCatalogUnavailable();
  if (Reflect.get(raw, "ok") === false) {
    const failure = Option.getOrNull(Schema.decodeUnknownOption(FailureEnvelope)(raw));
    if (failure === null) throw new ChatFilesCatalogUnavailable();
    return { ok: false, code: failure.code };
  }
  const decoded = Option.getOrNull(Schema.decodeUnknownOption(value)(Reflect.get(raw, "value")));
  if (decoded === null) throw new ChatFilesCatalogUnavailable();
  return { ok: true, value: decoded };
};

const request = async <S extends Schema.ConstraintDecoder<unknown>>(
  stub: cf.DurableObjectStub,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  value: S,
): Promise<ChatFilesResult<S["Type"]>> => {
  let raw: unknown = null;
  try {
    const response = await stub.fetch(`https://chat.internal${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    raw = await response.json();
  } catch {
    throw new ChatFilesCatalogUnavailable();
  }
  return decodeEnvelope(value, raw);
};

export type ChatFilesCatalogClient = {
  readonly scope: string;
  readonly reserve: (input: ChatFilesReserve) => Promise<ChatFilesResult<ChatFilesReserveResult>>;
  readonly staged: (input: ChatFilesStaged) => Promise<ChatFilesResult<FileDescriptor>>;
  readonly abort: (input: ChatFilesAbort) => Promise<ChatFilesResult<{ released: number }>>;
  readonly prepare: (input: ChatFilesPrepare) => Promise<ChatFilesResult<ChatFilesPrepareResult>>;
  readonly commit: (
    input: ChatFilesCommit,
  ) => Promise<ChatFilesResult<{ files: readonly FileDescriptor[] }>>;
  readonly release: (input: ChatFilesRelease) => Promise<ChatFilesResult<{ released: number }>>;
  readonly remove: (input: ChatFilesRemove) => Promise<ChatFilesResult<ChatFilesRemoveResult>>;
  readonly get: (chatId: string, fileId: string) => Promise<ChatFilesResult<FileDescriptor>>;
  readonly list: (chatId: string) => Promise<ChatFilesResult<readonly FileDescriptor[]>>;
  readonly usage: () => Promise<ChatFilesResult<ChatFilesUsageView>>;
  readonly sweep: (input: ChatFilesSweep) => Promise<ChatFilesResult<ChatFilesSweepReport>>;
};

const query = (value: Record<string, string>): string =>
  Object.entries(value)
    .map(([key, entry]) => `${key}=${encodeURIComponent(entry)}`)
    .join("&");

/** Binds every method to one owner catalog stub and exposes its key scope. */
export const createChatFilesCatalogClient = (
  stub: cf.DurableObjectStub,
): ChatFilesCatalogClient => ({
  scope: chatFilesObjectScope(stub),
  reserve: (input) => request(stub, "POST", "/files/reserve", input, ReserveValue),
  staged: (input) => request(stub, "POST", "/files/staged", input, FileDescriptor),
  abort: (input) => request(stub, "POST", "/files/abort", input, ReleaseValue),
  prepare: (input) => request(stub, "POST", "/files/prepare", input, PrepareValue),
  commit: (input) => request(stub, "POST", "/files/commit", input, CommitValue),
  release: (input) => request(stub, "POST", "/files/release", input, ReleaseValue),
  remove: (input) =>
    request(stub, "POST", "/files/remove", input, RemoveValue).then((result) =>
      result.ok ? { ok: true as const, value: result.value.result } : result,
    ),
  get: (chatId, fileId) =>
    request(stub, "GET", `/files/get?${query({ chatId, fileId })}`, undefined, FileDescriptor),
  list: (chatId) =>
    request(stub, "GET", `/files/list?${query({ chatId })}`, undefined, ListValue).then((result) =>
      result.ok ? { ok: true as const, value: result.value.files } : result,
    ),
  usage: () => request(stub, "GET", "/files/usage", undefined, UsageValue),
  sweep: (input) => request(stub, "POST", "/files/sweep", input, SweepValue),
});
