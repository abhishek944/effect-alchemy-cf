import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { chatIdFromPath, isChatLanding } from "@/lib/chat-route";
import { settingsSectionFromPath } from "./routes";
import type { LeaveIntent } from "./account-leave-guard";
import { useUnsavedGuard } from "./use-unsaved-guard";

type Participant = {
  owner: object;
  dirty: boolean;
  root: RefObject<HTMLElement | null>;
  draft: object | null;
  publishing: boolean;
};
type ProfileGuard = ReturnType<typeof useUnsavedGuard>;
type Navigation = {
  register: (participant: Participant) => () => void;
  guard: ProfileGuard;
};
export const WorkspaceNavigationContext = createContext<Navigation | null>(null);

/**
 * No route unmounts retained chat workspaces any more: every chat, Settings and Home keep their
 * open editors mounted. Only sign-out still needs the account-wide save/drain transition.
 */
export function retainsOffice(intent: LeaveIntent): boolean {
  if (intent.kind !== "route") return false;
  const path = intent.path.split(/[?#]/)[0] ?? intent.path;
  return (
    settingsSectionFromPath(path) !== null ||
    path === "/settings" ||
    isChatLanding(path) ||
    chatIdFromPath(path) !== null
  );
}

/** One history owner sequences Profile consent before the existing Office barrier. */
export function useWorkspaceNavigation({
  dirty,
  warn,
  root,
  transition,
}: {
  dirty: boolean;
  warn: boolean;
  root: RefObject<HTMLElement | null>;
  transition: (action: () => void) => Promise<boolean>;
}): Navigation {
  const [profile, setProfile] = useState<Participant | null>(null);
  const profileRef = useRef<Participant | null>(null);
  const profileDirty = profile?.dirty ?? false;
  const guard = useUnsavedGuard(
    dirty || profileDirty,
    profile?.root ?? root,
    true,
    warn || profileDirty,
    (intent) => profileDirty || !retainsOffice(intent),
  );
  const processing = useRef(false); // Synchronous admission, before React commits.
  const [waiting, setWaiting] = useState(false); // Reconsider a newer decision after settlement.
  const latest = useRef(guard);
  useLayoutEffect(() => {
    latest.current = guard;
  });
  const register = useCallback((participant: Participant) => {
    profileRef.current = participant;
    setProfile(participant);
    return () => {
      if (profileRef.current !== participant) return;
      profileRef.current = null;
      setProfile((current) => (current === participant ? null : current));
    };
  }, []);
  const discard = (discardDraft: (() => void) | null) => {
    if (discardDraft === null) {
      guard.keepEditing();
      return;
    }
    if (processing.current || guard.pending === null) return;
    const pending = guard.pending;
    const consent = profileRef.current;
    processing.current = true;
    setWaiting(true);
    const commit = () => {
      // Recheck synchronous decision ownership and this exact Profile/draft/publication consent.
      if (!latest.current.isCurrent(pending) || profileRef.current !== consent)
        throw new Error("Navigation or Profile consent changed.");
      latest.current.discard(discardDraft);
    };
    const cancel = () => {
      if (latest.current.isCurrent(pending)) latest.current.keepEditing();
    };
    const needed = dirty && !retainsOffice(pending.intent);
    void (
      needed
        ? transition(commit)
        : Promise.resolve().then(() => {
            commit();
            return true;
          })
    )
      .then((allowed) => {
        if (!allowed) cancel();
        return undefined;
      })
      .catch(cancel)
      .finally(() => {
        processing.current = false;
        setWaiting(false);
      });
  };
  useEffect(() => {
    if (guard.pending !== null && !profileDirty && !waiting && !processing.current)
      discard(() => undefined);
  });
  return { register, guard: { ...guard, discard } };
}

/** Profile supplies a participant, never a second history/popstate/unload observer. */
export function useWorkspaceProfileGuard(
  dirty: boolean,
  root: RefObject<HTMLElement | null>,
  draft: object | null,
  publishing: boolean,
) {
  const navigation = useContext(WorkspaceNavigationContext);
  if (navigation === null) throw new Error("Profile requires workspace navigation.");
  const [owner] = useState(() => ({}));
  const {
    register,
    guard: { cancelPending },
  } = navigation;
  const wasDirty = useRef(dirty);
  useLayoutEffect(() => {
    if (wasDirty.current && !dirty) cancelPending();
    wasDirty.current = dirty;
    return register({ owner, dirty, root, draft, publishing });
  }, [register, owner, dirty, root, draft, publishing, cancelPending]);
  return { ...navigation.guard, pending: dirty ? navigation.guard.pending : null };
}
