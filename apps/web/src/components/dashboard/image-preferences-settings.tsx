import { useId } from "react";
import { imagePreferenceSummary } from "@/lib/image-preferences-types";
import { useImagePreferences } from "./image-preferences-hook";
import { ImagePreferencesNotice } from "./image-preferences-notice";
import { ImagePreferencesRows } from "./image-preferences-rows";
import "./settings.css";
import "./image-preferences-settings.css";

export type ImagePreferencesSettingsProps = {
  /** Optional host restriction; authenticated preference reads supply real setup configuration. */
  readonly available?: boolean;
};

/** Render below the existing Settings Images heading, not inside the chat composer. */
export default function ImagePreferencesSettings({
  available: parentAvailable = true,
}: ImagePreferencesSettingsProps) {
  const controller = useImagePreferences();
  const { phase, view, draft, busy, choose } = controller;
  const available = parentAvailable && (view?.configurationReady ?? true);
  const id = useId();
  const showCard = view !== null && draft !== null;
  const failed = phase === "read-error" || phase === "save-error" || phase === "conflict";
  const noticeId = `${id}-notice`;
  const status =
    phase === "loading"
      ? "Loading image settings…"
      : phase === "refreshing"
        ? "Image settings changed in another tab. Reading the saved account values…"
        : phase === "saving"
          ? "Saving image settings… Your change applies after it is saved."
          : phase === "ready" && view !== null
            ? view.source === "default"
              ? `Account defaults: ${imagePreferenceSummary(view.preferences)}.`
              : "Saved to your account."
            : "";
  return (
    <div aria-busy={busy} data-cx="image-preferences">
      <p data-cx="image-preferences-intro">
        Saved to your account across all chats and devices. Changes apply to your next response, not
        one already in progress.
      </p>
      {showCard ? (
        <section aria-label="Image generation" data-cx="settings-group">
          <h2 data-cx="settings-group-title">Image generation</h2>
          <dl data-cx="settings-card">
            <ImagePreferencesRows
              choose={choose}
              disabled={busy || !available || phase === "read-error"}
              draft={draft}
              noticeId={failed || !available ? noticeId : undefined}
            />
          </dl>
        </section>
      ) : null}
      <ImagePreferencesNotice available={available} controller={controller} id={noticeId} />
      {showCard ? (
        <p data-cx="image-preferences-disclosure">
          These settings never generate an image. Ask for an image in your message, then Send. No
          paid preview runs here.
        </p>
      ) : null}
      <output aria-live="polite" data-cx="image-preferences-status">
        {available || busy ? status : ""}
      </output>
    </div>
  );
}
