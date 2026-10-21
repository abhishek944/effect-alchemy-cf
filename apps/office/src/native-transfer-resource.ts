import { OfficeUnavailable, safeFailure } from "@starter/office-contract";

/** One REAL fetch/upload/response-body lifetime, not an authority grant or an Effect completion hint. */
export class OfficeBinaryResource {
  private readonly controller = new AbortController();
  readonly signal: AbortSignal;
  readonly done: Promise<void>;
  private settle: (() => void) | undefined;
  private setup: Promise<void> | undefined;
  private readonly closers = new Map<() => Promise<void>, Promise<void> | undefined>();
  private closing: Promise<void> | undefined;
  private revoked = false;
  private failed = false;
  private readonly timer: ReturnType<typeof setTimeout>;
  readonly deadline: number;
  private readonly failure: () => void;
  private readonly aborted = () => {
    void this.close().catch(() => this.failure());
  };
  constructor(parent: AbortSignal, effect: AbortSignal, deadline: number, failure: () => void) {
    this.deadline = deadline;
    this.failure = failure;
    this.done = new Promise<void>((resolve) => {
      this.settle = resolve;
    });
    this.signal = AbortSignal.any([parent, effect, this.controller.signal]);
    this.timer = setTimeout(
      () => this.revoke(),
      Math.min(Math.max(0, deadline - Date.now()), 2147483647),
    );
    this.timer.unref();
    this.signal.addEventListener("abort", this.aborted, { once: true });
  }
  check(): void {
    this.signal.throwIfAborted();
    if (this.revoked || Date.now() >= this.deadline) throw new Error("Private transfer expired");
  }
  started<A>(actual: Promise<A>): void {
    this.setup = actual.then(
      () => undefined,
      () => undefined,
    );
  }
  add(close: () => Promise<void>): void {
    this.closers.set(close, undefined);
    if (this.revoked) void this.start(close);
  }
  revoke(): void {
    this.revoked = true;
    this.controller.abort();
  }
  private start(close: () => Promise<void>): Promise<void> {
    const previous = this.closers.get(close);
    if (previous !== undefined) return previous;
    const actual = Promise.resolve()
      .then(close)
      .then(
        () => undefined,
        () => {
          this.failed = true;
          this.failure();
          return undefined;
        },
      );
    this.closers.set(close, actual);
    return actual;
  }
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closing = Promise.resolve().then(async () => {
      const started = [...this.closers.keys()].map((close) => this.start(close));
      // Start cancellation BEFORE joining setup: setup may be waiting for a reader being cancelled.
      if (this.setup === undefined) throw new Error("Private transfer setup was not registered");
      await this.setup;
      await Promise.all(started);
      await Promise.all([...this.closers.keys()].map((close) => this.start(close)));
      clearTimeout(this.timer);
      this.signal.removeEventListener("abort", this.aborted);
      if (this.failed) throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
      return undefined;
    });
    // A terminal observer of the REAL close, not an early "current map is empty" assertion.
    const settled = () => {
      const settle = this.settle;
      if (settle === undefined) throw new Error("Private transfer completion was not registered");
      settle();
      return undefined;
    };
    void this.closing.then(settled, settled);
    this.revoke();
    return this.closing;
  }
}
