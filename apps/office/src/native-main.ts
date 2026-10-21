import { Effect } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import { OwnerClaims } from "@starter/office-server/ports";
import { makeNativeApplication, type NativeApplicationOptions } from "./native-app.ts";
import { makeOfficeProtocolPool } from "./native-protocol-pool.ts";
import { OfficeProtocolTasks } from "./native-protocol-tasks.ts";
import { createOfficeNodeHandlers } from "./native-handlers.ts";
import type { ResolveOfficeIngress } from "./native-handler-types.ts";
import type { OfficeRequestContext } from "./native-request-context.ts";

export type NativeOfficeHostOptions = NativeApplicationOptions & {
  /** SAME actual context used by metadata/control/authority/T49 native+bytes dispatchers. */
  readonly context: OfficeRequestContext;
  readonly resolve: ResolveOfficeIngress;
};
/** Real scoped application/handler composition, NOT listener/startup or issuer attestation.
 * T47 composes15's actual makeOfficeNodeServer AFTER this in the SAME Scope: listener closes FIRST.
 */
export const makeNativeOfficeHost = Effect.fn("Office.nativeHost")(function* (
  options: NativeOfficeHostOptions,
) {
  const tasks = new OfficeProtocolTasks();
  const bindAuthority = options.bindAuthority;
  const owner = Object.freeze(decodeWireSync(OwnerClaims)(structuredClone(options.owner)));
  const dependencies = options.dependencies,
    maxProtocols = options.maxProtocols;
  const context = options.context,
    resolve = options.resolve;
  const application = yield* makeNativeApplication({
    dependencies,
    owner,
    maxProtocols,
    bindAuthority(input) {
      const actual = bindAuthority(input);
      return {
        authority: tasks.wrap(actual.authority),
        views: actual.views,
        submissions: actual.submissions,
      };
    },
  });
  const pool = yield* makeOfficeProtocolPool(application, maxProtocols);
  const handlers = createOfficeNodeHandlers({
    application,
    pool,
    tasks,
    context,
    dependencies,
    owner,
    resolve,
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => handlers.revoke()).pipe(
      Effect.andThen(Effect.promise(() => handlers.drain())),
    ),
  );
  // Caller owns real providers/process/listener; this Scope owns its actual cached SDK/protocol resources.
  return Object.freeze({ office: application.office, handlers, signal: application.signal });
});
