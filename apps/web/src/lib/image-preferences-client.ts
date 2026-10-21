import { ChatApiError, request } from "@/lib/chat-api";
import { isRecord, isSafeIndex } from "@/lib/chat-validate-base";
import {
  IMAGE_MODEL_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  type ImagePreferencesView,
  type ImagePreferencesWrite,
} from "@/lib/image-preferences-types";

export const IMAGE_PREFERENCES_PATH = "/api/account/images/preferences";

export function parseImagePreferencesView(input: unknown): ImagePreferencesView | null {
  if (!isRecord(input) || !isRecord(input.preferences)) return null;
  const value = input.preferences;
  const model = IMAGE_MODEL_OPTIONS.find((option) => option.value === value.model)?.value;
  const size = IMAGE_SIZE_OPTIONS.find((option) => option.value === value.size)?.value;
  const quality = IMAGE_QUALITY_OPTIONS.find((option) => option.value === value.quality)?.value;
  if (
    value.version !== 1 ||
    !isSafeIndex(value.revision) ||
    model === undefined ||
    size === undefined ||
    quality === undefined ||
    (input.source !== "default" && input.source !== "explicit") ||
    typeof input.configurationReady !== "boolean"
  )
    return null;
  // A default response cannot claim a persisted revision or different defaults.
  if (
    input.source === "default" &&
    (value.revision !== 0 || model !== "flare" || size !== "auto" || quality !== "auto")
  )
    return null;
  return {
    preferences: { version: 1, revision: value.revision, model, size, quality },
    source: input.source,
    configurationReady: input.configurationReady,
  };
}

const unexpected = () =>
  new ChatApiError(
    502,
    "The server returned unreadable image preferences. No defaults were assumed.",
  );

async function readResponse(init: RequestInit): Promise<ImagePreferencesView> {
  let body: unknown;
  try {
    body = await request(IMAGE_PREFERENCES_PATH, { ...init, cache: "no-store" });
  } catch (error) {
    if (error instanceof SyntaxError) throw unexpected();
    throw error;
  }
  const view = parseImagePreferencesView(body);
  if (view === null) throw unexpected();
  return view;
}

export const fetchImagePreferences = (signal?: AbortSignal): Promise<ImagePreferencesView> =>
  readResponse({ signal: signal ?? null });

export async function saveImagePreferences(
  input: ImagePreferencesWrite,
  signal?: AbortSignal,
): Promise<ImagePreferencesView> {
  const view = await readResponse({
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: signal ?? null,
  });
  const saved = view.preferences;
  if (
    view.source !== "explicit" ||
    saved.revision !== input.expectedRevision + 1 ||
    saved.model !== input.model ||
    saved.size !== input.size ||
    saved.quality !== input.quality
  )
    throw unexpected();
  return view;
}
