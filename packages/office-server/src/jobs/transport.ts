import { decodeWireSync, OfficeInvalid, safeFailure } from "@starter/office-contract";
import type { IsolatedJob } from "../ports/jobs.ts";
import { IsolatedJobSchema } from "./schemas.ts";
import { digestBytes } from "./frames.ts";

const magic = new Uint8Array([79, 74, 79, 66]);
export const JOB_TRANSPORT_MAX = 34 * 1024 * 1024;
export type JobRequest = {
  readonly job: IsolatedJob;
  readonly input: Uint8Array;
  readonly code: Uint8Array;
};
/** Private fixed-entrypoint transport only; metadata remains the existing finite IsolatedJob. */
export function encodeJobRequest(request: JobRequest): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify(decodeWireSync(IsolatedJobSchema)(request.job)),
  );
  if (
    header.byteLength > 16 * 1024 ||
    request.input.byteLength > 32 * 1024 * 1024 ||
    request.code.byteLength > 32 * 1024
  )
    throw new OfficeInvalid(safeFailure("LIMIT_EXCEEDED"));
  const bytes = new Uint8Array(
    16 + header.byteLength + request.input.byteLength + request.code.byteLength,
  );
  bytes.set(magic);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, header.byteLength);
  view.setUint32(8, request.input.byteLength);
  view.setUint32(12, request.code.byteLength);
  bytes.set(header, 16);
  bytes.set(request.input, 16 + header.byteLength);
  bytes.set(request.code, 16 + header.byteLength + request.input.byteLength);
  return bytes;
}
export function decodeJobRequest(bytes: Uint8Array): JobRequest {
  if (
    bytes.byteLength < 16 ||
    bytes.byteLength > JOB_TRANSPORT_MAX ||
    !magic.every((byte, index) => bytes[index] === byte)
  )
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = view.getUint32(4),
    input = view.getUint32(8),
    code = view.getUint32(12);
  if (
    header > 16 * 1024 ||
    input > 32 * 1024 * 1024 ||
    code > 32 * 1024 ||
    16 + header + input + code !== bytes.byteLength
  )
    throw new OfficeInvalid(safeFailure("LIMIT_EXCEEDED"));
  const job = decodeWireSync(IsolatedJobSchema)(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(16, 16 + header))),
  );
  const body = bytes.subarray(16 + header, 16 + header + input);
  const source = bytes.subarray(16 + header + input);
  if (
    body.byteLength !== job.input.bytes ||
    digestBytes(body) !== job.input.digest ||
    (job.kind === "execute"
      ? source.byteLength !== job.code.bytes ||
        digestBytes(source) !== job.code.digest ||
        job.code.digest !== job.binding.codeDigest
      : source.byteLength !== 0)
  )
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  return { job, input: body, code: source };
}
