export type ImageGenerationTransportScope = {
  readonly signal: AbortSignal;
  /** Abort owned provider transport and response bodies. */
  close(): void;
};
export type ImageGenerationTransport = {
  /** Register a brand-new signal BEFORE passing it to rawStream options. */
  open(signal?: AbortSignal): ImageGenerationTransportScope;
};
export type ImageBindingScope = ImageGenerationTransportScope & {
  active(): boolean;
};
export const bindingScopeFailure = (): Error =>
  new Error("The request transport scope ended; this answer may be incomplete.");
