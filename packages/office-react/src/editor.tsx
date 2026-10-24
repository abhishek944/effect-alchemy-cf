import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import type { View, Receipt } from "@starter/office-contract";
import {
  FrameInit,
  type FrameStatus,
  type NativeTheme,
  type NativeUser,
} from "./frame/messages.ts";
import { Schema } from "effect";
import { connectOfficeFrame, type OfficeEditorHandle } from "./connection.ts";

export type OfficeNativeEditorProps = {
  readonly view: View;
  readonly user: NativeUser;
  readonly theme: NativeTheme;
  readonly channelId: string;
  readonly frameUrl: string;
  readonly operation?: Receipt | null;
  readonly ref?: Ref<OfficeEditorHandle>;
  readonly onStatus?: (status: FrameStatus, revision: number) => void;
};
function NativeFrame(props: OfficeNativeEditorProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const connection = useRef<ReturnType<typeof connectOfficeFrame> | null>(null);
  // Identity is immutable; only expiry may renew. New owner/branch/epoch needs a fresh View.id.
  const [input] = useState(() =>
    Schema.decodeUnknownSync(FrameInit, { onExcessProperty: "error" })({
      view: props.view,
      user: props.user,
      theme: props.theme,
      channelId: props.channelId,
    }),
  );
  const [status, setStatus] = useState<FrameStatus>("loading");
  const [confirmed, setConfirmed] = useState(input.view.revision);
  const publish = useEffectEvent((value: FrameStatus, revision: number) => {
    setStatus(value);
    if ((value === "saved" || value === "held" || value === "read-only") && revision >= 1)
      setConfirmed(revision);
    props.onStatus?.(value, revision);
  });
  const syncBootstrapHints = useEffectEvent(() => {
    try {
      connection.current?.renew(props.view);
      connection.current?.theme(props.theme);
    } catch {
      publish("error", 0);
    }
  });
  useLayoutEffect(() => {
    syncBootstrapHints();
  }, [props.view, props.view.expiresAt, props.theme]);
  useEffect(() => {
    if (frame.current === null) return undefined;
    const active = connectOfficeFrame(frame.current, props.frameUrl, input, publish);
    connection.current = active;
    syncBootstrapHints();
    return () => {
      connection.current = null;
      active.dispose();
    };
  }, [input, props.frameUrl]);
  useImperativeHandle(
    props.ref,
    () => {
      const handle = () => {
        if (connection.current === null) throw new Error("Office editor is not mounted.");
        return connection.current.handle;
      };
      return {
        hold: () => handle().hold(),
        flush: () => handle().flush(),
        prepareToLeave: () => handle().prepareToLeave(),
        stopInput: () => handle().stopInput(),
        resume: () => handle().resume(),
      };
    },
    [],
  );
  return (
    <div data-office="native" data-office-theme={props.theme} data-save-state={status}>
      {input.view.nativeTarget.kind !== "pinned-snapshot" && (
        <div data-office="scope">
          <strong>
            {input.view.nativeTarget.kind === "draft"
              ? "Draft · Live human + AI edits"
              : "Main · Live"}
          </strong>
          <span>
            {input.view.nativeTarget.kind === "draft" ? "Main unchanged · " : ""}Confirmed r
            {confirmed}
          </span>
        </div>
      )}
      {props.operation?.documentId === input.view.documentId && (
        <output data-office="notice" aria-live="polite">
          Office {props.operation.kind}: {props.operation.phase}
          {props.operation.error ? ` · ${props.operation.error.message}` : ""}
        </output>
      )}
      <iframe
        ref={frame}
        title={`${input.view.kind === "sheet" ? "Spreadsheet" : input.view.kind === "doc" ? "Document" : "Presentation"} native ${input.view.mode === "edit" ? "editor" : "read-only result"}`}
        aria-busy={status === "loading"}
      />
      <output data-office="native-status" aria-live="polite">
        {status === "loading"
          ? "Loading native document…"
          : status === "error"
            ? "Native input or saves are unconfirmed. Keep this editor open."
            : status === "offline"
              ? input.view.mode === "read-only"
                ? "Offline. This view may be out of date."
                : "Offline. Edits are not confirmed saved."
              : status === "conflict"
                ? "Native synchronization needs attention."
                : status === "saving"
                  ? input.view.mode === "read-only"
                    ? "Synchronizing live view…"
                    : "Saving…"
                  : status === "holding"
                    ? "Finishing native input and saving…"
                    : status === "held"
                      ? "Saved · Editing held"
                      : status === "saved"
                        ? "Saved"
                        : input.view.nativeTarget.kind === "pinned-snapshot"
                          ? "Read-only exact result"
                          : "Read-only · Live updates"}
      </output>
    </div>
  );
}
/** Mount inside the host's selected right tool. Host must hold/flush before hiding or switching it. */
export function OfficeNativeEditor(props: OfficeNativeEditorProps) {
  return (
    <NativeFrame
      key={`${props.view.id}:${props.user.id}:${props.channelId}:${props.frameUrl}`}
      {...props}
    />
  );
}
