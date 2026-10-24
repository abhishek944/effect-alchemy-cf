import { runImageBindingCall } from "./chat-image-binding-call.ts";
import {
  bindingScopeFailure,
  type ImageBindingScope,
  type ImageGenerationTransport,
} from "./chat-image-binding-types.ts";

export type {
  ImageGenerationTransport,
  ImageGenerationTransportScope,
} from "./chat-image-binding-types.ts";

/**
 * Wrap the actual AI binding BEFORE createAI. No model/input/options rewriting.
 * Unregistered signals keep native behavior; closed registered signals stay cancelled.
 */
export const createImageGenerationBinding = <T extends object>(
  binding: T,
): {
  readonly binding: T;
  readonly transport: ImageGenerationTransport;
} => {
  const scopes = new WeakMap<AbortSignal, ImageBindingScope>();
  const gateways = new WeakMap<object, object>();
  const wrap = <Target extends object>(target: Target, optionsIndex: 1 | 2): Target => {
    const methods = new Map<
      PropertyKey,
      { readonly original: unknown; readonly wrapped: unknown }
    >();
    return new Proxy(target, {
      get(object, key) {
        const value: unknown = Reflect.get(object, key, object);
        if (typeof value !== "function") return value;
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (descriptor?.configurable === false && descriptor.writable === false) {
          // Proxy invariants prohibit substituting immutable own methods; never bypass run.
          if (key === "run" || key === "gateway") throw bindingScopeFailure();
          return value;
        }
        const cached = methods.get(key);
        if (cached?.original === value) return cached.wrapped;
        let wrapped: unknown;
        if (key === "run") {
          wrapped = (...args: unknown[]): unknown => {
            const options = args[optionsIndex];
            const signal: unknown =
              options !== null && typeof options === "object"
                ? Reflect.get(options, "signal")
                : undefined;
            const scope = signal instanceof AbortSignal ? scopes.get(signal) : undefined;
            const invoke = (): unknown => Reflect.apply(value, object, args);
            if (scope === undefined) return invoke();
            if (!scope.active()) return Promise.reject(bindingScopeFailure());
            return runImageBindingCall(scope, invoke);
          };
        } else if (key === "gateway" && optionsIndex === 2) {
          wrapped = (...args: unknown[]): unknown => {
            const gateway: unknown = Reflect.apply(value, object, args);
            if (gateway === null || typeof gateway !== "object") return gateway;
            const known = gateways.get(gateway);
            if (known !== undefined) return known;
            const next = wrap(gateway, 1);
            gateways.set(gateway, next);
            return next;
          };
        } else wrapped = value.bind(object);
        methods.set(key, { original: value, wrapped });
        return wrapped;
      },
    });
  };
  return {
    binding: wrap(binding, 2),
    transport: {
      open(signal) {
        const controller = new AbortController();
        let live = true;
        const close = (): void => {
          if (!live) return;
          live = false;
          signal?.removeEventListener("abort", close);
          // Cancel unconsumed/locked owned bodies through their existing signal handlers.
          controller.abort();
        };
        const scope: ImageBindingScope = {
          signal: controller.signal,
          active: () => live && !controller.signal.aborted,
          close,
        };
        scopes.set(controller.signal, scope);
        signal?.addEventListener("abort", close, { once: true });
        if (signal?.aborted) close();
        return { signal: controller.signal, close };
      },
    },
  };
};
