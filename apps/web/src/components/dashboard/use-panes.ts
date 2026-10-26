import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import { useWorkspaceOffice } from "./workspace-office-context";
import { readLayout, storePanes } from "./workspace-session";

export function usePanes(chatWorkspace = false) {
  // Visibility never ends a retained native editor's lifetime.
  const { accountId } = useWorkspaceOffice();
  const { selectedId } = useChatStore();
  const initial = () => ({
    chatId: selectedId,
    panes: readLayout(accountId, selectedId)?.panes ?? {
      sidebar: window.matchMedia("(min-width: 601px)").matches,
      right: window.matchMedia("(min-width: 761px)").matches,
      full: false,
      restoreRight: window.matchMedia("(min-width: 761px)").matches,
    },
  });
  const [chatLayout, setChatLayout] = useState(initial);
  if (chatLayout.chatId !== selectedId) setChatLayout(initial());
  useEffect(() => {
    storePanes(accountId, chatLayout.chatId, chatLayout.panes);
  }, [accountId, chatLayout]);
  const field = useCallback(
    (key: "sidebar" | "right" | "full" | "restoreRight", value: SetStateAction<boolean>) => {
      setChatLayout((current) => ({
        ...current,
        panes: {
          ...current.panes,
          [key]: typeof value === "function" ? value(current.panes[key]) : value,
        },
      }));
    },
    [],
  );
  const setChatSidebarOpen = useCallback(
    (value: SetStateAction<boolean>) => field("sidebar", value),
    [field],
  );
  const setChatRightOpen = useCallback(
    (value: SetStateAction<boolean>) => field("right", value),
    [field],
  );
  const setChatFullView = useCallback(
    (value: SetStateAction<boolean>) => field("full", value),
    [field],
  );
  const [settingsSidebarOpen, setSettingsSidebarOpen] = useState(
    () => window.matchMedia("(min-width: 601px)").matches,
  );
  const sidebarOpen = chatWorkspace ? chatLayout.panes.sidebar : settingsSidebarOpen;
  const setSidebarOpen = chatWorkspace ? setChatSidebarOpen : setSettingsSidebarOpen;
  const chatRightOpen = chatLayout.panes.right;
  const chatFullView = chatLayout.panes.full;
  const [settingsRightOpen, setSettingsRightOpen] = useState(false);
  const [settingsFullView, setSettingsFullView] = useState(false);
  const rightOpen = chatWorkspace ? chatRightOpen : settingsRightOpen;
  const setRightOpen = chatWorkspace ? setChatRightOpen : setSettingsRightOpen;
  const openRight = useCallback(() => setRightOpen(true), [setRightOpen]);
  const fullView = chatWorkspace ? chatFullView : settingsFullView;
  const setFullView = chatWorkspace ? setChatFullView : setSettingsFullView;
  const rightRef = useRef<HTMLElement>(null);
  const [settingsRestoreRight, setSettingsRestoreRight] = useState(false);
  const restoreRight = chatWorkspace ? chatLayout.panes.restoreRight : settingsRestoreRight;
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!fullView) return undefined;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullView(false);
        setRightOpen(restoreRight);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [fullView, setFullView, setRightOpen, restoreRight]);
  useEffect(() => {
    if (fullView) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      rightRef.current?.focus();
    } else if (
      rightRef.current?.contains(document.activeElement) ||
      document.activeElement === document.body
    )
      previousFocus.current?.focus();
  }, [fullView]);
  return {
    sidebarOpen,
    rightOpen,
    fullView,
    rightRef,
    openRight,
    toggleSidebar: () => {
      setFullView(false);
      if (fullView) setRightOpen(restoreRight);
      setSidebarOpen((open) => fullView || !open);
    },
    toggleRight: () => {
      setFullView(false);
      setRightOpen((open) => !open);
    },
    toggleFullView: () => {
      if (fullView) {
        setFullView(false);
        setRightOpen(restoreRight);
      } else {
        if (chatWorkspace) field("restoreRight", rightOpen);
        else setSettingsRestoreRight(rightOpen);
        setRightOpen(true);
        setFullView(true);
      }
    },
  };
}
