import type * as cf from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { officePrivateStream } from "./office-private-stream.ts";

/** The fresh job owns stdin/stderr transfers; stdout stays streamed to its original consumer. */
export function officeJobStreams(
  process: cf.ExecProcess,
  body: ReadableStream<unknown>,
  signal: AbortSignal,
  deadline: number,
  revoke: () => void,
) {
  if (process.stdin === null || process.stdout === null || process.stderr === null)
    throw new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
  const incoming = officePrivateStream(
    body,
    64 * 1024 * 1024,
    signal,
    deadline,
    () => Promise.resolve(),
    revoke,
  );
  const stderr = officePrivateStream(
    process.stderr,
    64 * 1024,
    signal,
    deadline,
    () => Promise.resolve(),
    revoke,
  );
  return {
    input: incoming.body.pipeTo(process.stdin),
    errors: stderr.body.pipeTo(new WritableStream<Uint8Array>({ write: () => Promise.resolve() })),
    stdout: process.stdout,
  };
}
