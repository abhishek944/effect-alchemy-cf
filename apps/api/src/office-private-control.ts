import { Schema } from "effect";
import { OfficeErrors, decodeWireSync, safeFailure } from "@starter/office-contract";
import { hostEnvelope } from "@starter/office-server/native-remote";
import {
  OfficePrivateCall,
  OfficePrivateReply,
  type OfficePrivateBackend,
} from "./office-private-backend.ts";
import { officeDenied } from "./office-private-authority.ts";
import type { OfficeHostFrame } from "./office-host-frame.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import { officePrivateResponse } from "./office-private-response.ts";

const Envelope = hostEnvelope(OfficePrivateCall);
const Errors = Schema.Union(OfficeErrors);
/** Invoked ONLY after original private process association and frame selection. */
export async function officePrivateControl(
  body: ReadableStream<Uint8Array> | null,
  frame: OfficeHostFrame,
  backend: OfficePrivateBackend,
  role: "control" | "manifest" | "cleanup",
  peer: () => Promise<void>,
) {
  const cleanup = role === "cleanup";
  const maximum = role === "manifest" ? 2 * 1024 * 1024 : 16 * 1024;
  const signal = cleanup ? frame.cleanup.signal : frame.work.signal;
  const deadline = cleanup ? frame.cleanupDeadline : frame.deadline;
  const envelope = decodeWireSync(Envelope)(
    await readOfficePrivateJson(body, signal, deadline, maximum, frame.request.charge),
  );
  if (envelope.invocationId !== frame.id) throw officeDenied();
  frame.request.receive(envelope.callId);
  if (envelope.payload.method === "channel.member") frame.sdkExpected = true;
  let payload: unknown;
  try {
    payload = await backend.call(envelope.payload, cleanup);
  } catch (error) {
    const failure = Schema.is(Errors)(error)
      ? safeFailure(error.code, error.operationId)
      : safeFailure("OUTCOME_UNKNOWN");
    payload = { method: envelope.payload.method, error: failure };
  }
  const value = decodeWireSync(OfficePrivateReply)(payload);
  return officePrivateResponse(
    { version: 1, invocationId: frame.id, callId: envelope.callId, payload: value },
    maximum,
    frame.io,
    signal,
    deadline,
    cleanup,
    peer,
    200,
    frame.request.charge,
  );
}
