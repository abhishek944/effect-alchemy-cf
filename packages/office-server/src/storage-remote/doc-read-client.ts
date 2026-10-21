import { decodeWireSync } from "@starter/office-contract";
import type { NativeAccess } from "../ports/index.ts";
import { isOfficeError, officeFailure } from "../core/failure.ts";
import { DOC_READ_LIMITS, DocReadRequest, DocReadResult, type DocReadBudget } from "./read-wire.ts";
import {
  NativePartRequest,
  nativeValueDigest,
  validateNativeValueRef,
  type NativeValue,
  type PublishedOrigin,
} from "./wire.ts";
import { createDocReadIo } from "./doc-read-io.ts";

export type DocReadOptions = {
  readonly access: Extract<NativeAccess, { kind: "read" }>;
  readonly revision: number;
  readonly requestId: string;
  readonly origin: string;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly expiresAt: number;
  readonly signal: AbortSignal;
  readonly policy: DocReadBudget;
};
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const parse = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
/** One private association; actual host authority/fetch are required, never inferred from claims. */
export function createDocReadClient(options: DocReadOptions) {
  let origin: URL, access: DocReadOptions["access"], policy: DocReadBudget;
  try {
    origin = new URL(options.origin);
    access = structuredClone(options.access);
    policy = Object.freeze({ ...options.policy });
  } catch {
    throw officeFailure("INVALID_INPUT");
  }
  const { requestId, revision, expiresAt, signal } = options;
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    (options.origin !== origin.origin && options.origin !== `${origin.origin}/`) ||
    typeof options.fetch !== "function" ||
    !positive(revision) ||
    !positive(expiresAt) ||
    expiresAt <= Date.now() ||
    !(signal instanceof AbortSignal) ||
    access?.kind !== "read" ||
    access.target?.scope?.kind !== "main" ||
    !positive(access.authorityEpoch) ||
    !positive(access.serviceEpoch) ||
    ![
      requestId,
      access.target.owner?.stage,
      access.target.owner?.ownerId,
      access.target.documentId,
      access.target.unitId,
    ].every((value) => typeof value === "string" && value.length > 0 && value.length <= 256) ||
    ![policy.maxCalls, policy.maxBytes, policy.maxValueBytes, policy.maxHistoryRevisions].every(
      positive,
    ) ||
    policy.maxValueBytes > 128 * 1024 * 1024
  )
    throw officeFailure("INVALID_INPUT");
  const headers = new Headers();
  try {
    headers.set("x-office-read-id", requestId);
  } catch {
    throw officeFailure("INVALID_INPUT");
  }
  if (headers.get("x-office-read-id") !== requestId) throw officeFailure("INVALID_INPUT");
  Object.freeze(access.target.owner);
  Object.freeze(access.target.scope);
  Object.freeze(access.target);
  Object.freeze(access);
  let calls = 0,
    bytes = 0,
    history = 0;
  const reserved = new Map<string, number>();
  const charge = (n: number) => {
    io.check();
    if (!Number.isSafeInteger(n) || n < 0 || n > policy.maxBytes - bytes)
      throw officeFailure("LIMIT_EXCEEDED");
    bytes += n;
  };
  const io = createDocReadIo({
    origin: origin.origin,
    requestId,
    fetch: options.fetch,
    expiresAt,
    signal,
    charge,
  });
  const call = async (
    path: "/native-doc/control" | "/native-doc/part",
    input: unknown,
    maximum: number,
    prepaid = 0,
  ) => {
    io.check();
    if (!prepaid) {
      if (calls >= policy.maxCalls) throw officeFailure("LIMIT_EXCEEDED");
      calls++;
    }
    const body = await io.request(path, JSON.stringify(input), maximum, prepaid);
    io.check();
    return body;
  };
  return {
    access,
    revision,
    policy,
    check: io.check,
    async reserveValue(source: PublishedOrigin, input: NativeValue) {
      const value = validateNativeValueRef(input);
      if (value.bytes > policy.maxValueBytes || value.parts.length > policy.maxCalls - calls)
        throw officeFailure("LIMIT_EXCEEDED");
      const digest = await nativeValueDigest(value);
      io.check();
      const requests = value.parts.map((part, index) => ({
        key: JSON.stringify(
          decodeWireSync(NativePartRequest)({ origin: source, valueDigest: digest, part: index }),
        ),
        bytes: part.bytes,
      }));
      if (requests.some((entry) => reserved.has(entry.key))) throw officeFailure("BUSY");
      if (requests.length > policy.maxCalls - calls) throw officeFailure("LIMIT_EXCEEDED");
      charge(value.bytes);
      for (const entry of requests) charge(new TextEncoder().encode(entry.key).byteLength);
      calls += requests.length;
      for (const entry of requests) reserved.set(entry.key, entry.bytes);
    },
    reserveHistory(n: number) {
      io.check();
      if (!Number.isSafeInteger(n) || n < 0 || n > policy.maxHistoryRevisions - history)
        throw officeFailure("LIMIT_EXCEEDED");
      history += n;
    },
    async control(input: DocReadRequest): Promise<DocReadResult> {
      try {
        const request = decodeWireSync(DocReadRequest)(input);
        if (
          (request.method === "snapshot" && request.revision > revision) ||
          (request.method === "history" && (request.after > revision || request.to > revision))
        )
          throw officeFailure("FORBIDDEN");
        const raw = await call("/native-doc/control", request, DOC_READ_LIMITS.metadataBytes);
        io.check();
        const result = decodeWireSync(DocReadResult)(parse(raw));
        if (result.method !== request.method) throw officeFailure("CONTENT_REQUIRED");
        io.check();
        return result;
      } catch (cause) {
        io.close();
        throw isOfficeError(cause) ? cause : officeFailure("CONTENT_REQUIRED");
      }
    },
    async part(input: NativePartRequest, expected: number) {
      try {
        io.check();
        const request = decodeWireSync(NativePartRequest)(input);
        if (
          request.origin.kind !== "snapshot" &&
          !(request.origin.kind === "changeset" && request.origin.branch === "")
        )
          throw officeFailure("FORBIDDEN");
        if (request.origin.revision > revision) throw officeFailure("FORBIDDEN");
        const key = JSON.stringify(request);
        if (
          !positive(expected) ||
          expected > DOC_READ_LIMITS.pieceBytes ||
          reserved.get(key) !== expected
        )
          throw officeFailure("LIMIT_EXCEEDED");
        reserved.delete(key);
        const value = await call("/native-doc/part", request, expected, expected);
        io.check();
        return value;
      } catch (cause) {
        io.close();
        throw isOfficeError(cause) ? cause : officeFailure("CONTENT_REQUIRED");
      }
    },
    async dispose() {
      io.close();
      reserved.clear();
      await io.dispose();
    },
  };
}
export type DocReadClient = ReturnType<typeof createDocReadClient>;
