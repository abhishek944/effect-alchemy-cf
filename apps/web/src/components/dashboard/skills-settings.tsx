/**
 * Settings → Skills: the selected minimal library surface.
 *
 * The default export is the connected controller. SkillsSettingsView is the
 * same real markup as a pure function of display state, so a static comparison
 * can render fictional states from this source without API interception or a
 * fake backend. Cancellation appears only in unresolved recovery, never on a
 * published row.
 */
import { useRef } from "react";
import ErrorNotice from "./error-notice";
import ReadErrorNotice from "./read-error-notice";
import SkillsReplaceDialog from "./skills-replace-dialog";
import {
  NOTICE_LABELS,
  type SkillNotice,
  type SkillNoticeAction,
  type SkillNoticeRun,
  type SkillsLibrary,
} from "./skills-library-model";
import useSkillsLibrary from "./use-skills-library";
import "./skills.css";

function NoticeView({
  notice,
  runNotice,
}: {
  notice: SkillNotice;
  runNotice: (action: Exclude<SkillNoticeAction, null>) => void;
}) {
  const action = notice.action;
  if (action === null) {
    return <ErrorNotice title={notice.title} message={notice.message} />;
  }
  return (
    <ErrorNotice
      title={notice.title}
      message={notice.message}
      action={{ label: NOTICE_LABELS[action], onClick: () => runNotice(action) }}
    />
  );
}

export type SkillsSettingsViewProps = {
  readonly library: SkillsLibrary;
  readonly onPickFile: (file: File) => void;
  readonly onNoticeRun: (action: SkillNoticeRun) => void;
};

/** Pure view of one Skills display state; no fetching or API access. */
export function SkillsSettingsView({ library, onPickFile, onNoticeRun }: SkillsSettingsViewProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  const busy = library.busy !== null;
  const failure = library.downloadFailure;
  const unsettled = library.unsettled;

  function runNotice(action: Exclude<SkillNoticeAction, null>) {
    if (action === "choose") {
      inputRef.current?.click();
      return;
    }
    onNoticeRun(action);
  }

  return (
    <div ref={panelRef} data-cx="skills-settings" tabIndex={-1}>
      <div data-cx="skills-head">
        <h1 data-cx="settings-title">Skills</h1>
        <button
          ref={uploadRef}
          type="button"
          data-cx="skills-upload"
          aria-busy={busy || library.phase === "loading"}
          disabled={library.phase !== "ready" || busy}
          onClick={() => inputRef.current?.click()}
        >
          Upload
        </button>
        <input
          ref={inputRef}
          data-cx="skills-upload-input"
          type="file"
          accept=".txt,.md"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            if (file !== null) onPickFile(file);
          }}
        />
      </div>

      {library.status !== null ? <output data-cx="skills-status">{library.status}</output> : null}

      {library.phase === "error" ? (
        <div data-cx="skills-notice">
          <ReadErrorNotice
            title="Could not load skills."
            message={library.loadError}
            actionLabel="Retry"
            onReload={library.reload}
            focusTarget={panelRef}
          />
        </div>
      ) : null}

      {library.notice !== null ? (
        <div data-cx="skills-notice">
          <NoticeView notice={library.notice} runNotice={runNotice} />
          {unsettled !== null ? (
            <button
              type="button"
              data-cx="skills-cancel-upload"
              aria-label={`Cancel upload: ${unsettled.filename}`}
              disabled={busy}
              onClick={() => library.cancelUpload(unsettled.uploadId)}
            >
              Cancel upload
            </button>
          ) : null}
        </div>
      ) : null}

      {library.phase === "ready" && library.files.length > 0 ? (
        <ul data-cx="skills-rows">
          {library.files.map((file) => (
            <li key={file.id} data-cx="skills-row">
              <div data-cx="skills-row-main">
                <span data-cx="skills-filename">{file.filename}</span>
                <button
                  type="button"
                  data-cx="skills-download"
                  aria-label={`Download ${file.filename}`}
                  aria-busy={library.listStale || library.downloadVersion === file.version}
                  disabled={library.listStale || library.downloadVersion !== null}
                  onClick={() => void library.download(file)}
                >
                  Download
                </button>
              </div>
              {failure !== null && failure.file.id === file.id ? (
                <ErrorNotice
                  title="Download failed."
                  message={failure.message}
                  action={{
                    label: "Retry",
                    onClick: () => void library.download(file),
                    disabled: library.listStale || library.downloadVersion !== null,
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {library.phase === "ready" && library.files.length === 0 && !library.listStale ? (
        <output data-cx="skills-status">No skills yet.</output>
      ) : null}

      {library.conflict !== null ? (
        <SkillsReplaceDialog
          filename={library.conflict.current.filename}
          stale={library.conflict.stale}
          onCancel={library.cancelReplace}
          onReplace={library.confirmReplace}
          returnFocusRef={uploadRef}
          fallbackFocusRef={panelRef}
        />
      ) : null}
    </div>
  );
}

export default function SkillsSettings({ userId }: { userId: string }) {
  const library = useSkillsLibrary(userId);
  return (
    <SkillsSettingsView
      library={library}
      onPickFile={(file) => void library.selectFile(file)}
      onNoticeRun={library.runNotice}
    />
  );
}
