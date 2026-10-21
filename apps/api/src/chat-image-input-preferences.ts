import type * as cf from "@cloudflare/workers-types";
import { Option, Schema } from "effect";
import { ImagePreferencesView } from "./chat-image-preference-schema.ts";
import { ImageResponseCapability } from "./chat-image-response-schema.ts";
import { ImageInputError } from "./chat-image-input-types.ts";

const WorkerSignal = Schema.declare<cf.AbortSignal>(
  (value): value is cf.AbortSignal => value instanceof AbortSignal,
);

async function readPreferences(stub: cf.DurableObjectStub, signal: AbortSignal) {
  const raw: unknown = await stub.fetch("https://chat.internal/images/preferences", {
    method: "GET",
    signal: Schema.decodeUnknownSync(WorkerSignal)(signal),
  });
  if (!(raw instanceof Response)) throw new ImageInputError("unavailable");
  if (!raw.ok || signal.aborted) {
    await raw.body?.cancel().catch(() => undefined);
    throw new ImageInputError("unavailable");
  }
  const body = raw.body;
  if (body === null) throw new ImageInputError("unavailable");
  const reader = body.getReader();
  let cancel: Promise<void> | undefined;
  const abort = (): void => {
    cancel ??= reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    const bytes = new Uint8Array(4096);
    let used = 0;
    for (;;) {
      const part = await reader.read();
      if (signal.aborted) throw new ImageInputError("unavailable");
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array) || chunk.byteLength > bytes.byteLength - used)
        throw new ImageInputError("unavailable");
      bytes.set(chunk, used);
      used += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(0, used)));
    const view = Option.getOrNull(Schema.decodeUnknownOption(ImagePreferencesView)(value));
    if (view === null) throw new ImageInputError("unavailable");
    return view.preferences;
  } catch (error) {
    abort();
    await cancel;
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    await cancel;
    reader.releaseLock();
  }
}

/** One bounded GET for a NEW candidate only. Outage never invents current defaults. */
export async function freezeImageInputCapability(
  stub: cf.DurableObjectStub,
  gatewayId: string | null,
  parentSignal?: AbortSignal,
): Promise<ImageResponseCapability> {
  if (parentSignal?.aborted) throw new ImageInputError("cancelled");
  const configuration =
    gatewayId !== null &&
    gatewayId.trim() === gatewayId &&
    gatewayId.length > 0 &&
    gatewayId.length <= 128 &&
    Array.from(gatewayId).every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    });
  if (!configuration) return { state: "unavailable", reason: "configuration_unavailable" };
  const controller = new AbortController();
  let expire: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    expire = () => {
      controller.abort();
      reject(new ImageInputError("unavailable"));
    };
  });
  const timer = setTimeout(() => expire?.(), 3000);
  const abort = (): void => expire?.();
  parentSignal?.addEventListener("abort", abort, { once: true });
  try {
    if (parentSignal?.aborted) abort();
    const preferences = await Promise.race([readPreferences(stub, controller.signal), timeout]);
    if (parentSignal?.aborted) throw new ImageInputError("cancelled");
    const candidate = Option.getOrNull(
      Schema.decodeUnknownOption(ImageResponseCapability)({
        state: "ready",
        preferences,
        model:
          preferences.model === "flare"
            ? "openai/gpt-image-2.5-flare"
            : "openai/gpt-image-2.5-sunburst",
        gatewayId,
      }),
    );
    return candidate ?? { state: "unavailable", reason: "preferences_unavailable" };
  } catch {
    if (parentSignal?.aborted) throw new ImageInputError("cancelled");
    return { state: "unavailable", reason: "preferences_unavailable" };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
