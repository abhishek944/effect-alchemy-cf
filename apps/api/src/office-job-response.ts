import type * as cf from "@cloudflare/workers-types";
import {
  decodeWireSync,
  OfficeForbidden,
  OfficeUnavailable,
  safeFailure,
} from "@starter/office-contract";
import { withCause, withDiagnostic, type FailureContext } from "@starter/diagnostics";
import { NativeJobExit } from "../../office/src/native-private-wire.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";

/** A real private upstream infrastructure response is not an authorization decision. */
export function officeJobResponseError(status: number) {
  return withDiagnostic(
    status === 403
      ? new OfficeForbidden(safeFailure("FORBIDDEN"))
      : new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")),
    "private-job-response",
  );
}

/** Already-owned cleanup observation; no authority, retry, or timeout-as-quiescence. */
export async function officeReadJobExit(
  actual: cf.DurableObjectStub,
  cancel: boolean,
  event: (phase: string, extra?: Partial<FailureContext>) => void,
) {
  const response = await actual.fetch("http://office-job.internal/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cancel }),
    redirect: "manual",
  });
  if (response.status !== 200) {
    event("upstream-response", { status: response.status, outcome: "unknown" });
    const cause = officeJobResponseError(response.status);
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw withCause(cause, cleanup);
    }
    throw cause;
  }
  const payload = await readOfficePrivateJson(
    response.body,
    new AbortController().signal,
    null,
    16 * 1024,
  );
  return decodeWireSync(NativeJobExit)(payload);
}
