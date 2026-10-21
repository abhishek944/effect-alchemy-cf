import { Effect } from "effect";
import type { OfficeBytes } from "@starter/office-server/ports";
import type { OfficeProviderOptions } from "../metadata/store.ts";
import { failure } from "../metadata/store.ts";
import { ByteStore } from "./store.ts";
import { putBytes } from "./put.ts";
import { getBytes } from "./get.ts";
import { removeBytes } from "./remove.ts";

export type { OfficeProviderOptions } from "../metadata/store.ts";

/** Host initializes the existing metadata schema and retains ownership of its D1/R2 bindings. */
export function createOfficeBytes(options: OfficeProviderOptions): OfficeBytes {
  const store = new ByteStore(options);
  return {
    put: (owner, input) =>
      Effect.tryPromise({ try: (signal) => putBytes(store, owner, input, signal), catch: failure }),
    get: (owner, id) =>
      Effect.tryPromise({ try: () => getBytes(store, owner, id), catch: failure }),
    removeUnreachable: (owner, id, notBefore) =>
      Effect.tryPromise({
        try: (signal) => removeBytes(store, owner, id, notBefore, signal),
        catch: failure,
      }),
  };
}
