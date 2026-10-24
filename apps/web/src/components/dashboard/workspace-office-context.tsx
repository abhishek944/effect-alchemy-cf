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
import { useOfficeBarriers, type OfficePanelGuard } from "./workspace-office-barriers";
import type { DashboardUser } from "./model";

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
  publishPending: (id: string, owner: object, pending: boolean) => void;
  transition: (action: () => void) => Promise<boolean>;
  leave: (id: string) => Promise<boolean>;
  beginCommand: () => (() => void) | null;
  prepareSend: (chatId: string, explicitReferences: boolean) => Promise<OfficeSendTarget | null>;
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
  const pendingPanels = useRef(new Map<string, object>());
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, report] = useState("");
  const {
    pending: navigation,
    discard,
    keepEditing,
  } = useUnsavedGuard(
    active && (count > 0 || busy),
    root,
    active,
    active && (pendingCount > 0 || busy),
  );
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
  /** Publishers own pending cleanup: replacing a guard must never erase real unsaved work. */
  const publishPending = useCallback((id: string, owner: object, pending: boolean) => {
    const current = pendingPanels.current;
    if (pending) current.set(id, owner);
    else if (current.get(id) === owner) current.delete(id);
    else return; // A newer publisher owns this id; a stale cleanup must not clear it.
    setPendingCount(current.size);
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
  const visibility = useCallback((showing: boolean) => {
    visible.current = showing;
  }, []);
  const { transition, leave, prepareSend } = useOfficeBarriers({
    beginCommand,
    report,
    panels,
    selected,
    visible,
  });
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
        publishPending,
        activate,
        visibility,
        transition,
        leave,
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
