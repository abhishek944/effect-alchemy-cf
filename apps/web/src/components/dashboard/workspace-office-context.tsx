import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { OfficeSendTarget } from "@starter/office-contract";
import type { OfficeRuntime, NativeUser } from "@starter/office-react";
import { createOfficeRuntime } from "@/lib/office-runtime";
import { WorkspaceNavigationContext, useWorkspaceNavigation } from "./workspace-navigation";
import { useOfficeBarriers, type OfficePanelGuard } from "./workspace-office-barriers";
import { ACCOUNT_COMMAND, panelKey } from "./workspace-office-scope";
import type { DashboardUser } from "./model";

type WorkspaceOffice = {
  accountId: string;
  runtime: Promise<OfficeRuntime>;
  user: NativeUser;
  setRoot: (element: HTMLElement | null) => void;
  busy: boolean;
  /** True only while this exact file (or an account-wide transition) holds a command. */
  busyFor: (chatId: string, id: string) => boolean;
  notice: string;
  report: (message: string) => void;
  /** Records which chat's tab is active; a hidden workspace can never own this slot. */
  activate: (chatId: string | null, id: string | null) => void;
  /** Which chat's workspace the right pane is actually showing, if any. */
  visibility: (chatId: string | null, showing: boolean) => void;
  register: (chatId: string, id: string, guard: OfficePanelGuard) => () => void;
  publishPending: (chatId: string, id: string, owner: object, pending: boolean) => void;
  transition: (action: () => void) => Promise<boolean>;
  leave: (chatId: string, id: string) => Promise<boolean>;
  /** One admission per chat; the account key conflicts with every chat command. */
  beginCommand: (scope: string) => (() => void) | null;
  prepareSend: (chatId: string, explicitReferences: boolean) => Promise<OfficeSendTarget | null>;
};
const Context = createContext<WorkspaceOffice | null>(null);

/** Owns UI lifetime/selection only. Real sessions, channels and writes remain server-authorized. */
export function WorkspaceOfficeProvider({
  user,
  children,
}: {
  user: DashboardUser;
  children: ReactNode;
}) {
  const [runtime] = useState(() => {
    const promise = createOfficeRuntime();
    void promise.catch(() => undefined); // Observer only; consumers still receive the real rejection.
    return promise;
  });
  const root = useRef<HTMLElement | null>(null);
  const panels = useRef(new Map<string, OfficePanelGuard>());
  const selected = useRef<{ chatId: string; id: string } | null>(null);
  const visible = useRef<{ chatId: string | null; showing: boolean }>({
    chatId: null,
    showing: false,
  });
  const commands = useRef(new Set<string>());
  /** Published membership: a release in one file must re-render its own controls immediately. */
  const [scopes, setScopes] = useState<readonly string[]>([]);
  const [count, setCount] = useState(0);
  const pendingPanels = useRef(new Map<string, object>());
  const [pendingCount, setPendingCount] = useState(0);
  const [notice, report] = useState("");
  const busy = scopes.length > 0;
  const setRoot = useCallback((element: HTMLElement | null) => {
    root.current = element;
  }, []);
  const register = useCallback((chatId: string, id: string, guard: OfficePanelGuard) => {
    const key = panelKey(chatId, id);
    panels.current.set(key, guard);
    setCount([...panels.current.values()].filter((panel) => !panel.readOnly).length);
    return () => {
      if (panels.current.get(key) !== guard) return;
      panels.current.delete(key);
      setCount([...panels.current.values()].filter((panel) => !panel.readOnly).length);
    };
  }, []);
  /** Publishers own pending cleanup: replacing a guard must never erase real unsaved work. */
  const publishPending = useCallback(
    (chatId: string, id: string, owner: object, pending: boolean) => {
      const key = panelKey(chatId, id);
      const current = pendingPanels.current;
      if (pending) current.set(key, owner);
      else if (current.get(key) === owner) current.delete(key);
      else return; // A newer publisher owns this id; a stale cleanup must not clear it.
      setPendingCount(current.size);
    },
    [],
  );
  const activate = useCallback((chatId: string | null, id: string | null) => {
    selected.current = chatId === null || id === null ? null : { chatId, id };
  }, []);
  /** An account command excludes every file command; otherwise only this exact panel serializes. */
  const beginCommand = useCallback((scope: string) => {
    const active = commands.current;
    if (active.has(scope)) return null;
    if (scope === ACCOUNT_COMMAND ? active.size > 0 : active.has(ACCOUNT_COMMAND)) return null;
    active.add(scope);
    setScopes([...active]);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active.delete(scope);
      setScopes([...active]);
    };
  }, []);
  const visibility = useCallback((chatId: string | null, showing: boolean) => {
    visible.current = { chatId, showing };
  }, []);
  const busyFor = useCallback(
    (chatId: string, id: string) =>
      scopes.includes(ACCOUNT_COMMAND) || scopes.includes(panelKey(chatId, id)),
    [scopes],
  );
  const { transition, leave, prepareSend } = useOfficeBarriers({
    beginCommand,
    report,
    panels,
    selected,
    visible,
  });
  const navigation = useWorkspaceNavigation({
    dirty: count > 0 || busy,
    warn: pendingCount > 0 || busy,
    root,
    transition,
  });
  return (
    <Context.Provider
      value={{
        runtime,
        accountId: user.id,
        user: { id: user.id, name: Array.from(user.name).slice(0, 60).join("") },
        setRoot,
        busy,
        busyFor,
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
      <WorkspaceNavigationContext.Provider value={navigation}>
        {children}
      </WorkspaceNavigationContext.Provider>
    </Context.Provider>
  );
}
export function useWorkspaceOffice(): WorkspaceOffice {
  const value = useContext(Context);
  if (value === null) throw new Error("Office workspace requires its authenticated provider.");
  return value;
}
