import { ErrorReporter } from "effect";

/** Attach only AFTER constructing tagged errors: their constructor data may be serialized. */
export function withCause<E extends Error>(error: E, cause: unknown): E {
  if (cause === undefined || cause === error) return error;
  const previous: unknown = Object.getOwnPropertyDescriptor(error, "cause")?.value;
  if (previous === cause) return error;
  Object.defineProperty(error, "cause", {
    value:
      previous === undefined
        ? cause
        : new AggregateError([previous, cause], "Multiple internal failures"),
    enumerable: false,
    configurable: true,
  });
  return error;
}

/** Only mark a final outward facade AFTER its original failure has been reported. */
export function reportedFailure<E extends Error>(error: E): E {
  Object.defineProperty(error, ErrorReporter.ignore, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return error;
}
