import { reportedFailure, reportFailureEffect, withCause } from "@starter/diagnostics";
import { Effect } from "effect";
import { AuthenticationUnavailable } from "./model.ts";

/** Public 503 shape; the original failure stays in server memory only. */
export const authUnavailable = (cause: unknown): AuthenticationUnavailable =>
  withCause(new AuthenticationUnavailable(), cause);

/**
 * Final auth owners report once with the current request annotations, then fail
 * with the safe 503. The facade is marked reported so HttpApiBuilder's central
 * reporter does not duplicate the record. Expected 401/403 outcomes stay
 * unreported domain denials.
 */
export const authUnavailableEffect = (
  operation: string,
  cause: unknown,
): Effect.Effect<never, AuthenticationUnavailable> =>
  Effect.gen(function* () {
    const error = authUnavailable(cause);
    yield* reportFailureEffect(error, { component: "auth", operation });
    return yield* Effect.fail(reportedFailure(error));
  });
