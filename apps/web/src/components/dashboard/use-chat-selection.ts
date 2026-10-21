import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { chatIdFromPath, chatPath, isChatLanding } from "@/lib/chat-route";
import { navigate } from "@/lib/router";
import { requestLeave } from "./account-leave-guard";

function selectedChat(pathname: string, remembered: string | null): string | null {
  const requested = chatIdFromPath(pathname);
  const keep =
    isChatLanding(pathname) || pathname === "/settings" || pathname.startsWith("/settings/");
  return requested ?? (keep ? remembered : null);
}

/** URL owns explicit selection; Settings keeps the last chat and its draft alive. */
export function useChatSelection(pathname: string) {
  const [selection, setSelection] = useState(() => ({
    id: chatIdFromPath(pathname),
    remembered: chatIdFromPath(pathname),
    generation: 0,
  }));
  const requested = selectedChat(pathname, selection.remembered);
  if (requested !== selection.id) {
    setSelection({
      id: requested,
      remembered: requested ?? selection.remembered,
      generation: selection.generation + 1,
    });
  }
  const selectionRef = useRef<string | null>(selection.id);
  useLayoutEffect(() => {
    const sync = () => {
      selectionRef.current = selectedChat(window.location.pathname, selection.remembered);
    };
    // Fence stale send/retry callbacks in the navigation event, before the next render.
    if (pathname === window.location.pathname) sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [pathname, selection.remembered]);

  const select = useCallback((id: string | null) => {
    const path = id ? chatPath(id) : "/dashboard";
    if (window.location.pathname === path && selectionRef.current === id) return;
    const action = () => {
      selectionRef.current = id;
      setSelection((current) => ({ id, remembered: id, generation: current.generation + 1 }));
      navigate(path);
    };
    if (requestLeave({ intent: { kind: "route", path, via: "link" }, action })) action();
  }, []);
  return { selectedId: selection.id, generation: selection.generation, selectionRef, select };
}
