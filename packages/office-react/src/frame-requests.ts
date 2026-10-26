import type { OfficeSave } from "./connection.ts";
import type { NativeSelectionCapture } from "./capture.ts";
import {
  type FrameRequest,
  type FrameResponse,
  type FramePhase,
  HOST_MESSAGES,
  readResultReason,
} from "./frame/messages.ts";

type Request = Extract<FrameRequest, { kind: "request" }>;
type Action = Request["action"];
/** Pending host requests own their timeout and disposal; frame execution remains serial. */
export function frameRequests(options: {
  viewId: string;
  nonce: string;
  ready(): boolean;
  send(message: FrameRequest): void;
  onTimeout(): void;
  failure(phase: FramePhase, reason: string, requestId: string | null): Error;
}) {
  let disposed = false;
  const pending = new Map<
    string,
    {
      action: Action;
      resolve(value: OfficeSave): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  return {
    request(action: Action, capture?: NativeSelectionCapture) {
      return new Promise<OfficeSave>((resolve, reject) => {
        if (disposed || !options.ready()) {
          reject(
            disposed
              ? new Error(HOST_MESSAGES.disposed)
              : options.failure("init", "not-ready", null),
          );
          return;
        }
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(requestId);
          options.onTimeout();
          reject(options.failure(action === "flush" ? "flush" : "input", "timeout", requestId));
        }, 90_000);
        pending.set(requestId, { action, resolve, reject, timer });
        if (action === "hold" || action === "flush" || action === "resume")
          options.send({ kind: "request", nonce: options.nonce, requestId, action });
        else if (capture !== undefined)
          options.send({ kind: "request", nonce: options.nonce, requestId, action, capture });
        else {
          clearTimeout(timer);
          pending.delete(requestId);
          reject(options.failure("input", "capture-unavailable", requestId));
        }
      });
    },
    accept(response: Extract<FrameResponse, { kind: "result" }>) {
      const waiting = pending.get(response.requestId);
      if (!waiting) return;
      pending.delete(response.requestId);
      clearTimeout(waiting.timer);
      if (response.ok)
        waiting.resolve({
          viewId: options.viewId,
          revision: response.revision,
          ...(response.selection === undefined ? {} : { selection: response.selection }),
        });
      else
        waiting.reject(
          options.failure(
            waiting.action === "flush" ? "flush" : "input",
            readResultReason(response.reason),
            response.requestId,
          ),
        );
    },
    dispose() {
      disposed = true;
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error("Office frame was disposed before confirmation."));
      }
      pending.clear();
    },
  };
}
