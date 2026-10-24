import { reportFailure, withCause } from "@starter/diagnostics";
import {
  disposeImageBindingResult,
  ownImageBindingBody,
  type ImageBindingBody,
} from "./chat-image-binding-body.ts";
import { bindingScopeFailure, type ImageBindingScope } from "./chat-image-binding-types.ts";

/** Own late responses and body cancellation after provider headers resolve. */
export const runImageBindingCall = (
  scope: ImageBindingScope,
  start: () => unknown,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let offered = false;
    try {
      const pending = (async () => {
        if (!scope.active()) throw bindingScopeFailure();
        const value: unknown = await start();
        if (!scope.active()) {
          throw withCause(bindingScopeFailure(), await disposeImageBindingResult(value));
        }
        if (value instanceof Response) {
          let owned: ImageBindingBody;
          try {
            owned = await ownImageBindingBody(value, scope.signal);
          } catch (error) {
            throw withCause(
              error instanceof Error ? error : bindingScopeFailure(),
              await disposeImageBindingResult(value),
            );
          }
          // Scope may close during the asynchronous body-ownership handoff.
          if (!scope.active()) {
            await owned.done;
            throw bindingScopeFailure();
          }
          offered = true;
          resolve(owned.response);
          // The offered response is authoritative; report only real body cleanup failure.
          await owned.done.catch((error: unknown) => {
            reportFailure(error, {
              component: "chat-image-binding",
              operation: "owned-body",
              event: "application.cleanup",
            });
          });
        } else {
          if (value instanceof ReadableStream) {
            throw withCause(bindingScopeFailure(), await disposeImageBindingResult(value));
          }
          offered = true;
          resolve(value);
        }
      })();
      void pending.catch((error: unknown) => {
        if (!offered) reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
