import { Cause, Effect, Schema } from "effect";
import type { OfficeError } from "@starter/office-contract";
import {
  Failure,
  OfficeOriginalRequest,
  OfficeOriginalTarget,
  OfficeSourcePage,
  OfficeSourceRequest,
  type OfficeSourceReadRequest,
  decodeWireSync,
} from "@starter/office-contract";
import { reportedFailure, reportEventEffect, requestDiagnosticContext } from "@starter/diagnostics";
import { reportOfficeHttpFailure } from "./office-http-failure.ts";
import { CurrentOfficeSession } from "./office-authentication.ts";
import { officeHostFetch, officeInvocation, type OfficeDispatch } from "./office-http-call.ts";
import {
  invalid,
  officeFailure,
  officeJson,
  officeInvalid,
  readBounded,
  unavailable,
} from "./office-http-model.ts";

/** Finite owner-read transport behind the same real session and private sources audience. */
const sourceReply = (dispatch: OfficeDispatch, input: typeof OfficeSourceReadRequest.Type) =>
  Effect.gen(function* () {
    const session = yield* CurrentOfficeSession;
    const invocationId = yield* officeInvocation(dispatch);
    yield* reportEventEffect({
      ...(yield* requestDiagnosticContext),
      component: "office.http",
      operation: "fileRef" in input ? "office.original" : "office.sources",
      event: "application.phase",
      phase: "host-dispatch",
      eventId: invocationId,
    });
    const response = yield* officeHostFetch(dispatch, session, `/sources/${invocationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    // Join the bounded body even for errors; local transport/body/decode failures remain reportable.
    const bytes = yield* readBounded(response, 12 * 1024);
    const body = yield* Effect.try({
      try: (): unknown =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
      catch: unavailable,
    });
    if (response.status !== 200) {
      const error = unavailable();
      // Only this validated private Root facade has an existing downstream report owner.
      const reported =
        response.status === 503 && Schema.is(Failure)(body) && body.code === "OUTCOME_UNKNOWN";
      return yield* Effect.fail(reported ? reportedFailure(error) : error);
    }
    return body;
  });

/** Final public handling owner: retain interruption and report local faults before projection. */
const sourceFailure = (operation: string) => (cause: Cause.Cause<OfficeError>) => {
  if (Cause.hasInterruptsOnly(cause))
    return Effect.failCause(
      Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)),
    );
  const reason = cause.reasons[0];
  const error =
    cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason)
      ? reason.error
      : unavailable(cause);
  return reportOfficeHttpFailure(cause, operation).pipe(Effect.as(officeFailure(error)));
};

export function officeSources(
  dispatch: OfficeDispatch,
  documentId: string,
  query: URLSearchParams,
) {
  return Effect.gen(function* () {
    for (const key of query.keys())
      if (key !== "cursor" || query.getAll(key).length !== 1) return officeInvalid();
    const input = yield* Effect.try({
      try: () => decodeWireSync(OfficeSourceRequest)({ documentId, cursor: query.get("cursor") }),
      catch: invalid,
    });
    const body = yield* sourceReply(dispatch, input);
    const value = yield* Effect.try({
      try: () => decodeWireSync(OfficeSourcePage)(body),
      catch: unavailable,
    });
    return officeJson(value);
  }).pipe(Effect.catchCause(sourceFailure("sources")));
}

/** Content Target discovery, not an original import-control receipt or a native grant. */
export function officeOriginalSource(
  dispatch: OfficeDispatch,
  fileRef: string,
  query: URLSearchParams,
) {
  return Effect.gen(function* () {
    for (const key of query.keys())
      if (key !== "chatId" || query.getAll(key).length !== 1) return officeInvalid();
    const input = yield* Effect.try({
      try: () => decodeWireSync(OfficeOriginalRequest)({ fileRef, chatId: query.get("chatId") }),
      catch: invalid,
    });
    const body = yield* sourceReply(dispatch, input);
    const value = yield* Effect.try({
      try: () => decodeWireSync(OfficeOriginalTarget)(body),
      catch: unavailable,
    });
    return officeJson(value);
  }).pipe(Effect.catchCause(sourceFailure("original")));
}
