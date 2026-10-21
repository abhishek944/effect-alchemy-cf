import { Schema } from "effect";
import type { Duplex } from "node:stream";
import type {
  NativePrivateInvocation,
  NativePrivateInvocations,
} from "./native-private-invocations.ts";

/** Real listener Duplex close, independent of SDK logical member leave and initial upgrade return. */
export function nativePrivateSocket(
  invocations: NativePrivateInvocations,
  current: NativePrivateInvocation,
  socket: Duplex,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  // The original admitted channel/placement deadline bounds the raw socket too: an expired recipient
  // must stop receiving presence broadcasts. The timer only STARTS close; close itself is awaited.
  const destroy = () => {
    disarm();
    if (!socket.destroyed) socket.destroy();
  };
  const closed = new Promise<void>((resolve) => {
    const onError = () => {
      socket.destroy(); // Destruction ACK is not close; still await the real close event.
    };
    const onClose = () => {
      socket.off("error", onError);
      current.signal.removeEventListener("abort", destroy);
      disarm();
      resolve();
    };
    // Node's closed getter means close was ALREADY emitted, unlike destroyed/readableEnded.
    if (socket.closed) {
      resolve();
      return;
    }
    socket.once("close", onClose);
    socket.on("error", onError);
    current.signal.addEventListener("abort", destroy, { once: true });
    const remaining = current.value.deadline - Date.now();
    if (current.signal.aborted || remaining <= 0) {
      destroy();
      return;
    }
    timer = setTimeout(destroy, remaining);
    timer.unref();
  });
  const actual = closed.then(() =>
    invocations.connection.json(
      `/private/${current.value.invocationId}/socket-closed`,
      {},
      Schema.Null,
      new AbortController().signal,
      current.value.cleanupDeadline,
    ),
  );
  invocations.own(actual);
}
