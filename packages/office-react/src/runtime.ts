import type { Effect } from "effect";
import type { OfficeClient } from "@starter/office-contract/client";

/** Host captures its authenticated HttpClient/runtime; this package never creates a second runtime. */
export type OfficeRunner = <A, E>(
  effect: Effect.Effect<A, E>,
  options: { readonly signal: AbortSignal },
) => Promise<A>;
export type OfficeRuntime = { readonly client: OfficeClient; readonly run: OfficeRunner };
/** UI serialization only, never a session or native authorization grant. */
export type OfficeActionAdmission = {
  readonly admit?: () => (() => void) | null;
  readonly disabled?: boolean;
};
