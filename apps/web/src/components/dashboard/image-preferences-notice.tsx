import { useEffect, useRef } from "react";
import { imagePreferenceSummary } from "@/lib/image-preferences-types";
import type { ImagePreferencesController } from "./image-preferences-hook";

export function ImagePreferencesNotice({
  controller,
  available,
  id,
}: {
  readonly controller: ImagePreferencesController;
  readonly available: boolean;
  readonly id: string;
}) {
  const { phase, view, draft, error, conflicted, retrySave, reload } = controller;
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === "save-error" || phase === "conflict")
      notice.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [phase]);

  const readFailed = phase === "read-error";
  const saveFailed = phase === "save-error";
  const conflict = phase === "conflict";
  if (!readFailed && !saveFailed && !conflict && available) return null;
  const saved = view === null ? null : imagePreferenceSummary(view.preferences);
  return (
    <div
      data-cx="image-preferences-notice"
      id={id}
      ref={notice}
      role={readFailed || saveFailed ? "alert" : "status"}
    >
      <strong>
        {readFailed
          ? "Image settings are unavailable."
          : saveFailed
            ? "Image settings were not saved."
            : conflict
              ? "Image settings changed in another tab."
              : "Image generation is not ready."}
      </strong>
      {readFailed ? (
        <>
          <p>
            We could not read your saved preferences. No defaults have been assumed.
            {conflicted ? " Another tab changed them; reload before saving again." : ""}
          </p>
          <p>{error}</p>
          <button type="button" onClick={reload}>
            Try loading again
          </button>
        </>
      ) : saveFailed || conflict ? (
        <>
          <p>
            {conflict
              ? "Reloaded the saved account values without overwriting them."
              : "Your attempted choices have not been confirmed saved."}{" "}
            Last confirmed account values: {saved}.
          </p>
          {draft !== null ? <p>Unsaved choices: {imagePreferenceSummary(draft)}.</p> : null}
          {error !== null ? <p>{error}</p> : null}
          <button disabled={!available} type="button" onClick={retrySave}>
            Try saving again
          </button>
        </>
      ) : (
        <>
          <p>
            The account’s image connection is unavailable. Your saved settings remain unchanged. No
            image request was sent.
          </p>
          <p>You can still use chat. An administrator needs to finish the image connection.</p>
        </>
      )}
    </div>
  );
}
