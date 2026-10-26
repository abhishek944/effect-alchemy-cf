import { useEffect, useRef, useState } from "react";
import type { Receipt, Target } from "@starter/office-contract";
import type {
  OfficeActionAdmission,
  OfficeEditorHandle,
  OfficeRuntime,
} from "@starter/office-react";
import { captureOfficeCheckpoint } from "@/lib/office-anchor";
import {
  isOfficeExportArtifact,
  officeExportFailedPhases,
  officeExportFilename,
  startOfficeExportDownload,
  type OfficeExportFormat,
} from "@/lib/office-export";
import type { OpenOffice } from "@/lib/office-runtime";

type Attempt = { readonly operationId: string; readonly format: OfficeExportFormat };
type Link = { artifactId: string; filename: string; format: OfficeExportFormat };

export type OfficeExportControlsProps = OfficeRuntime &
  OfficeActionAdmission & {
    readonly target: Target;
    readonly opened: OpenOffice;
    readonly handle: OfficeEditorHandle | null;
    readonly ready: boolean;
    readonly title: string;
    readonly onOperation: (operationId: string) => void;
    readonly onReceipt: (receipt: Receipt) => void;
    readonly onBusy?: (busy: boolean) => void;
  };
/** Host owns admission, holds, leave guards and resume; this control never drains an editor. */
function ExportControlSurface(props: OfficeExportControlsProps) {
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [observe, setObserve] = useState(false);
  const [link, setLink] = useState<Link | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => () => controller.current?.abort(), []);
  const opened = props.opened;
  const handle = props.handle;
  const { editor } = opened;
  if (!props.ready || opened.view.kind !== "doc" || opened.view.mode !== "edit") return null;
  if (editor === null || handle === null) return null;
  const accept = (receipt: Receipt): string => {
    const current = attempt.current;
    if (current === null || receipt.kind !== "export")
      throw new Error("Export receipt identity mismatch.");
    if (
      receipt.operationId !== current.operationId ||
      receipt.documentId !== opened.view.documentId
    )
      throw new Error("Export receipt identity or document mismatch.");
    if (receipt.phase === "confirmed") {
      const artifact = receipt.artifact;
      if (!isOfficeExportArtifact(artifact, current.format))
        throw new Error("The confirmed export did not return the expected file.");
      props.onReceipt(receipt);
      attempt.current = null;
      setObserve(false);
      const filename = officeExportFilename(props.title, current.format);
      setLink({ artifactId: artifact.id, filename, format: current.format });
      startOfficeExportDownload(artifact.id, filename);
      return `${current.format.toUpperCase()} export ready. If no download started, use the link below.`;
    }
    props.onReceipt(receipt);
    if (officeExportFailedPhases.has(receipt.phase)) {
      attempt.current = null;
      setObserve(false);
      return (
        receipt.error?.message ??
        `Export ${receipt.phase}. Nothing was submitted; choose a format to try again.`
      );
    }
    return `Export ${receipt.phase}. Check the same operation; do not submit another export.`;
  };
  const act = async (mode: { kind: "submit"; format: OfficeExportFormat } | { kind: "check" }) => {
    const current = attempt.current;
    if (controller.current !== null || props.disabled) return;
    if (mode.kind === "check" ? current === null : observe || current !== null) return;
    const release = props.admit?.();
    if (props.admit !== undefined && typeof release !== "function") return;
    const active = new AbortController();
    controller.current = active;
    props.onBusy?.(true);
    setBusy(true);
    setMessage("");
    let settled = "";
    let resumed = true;
    try {
      if (mode.kind === "check" && current !== null) {
        settled = accept(
          await props.run(
            props.client.office.receipt({ params: { operationId: current.operationId } }),
            { signal: active.signal },
          ),
        );
      } else if (mode.kind === "submit") {
        const acknowledged = await handle.hold();
        try {
          const checkpoint = await captureOfficeCheckpoint(
            props,
            props.target,
            opened,
            acknowledged,
            active.signal,
          );
          if (active.signal.aborted) return;
          const operationId = crypto.randomUUID();
          attempt.current = { operationId, format: mode.format };
          props.onOperation(operationId);
          setObserve(true);
          settled = accept(
            await props.run(
              props.client.office.export({
                payload: {
                  operationId,
                  viewId: checkpoint.id,
                  options: { kind: "doc", format: mode.format },
                },
              }),
              { signal: active.signal },
            ),
          );
        } finally {
          // Release only our temporary hold; a failed save stays visible, never a terminal drain.
          if (editor.state === "active")
            await handle.resume().catch(() => {
              resumed = false;
            });
        }
        if (!resumed)
          settled =
            `${settled} Editor input could not be released; use Resume saved editor.`.trim();
      }
    } catch {
      if (!active.signal.aborted)
        settled =
          attempt.current === null
            ? "The export checkpoint is unconfirmed. Keep this editor open and retry."
            : "Export outcome unconfirmed. Check the original operation; do not submit another export.";
    } finally {
      controller.current = null;
      props.onBusy?.(false);
      release?.();
      if (!active.signal.aborted) {
        setBusy(false);
        setMessage(settled);
      }
    }
  };
  return (
    <div data-cx="office-export">
      <span>Export</span>
      {(["docx", "txt"] as const).map((format) => (
        <button
          key={format}
          type="button"
          disabled={busy || props.disabled || observe}
          onClick={(event) => {
            if (event.isTrusted) void act({ kind: "submit", format });
          }}
        >
          Download {format.toUpperCase()}
        </button>
      ))}
      <span>TXT keeps main-body text only; formatting and images are dropped.</span>
      {link !== null && (
        <a
          href={`/api/office/artifacts/${encodeURIComponent(link.artifactId)}/bytes`}
          download={link.filename}
        >
          Download {link.format.toUpperCase()}
        </a>
      )}
      {observe && (
        <button
          type="button"
          disabled={busy || props.disabled}
          onClick={(event) => {
            if (event.isTrusted) void act({ kind: "check" });
          }}
        >
          Check export operation
        </button>
      )}
      <output aria-live="polite">{message}</output>
    </div>
  );
}
export function OfficeExportControls(props: OfficeExportControlsProps) {
  return (
    <ExportControlSurface
      key={`${props.opened.view.id}:${props.opened.editor?.id ?? ""}`}
      {...props}
    />
  );
}
