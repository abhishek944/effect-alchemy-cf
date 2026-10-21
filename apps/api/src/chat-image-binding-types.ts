import type { ImageMemoryLease } from "./chat-image-memory.ts";

export type ImageGenerationTransportScope = {
  readonly signal: AbortSignal;
  /** Closes new dispatch/body admission; pending actual transport work retains the lease. */
  close(): void;
};
export type ImageGenerationTransport = {
  /** Register a brand-new signal BEFORE passing it to rawStream options. */
  open(lease: ImageMemoryLease, signal?: AbortSignal): ImageGenerationTransportScope;
};
export type ImageBindingScope = ImageGenerationTransportScope & {
  readonly lease: ImageMemoryLease;
  active(): boolean;
};
export const bindingScopeFailure = (): Error =>
  new Error("The request transport scope ended; this answer may be incomplete.");
