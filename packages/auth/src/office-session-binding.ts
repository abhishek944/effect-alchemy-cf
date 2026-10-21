import { Clock, Effect, Schema } from "effect";
import { Auth } from "./auth.ts";
import {
  OfficeSessionDenied,
  OfficeSessionEpochs,
  OfficeSessionUnavailable,
} from "./office-session-store.ts";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Positive = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const Association = Schema.Struct({
  stage: Id,
  ownerId: Id,
  sessionId: Id,
  sessionEpoch: Positive,
  expiresAt: Positive,
});
const StoredSession = Schema.Struct({ id: Id, userId: Id, expiresAt: Schema.Date });
const StoredUser = Schema.Struct({ id: Id });
export type OfficeSessionBinding = typeof Association.Type;

/** SERVER ONLY: caller MUST hold an original privately issued association. IDs/epochs are NOT credentials.
 * Read-only liveness recheck in a NEW real Auth execution, not fresh authentication/issuance or a native grant.
 */
export const revalidateOfficeSessionBinding = Effect.fn("OfficeSession.revalidateBinding")(
  function* (expectedStage: string, input: OfficeSessionBinding) {
    const original = yield* Schema.decodeUnknownEffect(Association)(input).pipe(
      Effect.mapError(() => new OfficeSessionDenied()),
    );
    const check = (now: number) => original.stage === expectedStage && original.expiresAt > now;
    if (!check(yield* Clock.currentTimeMillis))
      return yield* Effect.fail(new OfficeSessionDenied());
    const epochs = yield* OfficeSessionEpochs;
    const epoch = yield* epochs.lookup(original.stage, original.ownerId, original.sessionId);
    if (epoch !== original.sessionEpoch) return yield* Effect.fail(new OfficeSessionDenied());
    const auth = yield* Auth;
    const instance = yield* auth.auth;
    // Logical BetterAuth models use its configured adapter, not guessed SQL names/date encodings.
    const value = yield* Effect.tryPromise({
      try: async () => {
        const context = await instance.$context;
        const session = await context.adapter.findOne<unknown>({
          model: "session",
          select: ["id", "userId", "expiresAt"],
          where: [
            { field: "id", value: original.sessionId },
            { field: "userId", value: original.ownerId },
          ],
        });
        const user = await context.adapter.findOne<unknown>({
          model: "user",
          select: ["id"],
          where: [{ field: "id", value: original.ownerId }],
        });
        return { session, user };
      },
      catch: () => new OfficeSessionUnavailable(),
    });
    if (value.session === null || value.user === null)
      return yield* Effect.fail(new OfficeSessionDenied());
    const session = yield* Schema.decodeUnknownEffect(StoredSession)(value.session).pipe(
      Effect.mapError(() => new OfficeSessionUnavailable()),
    );
    const user = yield* Schema.decodeUnknownEffect(StoredUser)(value.user).pipe(
      Effect.mapError(() => new OfficeSessionUnavailable()),
    );
    const now = yield* Clock.currentTimeMillis;
    const expiry = session.expiresAt.getTime();
    if (
      session.id !== original.sessionId ||
      session.userId !== original.ownerId ||
      user.id !== original.ownerId ||
      !Number.isSafeInteger(expiry) ||
      expiry <= now ||
      !check(now)
    )
      return yield* Effect.fail(new OfficeSessionDenied());
    // No cookie/token, new principal, extended deadline or epoch write is returned/performed.
    return undefined;
  },
  (effect) => effect.pipe(Effect.catchDefect(() => Effect.fail(new OfficeSessionUnavailable()))),
);
