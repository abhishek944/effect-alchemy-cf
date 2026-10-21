import { OfficeLimited, safeFailure } from "@starter/office-contract";
import type { officeBinaryCursor } from "./native-transfer-frame.ts";
import type { OfficeBinaryResource } from "./native-transfer-resource.ts";

/** Do not release the real response lease merely because exchange() has returned its headers. */
export function officeBinaryResponse(
  cursor: ReturnType<typeof officeBinaryCursor>,
  resource: OfficeBinaryResource,
  maximum: number,
): ReadableStream<Uint8Array> {
  let count = 0;
  let state: "open" | "joining" | "finished" = "open";
  return new ReadableStream<Uint8Array>({
    start(controller) {
      resource.add(() =>
        Promise.resolve().then(() => {
          if (state === "open") {
            state = "finished";
            controller.error(new Error("Private transfer lease closed"));
          }
          return undefined;
        }),
      );
    },
    async pull(controller) {
      try {
        resource.check();
        const part = await cursor.next();
        resource.check();
        if (part.done) {
          // Suppress ONLY the intentional local revoke; keep consumer EOF pending through real joins.
          state = "joining";
          await resource.close();
          state = "finished";
          controller.close();
          return;
        }
        count += part.value.byteLength;
        if (count > maximum) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
        controller.enqueue(part.value);
      } catch (cause) {
        if (state !== "finished") {
          state = "finished";
          controller.error(cause);
        }
        try {
          await resource.close();
        } catch {
          // Resource.done/channel.close retain the actual cleanup failure independently.
        }
      }
    },
    cancel: () => resource.close(),
  });
}
