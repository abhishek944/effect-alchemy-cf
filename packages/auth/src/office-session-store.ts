import type { D1Database } from "@cloudflare/workers-types";
import { withCause } from "@starter/diagnostics";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Context, Effect, Layer, Schema } from "effect";
import { AuthDatabase } from "./database.ts";

export class OfficeSessionUnavailable extends Schema.TaggedError<OfficeSessionUnavailable>()(
  "OfficeSessionUnavailable",
  {},
) {}
export class OfficeSessionDenied extends Schema.TaggedError<OfficeSessionDenied>()(
  "OfficeSessionDenied",
  {},
) {}
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Binding = Schema.Struct({
  epoch: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  stage: Id,
  owner_id: Id,
  session_id: Id,
});
const Input = Schema.Struct({ stage: Id, ownerId: Id, sessionId: Id });

/** Only the existing auth database issues epochs; identifiers are never credentials. */
export class OfficeSessionEpochs extends Context.Service<
  OfficeSessionEpochs,
  {
    readonly bind: (
      stage: string,
      ownerId: string,
      sessionId: string,
    ) => Effect.Effect<number, OfficeSessionUnavailable, RuntimeContext>;
    readonly lookup: (
      stage: string,
      ownerId: string,
      sessionId: string,
    ) => Effect.Effect<number | null, OfficeSessionUnavailable, RuntimeContext>;
  }
>()("starter/OfficeSessionEpochs") {
  static readonly layer = Layer.effect(
    OfficeSessionEpochs,
    Effect.gen(function* () {
      const client = yield* Cloudflare.D1.QueryDatabase(AuthDatabase);
      return {
        bind: Effect.fn("OfficeSession.bind")(function* (
          stage: string,
          ownerId: string,
          sessionId: string,
        ) {
          const input = yield* Schema.decodeUnknownEffect(Input)({
            stage,
            ownerId,
            sessionId,
          }).pipe(Effect.mapError((cause) => withCause(new OfficeSessionUnavailable(), cause)));
          const db: D1Database = yield* client.raw;
          const row = yield* Effect.tryPromise({
            try: async () => {
              // Additive, idempotent initialization; never replace auth tables or recycle an epoch.
              const result = await db.batch([
                db.prepare(`CREATE TABLE IF NOT EXISTS office_session_epochs (
              epoch INTEGER PRIMARY KEY AUTOINCREMENT,
              stage TEXT NOT NULL, owner_id TEXT NOT NULL, session_id TEXT NOT NULL,
              UNIQUE(stage, session_id)
            )`),
                db
                  .prepare(`INSERT INTO office_session_epochs(stage,owner_id,session_id)
              VALUES(?,?,?) ON CONFLICT(stage,session_id) DO NOTHING`)
                  .bind(input.stage, input.ownerId, input.sessionId),
              ]);
              if (result.some((entry) => !entry.success)) throw new Error("Session binding failed");
              return db
                .prepare(`SELECT epoch,stage,owner_id,session_id FROM office_session_epochs
            WHERE stage=? AND session_id=?`)
                .bind(input.stage, input.sessionId)
                .first();
            },
            catch: (cause) => withCause(new OfficeSessionUnavailable(), cause),
          });
          const binding = yield* Schema.decodeUnknownEffect(Binding)(row).pipe(
            Effect.mapError((cause) => withCause(new OfficeSessionUnavailable(), cause)),
          );
          if (
            binding.owner_id !== input.ownerId ||
            binding.stage !== input.stage ||
            binding.session_id !== input.sessionId
          )
            return yield* Effect.fail(new OfficeSessionUnavailable());
          return binding.epoch;
        }),
        lookup: Effect.fn("OfficeSession.lookup")(function* (
          stage: string,
          ownerId: string,
          sessionId: string,
        ) {
          const input = yield* Schema.decodeUnknownEffect(Input)({
            stage,
            ownerId,
            sessionId,
          }).pipe(Effect.mapError((cause) => withCause(new OfficeSessionUnavailable(), cause)));
          const db = yield* client.raw;
          const row = yield* Effect.tryPromise({
            try: () =>
              db
                .prepare(`SELECT epoch,stage,owner_id,session_id FROM office_session_epochs
              WHERE stage=? AND owner_id=? AND session_id=?`)
                .bind(input.stage, input.ownerId, input.sessionId)
                .first(),
            catch: (cause) => withCause(new OfficeSessionUnavailable(), cause),
          });
          if (row === null) return null;
          const binding = yield* Schema.decodeUnknownEffect(Binding)(row).pipe(
            Effect.mapError((cause) => withCause(new OfficeSessionUnavailable(), cause)),
          );
          if (
            binding.stage !== input.stage ||
            binding.owner_id !== input.ownerId ||
            binding.session_id !== input.sessionId
          )
            return yield* Effect.fail(new OfficeSessionUnavailable());
          return binding.epoch;
        }),
      };
    }),
  ).pipe(Layer.provide(Cloudflare.D1.QueryDatabaseBinding));
}
