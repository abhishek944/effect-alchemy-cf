import { useEffect, useState } from "react";
import type { OfficeChannel, View } from "@starter/office-contract";
import { OfficeNativeEditor } from "./editor.tsx";
import type { NativeTheme, NativeUser } from "./frame/messages.ts";
import type { OfficeRuntime } from "./runtime.ts";

type Props = OfficeRuntime & {
  readonly view: View;
  readonly user: NativeUser;
  readonly theme: NativeTheme;
  readonly frameUrl: string;
};
type State = { kind: "loading" } | { kind: "ready"; channel: OfficeChannel } | { kind: "error" };

/** Real authenticated channel for an exact read-only View, never an alias of View.id. */
export function ReviewNative(props: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const { client, run, view } = props;
  useEffect(() => {
    const active = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ kind: "loading" });
    const fail = () => {
      if (active.signal.aborted) return;
      setState({ kind: "error" });
    };
    if (view.mode !== "read-only" || view.nativeTarget.kind !== "pinned-snapshot") fail();
    else {
      void run(client.office.channel({ payload: { viewId: view.id, editorId: null } }), {
        signal: active.signal,
      })
        .then((channel) => {
          if (active.signal.aborted) return undefined;
          if (channel.expiresAt <= Date.now() || channel.expiresAt > view.expiresAt) {
            fail();
            return undefined;
          }
          setState({ kind: "ready", channel });
          timer = setTimeout(fail, Math.max(0, channel.expiresAt - Date.now()));
          return undefined;
        })
        .catch(fail);
    }
    return () => {
      active.abort();
      clearTimeout(timer);
    };
  }, [client, run, view.id, view.expiresAt, view.mode, view.nativeTarget.kind, attempt]);
  if (state.kind === "loading")
    return <output data-office="notice">Opening exact native view…</output>;
  if (state.kind === "error")
    return (
      <div data-office="notice" role="alert">
        This exact view is unavailable or its channel expired. Review evidence, not this render,
        decides approval.
        <button
          type="button"
          disabled={view.expiresAt <= Date.now()}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Reconnect exact view
        </button>
      </div>
    );
  return (
    <OfficeNativeEditor
      view={view}
      user={props.user}
      theme={props.theme}
      frameUrl={props.frameUrl}
      channelId={state.channel.channelId}
      onStatus={(status) => {
        if (Date.now() >= state.channel.expiresAt || Date.now() >= view.expiresAt)
          setState({ kind: "error" });
        else if (status === "error") setState({ kind: "error" });
      }}
    />
  );
}
