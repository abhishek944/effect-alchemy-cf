import { decodeOption, json } from "./chat-internal.ts";
import { ImagePreferencesWrite } from "./chat-image-preference-schema.ts";
import type { ChatImagePreferencesStore } from "./chat-image-preference-store.ts";

/** Private owner route; parent ingress owns authentication, CSRF and public path mapping. */
export async function imagePreferenceCatalog(
  request: Request,
  store: ChatImagePreferencesStore,
): Promise<Response | null> {
  const route = `${request.method} ${new URL(request.url).pathname}`;
  if (route !== "GET /images/preferences" && route !== "PATCH /images/preferences") return null;
  if (request.method === "GET") {
    try {
      return json(store.read());
    } catch {
      return json({ message: "Saved image preferences could not be read." }, 503);
    }
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Invalid image preferences." }, 400);
  }
  const input = decodeOption(ImagePreferencesWrite, body);
  if (input === null) return json({ message: "Invalid image preferences." }, 400);
  try {
    const result = store.write(input);
    return result.ok
      ? json(result.value)
      : json(
          {
            code: "revision_conflict",
            message: "Image preferences changed. Reload the saved values before saving again.",
          },
          409,
        );
  } catch {
    return json({ message: "Image preferences could not be saved. Reload to check them." }, 503);
  }
}
