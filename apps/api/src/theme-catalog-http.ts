/**
 * Private owner-catalog routes for the account theme.
 *
 * Manual browser writes are revision-guarded. AI commands arrive frozen from the
 * originating chat (expected revision, chosen theme, and for Undo the exact
 * target action), are applied at most once, and return the terminal receipt so a
 * retried delivery reports the original outcome. Preparation reads expose only
 * the current revision and this origin's eligible Undo target; no route rebases a
 * frozen command and no public Undo surface is added.
 */
import { Schema } from "effect";
import { decodeOption, json, requestBody } from "./chat-internal.ts";
import type { ThemeStore } from "./theme-store.ts";
import {
  ActionReceiptResponse,
  FrozenApply,
  FrozenUndo,
  ManualThemeWrite,
  ThemeOrigin,
  ThemeCommandResponse,
  UndoTargetResponse,
  themeView,
  type ThemeFailure,
} from "./theme-model.ts";

const Refusal = Schema.Struct({
  origin: ThemeOrigin,
  command: Schema.Union([FrozenApply, FrozenUndo]),
});

const messageFor = (code: ThemeFailure): string => {
  if (code === "revision_conflict")
    return "Theme changed elsewhere. Refresh before choosing again.";
  if (code === "nothing_to_undo") return "There is no theme change from this chat to undo.";
  return "That theme command is not valid.";
};

const refuse = (code: ThemeFailure): Response =>
  json({ code, message: messageFor(code) }, code === "revision_conflict" ? 409 : 400);

export async function themeCatalog(request: Request, store: ThemeStore): Promise<Response | null> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const now = Date.now();
  if (route === "GET /theme") return json({ theme: themeView(store.read(), store.canUndo()) });
  if (route === "PUT /theme") {
    const input = decodeOption(ManualThemeWrite, await requestBody(request));
    if (input === null) return refuse("invalid_input");
    const written = store.writeManual(input);
    return written.ok
      ? json({ theme: themeView(written.value, store.canUndo()) })
      : refuse(written.code);
  }
  if (route === "GET /theme/undo-target") {
    const raw = request.headers.get("x-theme-origin");
    let origin: string | null = null;
    try {
      origin = raw === null ? null : decodeURIComponent(raw);
    } catch {
      origin = null;
    }
    if (origin === null) return refuse("invalid_input");
    const target = store.undoTarget(origin);
    if (!target.ok) return refuse(target.code);
    return json(decodeOption(UndoTargetResponse, { target: target.value }));
  }
  if (route === "GET /theme/receipt") {
    const actionId = url.searchParams.get("actionId") ?? "";
    return json(decodeOption(ActionReceiptResponse, { receipt: store.receipt(actionId) }));
  }
  if (route === "POST /theme/apply" || route === "POST /theme/undo") {
    const input = decodeOption(Refusal, await requestBody(request));
    if (input === null) return refuse("invalid_input");
    const applied =
      input.command.kind === "apply"
        ? store.apply(input.command, input.origin, now)
        : store.undo(input.command, input.origin, now);
    if (!applied.ok) return refuse(applied.code);
    return json(
      decodeOption(ThemeCommandResponse, {
        receipt: applied.value.receipt,
        current: themeView(applied.value.current, store.canUndo()),
      }),
    );
  }
  return null;
}
