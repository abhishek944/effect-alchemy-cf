import { tryReserveImageMemory, type ImageMemoryLease } from "./chat-image-memory.ts";
import { nativeImageLimits } from "./chat-image-policy.ts";
import { imageHostRefusal } from "./chat-image-host-sources.ts";
import type { ImageHostLifetime, ImageHostPlan } from "./chat-image-host-types.ts";

/** Track the real promises, including nested body completion after transport headers. */
export function reserveImageHostLifetime(plan: ImageHostPlan): ImageHostLifetime {
  const originals = plan.sources.map(({ authority }) => ({
    kind: authority.file.kind,
    byteSize: authority.file.byteSize,
  }));
  const referenceBytes = originals.reduce((sum, file) => sum + file.byteSize, 0);
  const limits = nativeImageLimits(referenceBytes);
  const base = tryReserveImageMemory({
    purpose: "generation",
    originals,
    textCharacters:
      plan.request.effective.prompt.length * 4 +
      plan.sources.reduce(
        (sum, source) => sum + source.url.length + source.authority.file.name.length + 1024,
        0,
      ),
    outputBytes: limits.imageBytes ?? 0,
    responseBytes: limits.responseBytes ?? 0,
    storageProfile: "rpc-borrowed",
  });
  if (base === null) return imageHostRefusal();
  const pending = new Set<Promise<unknown>>();
  const lease: ImageMemoryLease = {
    ...base,
    track<T>(work: () => Promise<T>): Promise<T> {
      const actual = base.track(work);
      pending.add(actual);
      void actual.then(
        () => pending.delete(actual),
        () => pending.delete(actual),
      );
      return actual;
    },
  };
  return {
    lease,
    async drain(): Promise<void> {
      // This waits real operations, not polling. A transport can register its body while draining.
      while (pending.size > 0) await Promise.allSettled(pending);
    },
  };
}
