import { Clock, Effect } from "effect";
import {
  OfficeInvalid,
  OfficeUnavailable,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";
import { HostControl, HostTurn } from "@starter/office-server/native-remote";
import type {
  DocumentAuthority,
  NativeTarget,
  SerialAdmission,
  WritePermit,
} from "@starter/office-server/ports";
import type { OfficeControlSession } from "./native-channel.ts";
import { captureNativeTarget, captureWritePermit, sameNativeTarget } from "./native-target.ts";

/** T47 binds work and cleanup transports separately; neither this client nor an ID issues authority. */
export function createOfficeDocumentAuthority(
  channel: OfficeControlSession,
  cleanup: OfficeControlSession,
): DocumentAuthority {
  function serial<A, E>(
    original: NativeTarget,
    admission: SerialAdmission,
    body: (permit: WritePermit) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | OfficeError> {
    return Effect.scoped(
      Effect.gen(function* () {
        const target = yield* Effect.try({
          try: () => captureNativeTarget(original),
          catch: () => new OfficeInvalid(safeFailure("INVALID_INPUT", admission.operationId)),
        });
        const attemptId = crypto.randomUUID();
        const grant = yield* Effect.acquireRelease(
          channel.call(HostTurn.acquire, { attemptId, target, admission }, true),
          (value) =>
            cleanup
              .call(
                HostTurn.release,
                {
                  turnId: attemptId,
                  expectedVersion: value.version,
                },
                true,
              )
              .pipe(
                Effect.flatMap((released) =>
                  released.turnId === attemptId && released.state !== "held"
                    ? Effect.void
                    : Effect.fail(new OfficeUnavailable(safeFailure("AUTHORITY_LOST"))),
                ),
                Effect.orDie,
                Effect.ensuring(Effect.promise(() => channel.drain())),
                Effect.ensuring(Effect.promise(() => cleanup.drain())),
              ),
        );
        const permit = captureWritePermit(grant.permit);
        const now = yield* Clock.currentTimeMillis;
        if (
          grant.turnId !== attemptId ||
          grant.deadline <= now ||
          !sameNativeTarget(permit.target, target) ||
          permit.owner.stage !== target.owner.stage ||
          permit.owner.ownerId !== target.owner.ownerId ||
          permit.documentId !== target.documentId ||
          permit.operationId !== admission.operationId ||
          permit.expectedHead !== admission.expectedHead ||
          permit.reviewFingerprint !== admission.reviewFingerprint ||
          permit.expectedGeneration !==
            (target.scope.kind === "draft" ? target.scope.generation : null)
        )
          return yield* Effect.fail(
            new OfficeUnavailable(safeFailure("AUTHORITY_LOST", admission.operationId)),
          );
        // No guessed renewal or mutation retry. The actual grant's original deadline is a hard ceiling.
        return yield* body(permit).pipe(
          Effect.timeoutOrElse({
            duration: grant.deadline - now,
            orElse: () =>
              Effect.fail(
                new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN", admission.operationId)),
              ),
          }),
        );
      }),
    );
  }
  return Object.freeze({
    serial,
    current: (owner, documentId) => channel.call(HostControl.current, { owner, documentId }, false),
  } satisfies DocumentAuthority);
}
