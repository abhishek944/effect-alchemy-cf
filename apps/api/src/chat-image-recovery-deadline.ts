/** One cold-recovery scope, never authority to repeat paid work or release owner holds. */
export class ChatImageRecoveryDeadline {
  private readonly controller = new AbortController();
  private readonly until = Date.now() + 10_000;
  private readonly expired: Promise<never>;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly parent: AbortSignal | undefined;
  private reject: (() => void) | undefined;
  private closed = false;
  private readonly aborted = (): void => this.close();

  constructor(parent?: AbortSignal) {
    this.parent = parent;
    this.expired = new Promise<never>((_resolve, reject) => {
      this.reject = () => reject(new Error("Image recovery deadline is closed."));
    });
    // Even a synchronous preflight refusal can close the scope before any wait is registered.
    void this.expired.catch(() => undefined);
    this.timer = setTimeout(() => this.close(), Math.max(0, this.until - Date.now()));
    parent?.addEventListener("abort", this.aborted, { once: true });
    if (parent?.aborted) this.close();
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  check(): void {
    if (this.closed || this.parent?.aborted || Date.now() >= this.until) {
      this.close();
      throw new Error("Image recovery deadline is closed.");
    }
  }
  /** Observe actual settlement, but never let ignored cancellation block this caller's bound. */
  wait<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    const actual = Promise.resolve().then(() => {
      this.check();
      return work();
    });
    const checked = actual.then((value) => {
      this.check();
      return value;
    });
    // Both branches remain observed after the race; late work cannot grant a successful result.
    return Promise.race([checked, this.expired]);
  }
  close(): void {
    if (!this.closed) {
      this.closed = true;
      try {
        this.controller.abort();
      } finally {
        this.reject?.();
      }
    }
    clearTimeout(this.timer);
    this.parent?.removeEventListener("abort", this.aborted);
  }
}
