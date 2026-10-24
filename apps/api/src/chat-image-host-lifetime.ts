import type { ImageHostLifetime } from "./chat-image-host-types.ts";

/** Join real provider/body/storage work before finishing durable output intent. */
export function createImageHostLifetime(): ImageHostLifetime {
  const pending = new Set<Promise<unknown>>();
  return {
    track<T>(work: () => Promise<T>): Promise<T> {
      const actual = Promise.resolve().then(work);
      pending.add(actual);
      void actual.then(
        () => pending.delete(actual),
        () => pending.delete(actual),
      );
      return actual;
    },
    async drain(): Promise<void> {
      while (pending.size > 0) await Promise.allSettled(pending);
    },
  };
}
