/**
 * One monotonic saved profile per signed-in workspace. Reload identity fences
 * requests, not accepted data; an older GET cannot undo a confirmed publication.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { errorMessage, getProfile, profilePhotoUrl, type ProfileView } from "@/lib/account-api";
import type { DashboardUser } from "./model";

type Recorded = { readonly ownerId: string; readonly profile: ProfileView };
type Failure = { readonly key: string; readonly message: string };
type AccountProfileState = {
  readonly saved: ProfileView | null;
  readonly displayName: string;
  readonly photoUrl: string | null;
  readonly initials: string;
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
  readonly reload: () => void;
  /** False when a newer same-owner snapshot is already accepted. */
  readonly applySaved: (profile: ProfileView) => boolean;
};

const AccountProfileContext = createContext<AccountProfileState | null>(null);

export function initialsOf(displayName: string, email: string): string {
  const name = displayName.trim();
  const words = name.split(/\s+/).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`
      : (name || email || "User").slice(0, 2)
  ).toUpperCase();
}

export function AccountProfileProvider({
  user,
  children,
}: {
  user: DashboardUser;
  children: ReactNode;
}) {
  const [record, setRecord] = useState<Recorded | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const accepted = useRef<Recorded | null>(null);
  const acceptanceEpoch = useRef(0);
  const requestKey = `${user.id}:${reloadKey}`;

  const applySaved = useCallback(
    (profile: ProfileView): boolean => {
      const previous = accepted.current;
      if (previous?.ownerId === user.id && profile.revision < previous.profile.revision)
        return false;
      const next = { ownerId: user.id, profile };
      accepted.current = next;
      acceptanceEpoch.current += 1;
      setRecord(next);
      setFailure(null);
      return true;
    },
    [user.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    const epoch = acceptanceEpoch.current;
    let active = true;
    void (async () => {
      try {
        const profile = await getProfile(controller.signal);
        if (!active) return;
        applySaved(profile);
      } catch (cause) {
        if (!active || controller.signal.aborted || epoch !== acceptanceEpoch.current) return;
        setFailure({ key: requestKey, message: errorMessage(cause) });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [requestKey, applySaved]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  const saved = record?.ownerId === user.id ? record.profile : null;
  const error = failure?.key === requestKey ? failure.message : null;
  const value = useMemo<AccountProfileState>(() => {
    const displayName = saved?.displayName ?? user.name;
    return {
      saved,
      displayName,
      photoUrl:
        saved !== null && saved.avatar.kind === "photo"
          ? profilePhotoUrl(saved.avatar.avatarId)
          : null,
      initials: initialsOf(displayName, user.email),
      status: saved !== null ? "ready" : error !== null ? "error" : "loading",
      error,
      reload,
      applySaved,
    };
  }, [saved, error, reload, applySaved, user.name, user.email]);

  return <AccountProfileContext.Provider value={value}>{children}</AccountProfileContext.Provider>;
}

export function useAccountProfile(): AccountProfileState {
  const value = useContext(AccountProfileContext);
  if (!value) throw new Error("useAccountProfile requires AccountProfileProvider");
  return value;
}
