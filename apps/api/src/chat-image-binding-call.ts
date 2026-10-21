import {
  disposeImageBindingResult,
  ownImageBindingBody,
  type ImageBindingBody,
} from "./chat-image-binding-body.ts";
import { bindingScopeFailure, type ImageBindingScope } from "./chat-image-binding-types.ts";

/** One lease.track spans actual run AND body lifetime, not just the delivered headers. */
export const runImageBindingCall = (
  scope: ImageBindingScope,
  start: () => unknown,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let offered = false;
    try {
      const pending = scope.lease.track(async () => {
        if (!scope.active()) throw bindingScopeFailure();
        const value: unknown = await start();
        if (!scope.active()) {
          await disposeImageBindingResult(value);
          throw bindingScopeFailure();
        }
        if (value instanceof Response) {
          let owned: ImageBindingBody;
          try {
            owned = await ownImageBindingBody(value, scope.signal);
          } catch (error) {
            await disposeImageBindingResult(value);
            throw error;
          }
          // Scope may close during the asynchronous body-ownership handoff.
          if (!scope.active()) {
            await owned.done;
            throw bindingScopeFailure();
          }
          offered = true;
          resolve(owned.response);
          await owned.done;
        } else {
          if (value instanceof ReadableStream) {
            await disposeImageBindingResult(value);
            throw bindingScopeFailure();
          }
          offered = true;
          resolve(value);
        }
      });
      void pending.catch((error: unknown) => {
        if (!offered) reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
