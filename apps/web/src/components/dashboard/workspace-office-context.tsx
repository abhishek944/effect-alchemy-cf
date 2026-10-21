import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { OfficeSendTarget } from "@starter/office-contract";
import type { OfficeRuntime, NativeUser } from "@starter/office-react";
import { createOfficeRuntime } from "@/lib/office-runtime";
import { useUnsavedGuard } from "./use-unsaved-guard";
import type { DashboardUser } from "./model";

export type OfficePanelGuard = {
  readonly chatId: string;
  readonly owner: object;
  readonly readOnly?: boolean;
  readonly prepareToLeave: () => Promise<void>;
  readonly prepareSend: () => Promise<OfficeSendTarget | null>;
};
type WorkspaceOffice = {
  runtime: Promise<OfficeRuntime>;
  user: NativeUser;
  setRoot: (element: HTMLElement | null) => void;
  busy: boolean;
  notice: string;
  report: (message: string) => void;
  activate: (id: string | null) => void;
  visibility: (visible: boolean) => void;
  register: (id: string, guard: OfficePanelGuard) => () => void;
  transition: (action: () => void) => Promise<boolean>;
  beginCommand: () => (() => void) | null;
  prepareSend: (chatId: string) => Promise<OfficeSendTarget | null>;
};
const Context = createContext<WorkspaceOffice | null>(null);

/** Owns UI lifetime/selection only. Real sessions, channels and writes remain server-authorized. */
export function WorkspaceOfficeProvider({
  user,
  active,
  children,
}: {
  user: DashboardUser;
  active: boolean;
  children: ReactNode;
}) {
  const [runtime] = useState(() => {
    const promise = createOfficeRuntime();
    void promise.catch(() => undefined); // Observer only; consumers still receive the real rejection.
    return promise;
  });
  const root = useRef<HTMLElement | null>(null);
  const panels = useRef(new Map<string, OfficePanelGuard>());
  const selected = useRef<string | null>(null);
  const visible = useRef(false);
  const working = useRef(false);
  const navigating = useRef(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, report] = useState("");
  const {
    pending: navigation,
    discard,
    keepEditing,
  } = useUnsavedGuard(active && (count > 0 || busy), root, active);
  const setRoot = useCallback((element: HTMLElement | null) => {
    root.current = element;
  }, []);
  const register = useCallback((id: string, guard: OfficePanelGuard) => {
    panels.current.set(id, guard);
    setCount([...panels.current.values()].filter((panel) => !panel.readOnly).length);
    return () => {
      if (panels.current.get(id) !== guard) return;
      panels.current.delete(id);
      setCount([...panels.current.values()].filter((panel) => !panel.readOnly).length);
    };
  }, []);
  const activate = useCallback((id: string | null) => {
    selected.current = id;
  }, []);
  const beginCommand = useCallback(() => {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      working.current = false;
      setBusy(false);
    };
  }, []);
  const transition = useCallback(
    async (action: () => void): Promise<boolean> => {
      const release = beginCommand();
      if (release === null) {
        report("Finishing an Office save. Keep the editor open and try again.");
        return false;
      }
      report("");
      try {
        const results = await Promise.allSettled(
          [...panels.current.values()].map((panel) =>
            Promise.resolve().then(() => panel.prepareToLeave()),
          ),
        );
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Office saves are unconfirmed.");
        action();
        return true;
      } catch {
        report(
          "Office input or saves are unconfirmed. The editor stays open; finish composition or retry saving.",
        );
        return false;
      } finally {
        release();
      }
    },
    [beginCommand],
  );
  const visibility = useCallback((showing: boolean) => {
    visible.current = showing;
  }, []);
  const prepareSend = useCallback(
    async (chatId: string): Promise<OfficeSendTarget | null> => {
      const id = visible.current ? selected.current : null;
      if (id === null) return null;
      const panel = panels.current.get(id);
      if (panel === undefined || panel.chatId !== chatId)
        throw new Error("Office selection is not ready.");
      const release = beginCommand();
      if (release === null) throw new Error("Finish the Office save before sending.");
      try {
        const target = await panel.prepareSend();
        if (panels.current.get(id)?.owner !== panel.owner || selected.current !== id)
          throw new Error("Office selection changed before Send.");
        return target;
      } finally {
        release();
      }
    },
    [beginCommand],
  );
  useEffect(() => {
    if (navigation === null || navigating.current) return;
    navigating.current = true;
    // Despite the Profile hook's method name, no edit is discarded: actual holds must succeed first.
    void transition(() => discard(() => undefined))
      .then((allowed) => {
        if (!allowed) keepEditing();
        return undefined;
      })
      .finally(() => {
        navigating.current = false;
      });
  }, [navigation, discard, keepEditing, transition]);
  return (
    <Context.Provider
      value={{
        runtime,
        user: { id: user.id, name: Array.from(user.name).slice(0, 60).join("") },
        setRoot,
        busy,
        notice,
        report,
        register,
        activate,
        visibility,
        transition,
        beginCommand,
        prepareSend,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspaceOffice(): WorkspaceOffice {
  const value = useContext(Context);
  if (value === null) throw new Error("Office workspace requires its authenticated provider.");
  return value;
}
