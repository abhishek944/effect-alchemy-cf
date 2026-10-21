import { Clock, Effect, Schema } from "effect";
export {
  revalidateOfficeSessionBinding,
  type OfficeSessionBinding,
} from "./office-session-binding.ts";
import { Auth } from "./auth.ts";
import {
  OfficeSessionDenied,
  OfficeSessionEpochs,
  OfficeSessionUnavailable,
} from "./office-session-store.ts";

export {
  OfficeSessionDenied,
  OfficeSessionEpochs,
  OfficeSessionUnavailable,
} from "./office-session-store.ts";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Principal = Schema.Struct({
  ownerId: Id,
  sessionId: Id,
  expiresAt: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
});

/** SERVER ONLY: headers stay private inside this effect closure, never in claims or public DTOs. */
export const resolveOfficeSession = Effect.fn("OfficeSession.resolve")(function* (
  stage: string,
  headers: Headers,
) {
  const auth = yield* Auth;
  const epochs = yield* OfficeSessionEpochs;
  const originalHeaders = new Headers(headers);
  const read = Effect.gen(function* () {
    const value = yield* auth
      .getSession(originalHeaders)
      .pipe(Effect.mapError(() => new OfficeSessionUnavailable()));
    if (value === null) return yield* Effect.fail(new OfficeSessionDenied());
    const principal = yield* Schema.decodeUnknownEffect(Principal)({
      ownerId: value.user.id,
      sessionId: value.session.id,
      expiresAt: value.session.expiresAt.getTime(),
    }).pipe(Effect.mapError(() => new OfficeSessionUnavailable()));
    if (
      value.session.userId !== principal.ownerId ||
      principal.expiresAt <= (yield* Clock.currentTimeMillis)
    )
      return yield* Effect.fail(new OfficeSessionDenied());
    return principal;
  }).pipe(Effect.catchDefect(() => Effect.fail(new OfficeSessionUnavailable())));
  const original = yield* read;
  const sessionEpoch = yield* epochs.bind(stage, original.ownerId, original.sessionId);
  const revalidate = Effect.gen(function* () {
    const current = yield* read;
    if (
      current.ownerId !== original.ownerId ||
      current.sessionId !== original.sessionId ||
      original.expiresAt <= (yield* Clock.currentTimeMillis)
    )
      return yield* Effect.fail(new OfficeSessionDenied());
    return undefined;
  });
  // Refuse a session revoked while its epoch was being associated. This is not a native permit.
  yield* revalidate;
  return Object.freeze({ ...original, stage, sessionEpoch, revalidate });
});
export type OfficeSession = Effect.Success<ReturnType<typeof resolveOfficeSession>>;
