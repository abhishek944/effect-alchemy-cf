/**
 * One task at a time per key. Results and failures pass through to the caller,
 * and the chain is dropped as soon as a key has no queued work, so the map never
 * grows with idle keys.
 */
export class KeyedQueue {
  readonly #queues = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(key, settled);
    void settled.then(() => this.#queues.get(key) === settled && this.#queues.delete(key));
    return next;
  }
}
