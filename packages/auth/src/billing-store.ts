import type { D1Database } from "@cloudflare/workers-types";
import { billingError } from "@starter/integrations/billing";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Context, Effect, Layer } from "effect";
import { AuthDatabase } from "./database.ts";

export class BillingStore extends Context.Service<
  BillingStore,
  {
    readonly raw: Effect.Effect<D1Database, never, RuntimeContext>;
  }
>()("starter/BillingStore") {
  static readonly layer = Layer.effect(
    BillingStore,
    Effect.gen(function* () {
      const client = yield* Cloudflare.D1.QueryDatabase(AuthDatabase);
      return { raw: client.raw };
    }),
  ).pipe(Layer.provide(Cloudflare.D1.QueryDatabaseBinding));
}

/** Provider/database failures never retain their raw cause or SQL values. */
export const billingQuery = <A>(run: (db: D1Database) => Promise<A>) =>
  Effect.gen(function* () {
    const { raw } = yield* BillingStore;
    const db = yield* raw;
    return yield* Effect.tryPromise({ try: () => run(db), catch: () => billingError("Storage") });
  });

export const billingKey = (...parts: string[]) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(parts)),
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  });

export const DB_NOW = "CAST(strftime('%s', 'now') AS INTEGER)";
