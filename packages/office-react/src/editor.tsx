import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import type { View } from "@starter/office-contract";
import type { NativeSelectionCapture } from "./capture.ts";
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
  readonly ref?: Ref<OfficeEditorHandle>;
  readonly onStatus?: (status: FrameStatus, revision: number) => void;
  readonly onSelection?: (capture: NativeSelectionCapture) => void;
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
  const publish = useEffectEvent((value: FrameStatus, revision: number) => {
    setStatus(value);
    props.onStatus?.(value, revision);
  });
  const selection = useEffectEvent((capture: NativeSelectionCapture) =>
    props.onSelection?.(capture),
  );
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
    const active = connectOfficeFrame(frame.current, props.frameUrl, input, publish, selection);
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
        prepareCapture: (capture) => handle().prepareCapture(capture),
        validateCapture: (capture) => handle().validateCapture(capture),
        revealCapture: (capture) => handle().revealCapture(capture),
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
      <iframe
        ref={frame}
        title={`${input.view.kind === "sheet" ? "Spreadsheet" : input.view.kind === "doc" ? "Document" : "Presentation"} native ${input.view.mode === "edit" ? "editor" : "read-only result"}`}
        aria-busy={status === "loading"}
      />
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
