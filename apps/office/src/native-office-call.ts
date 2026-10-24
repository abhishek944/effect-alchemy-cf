import { Cause, Effect, Exit } from "effect";
import { reportFailure } from "@starter/diagnostics";
import {
  OfficeForbidden,
  decodeWireSync,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";
import { HostOffice, type HostOfficeRequest } from "@starter/office-server/native-remote";
import type { Actor, OfficeService } from "@starter/office-server/ports";
import type { OfficeRemoteMethod } from "./native-channel.ts";
import { officeChannelError } from "./native-channel-errors.ts";

function answerCall<Q, A>(
  definition: OfficeRemoteMethod<Q, A>,
  task: Effect.Effect<A, OfficeError>,
  callId?: string,
): Effect.Effect<unknown, OfficeError> {
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(task);
    if (Exit.isSuccess(exit))
      return decodeWireSync(definition.response)({ method: definition.method, value: exit.value });
    const reason = exit.cause.reasons[0];
    // Mixed causes/defects belong to the HTTP failure owner, never a single typed facade.
    if (exit.cause.reasons.length !== 1 || reason === undefined || !Cause.isFailReason(reason))
      return yield* Effect.failCause(exit.cause);
    const error = reason.error;
    yield* Effect.sync(() =>
      reportFailure(exit.cause, {
        component: "office.node",
        operation: "control-call",
        callId,
        operationId: error.operationId ?? undefined,
      }),
    );
    return decodeWireSync(definition.response)({
      method: definition.method,
      error: safeFailure(officeChannelError(error).code, error.operationId),
    });
  });
}
/** Explicit application methods, NOT property/method RPC; actor is NEVER decoded from the message. */
export function invokeOfficeCall(
  service: OfficeService,
  actor: Actor,
  call: HostOfficeRequest,
  callId?: string,
) {
  const answer = <Q, A>(
    definition: OfficeRemoteMethod<Q, A>,
    task: Effect.Effect<A, OfficeError>,
  ) => answerCall(definition, task, callId);
  const forbidden = Effect.fail(new OfficeForbidden(safeFailure("FORBIDDEN")));
  switch (call.method) {
    case "office.list":
      return answer(HostOffice.list, service.list(actor, call.input.cursor));
    case "office.drafts":
      return answer(HostOffice.drafts, service.drafts(actor, call.input.cursor));
    case "office.document":
      return answer(HostOffice.document, service.document(actor, call.input.id));
    case "office.draft":
      return answer(HostOffice.draft, service.draft(actor, call.input.id));
    case "office.create":
      return answer(HostOffice.create, service.create(actor, call.input));
    case "office.create-draft":
      return answer(HostOffice.createDraft, service.createDraft(actor, call.input));
    case "office.open":
      return answer(HostOffice.open, service.open(actor, call.input));
    case "office.editor":
      return answer(
        HostOffice.editor,
        actor.capability === "human" ? service.editor(actor, call.input) : forbidden,
      );
    case "office.execute":
      return answer(HostOffice.execute, service.execute(actor, call.input));
    case "office.import-into":
      return answer(HostOffice.importInto, service.importInto(actor, call.input));
    case "office.inspect":
      return answer(HostOffice.inspect, service.inspect(actor, call.input));
    case "office.render":
      return answer(HostOffice.render, service.render(actor, call.input));
    case "office.export":
      return answer(HostOffice.export, service.export(actor, call.input));
    case "office.ready":
      return answer(HostOffice.ready, service.ready(actor, call.input));
    case "office.review":
      return answer(
        HostOffice.review,
        service.review(actor, call.input.reviewId, call.input.cursor),
      );
    case "office.approve":
      return answer(
        HostOffice.approve,
        actor.capability === "human" ? service.approve(actor, call.input) : forbidden,
      );
    case "office.merge":
      return answer(
        HostOffice.merge,
        actor.capability !== "draft-task" ? service.merge(actor, call.input) : forbidden,
      );
    case "office.reopen":
      return answer(HostOffice.reopen, service.reopen(actor, call.input));
    case "office.discard":
      return answer(HostOffice.discard, service.discard(actor, call.input));
    case "office.receipt":
      return answer(HostOffice.receipt, service.receipt(actor, call.input.operationId));
    case "office.cancel":
      return answer(HostOffice.cancel, service.cancel(actor, call.input.operationId));
    case "office.events":
      return answer(
        HostOffice.events,
        service.events(actor, call.input.documentId, call.input.after),
      );
  }
  return forbidden;
}
