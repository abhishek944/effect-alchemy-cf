import { useEffect, useRef, useState } from "react";

export function usePanes(chatWorkspace = false) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia("(min-width: 601px)").matches,
  );
  const [chatRightOpen, setChatRightOpen] = useState(
    () => window.matchMedia("(min-width: 761px)").matches,
  );
  const [settingsRightOpen, setSettingsRightOpen] = useState(false);
  const [chatFullView, setChatFullView] = useState(false);
  const [settingsFullView, setSettingsFullView] = useState(false);
  const rightOpen = chatWorkspace ? chatRightOpen : settingsRightOpen;
  const setRightOpen = chatWorkspace ? setChatRightOpen : setSettingsRightOpen;
  const fullView = chatWorkspace ? chatFullView : settingsFullView;
  const setFullView = chatWorkspace ? setChatFullView : setSettingsFullView;
  const workspace = chatWorkspace ? "chat" : "settings";
  const rightRef = useRef<HTMLElement>(null);
  const previousRight = useRef({ chat: false, settings: false });
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!fullView) return undefined;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullView(false);
        setRightOpen(previousRight.current[workspace]);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [fullView, setFullView, setRightOpen, workspace]);
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
    toggleSidebar: () => {
      setFullView(false);
      if (fullView) setRightOpen(previousRight.current[workspace]);
      setSidebarOpen((open) => fullView || !open);
    },
    toggleRight: () => {
      setFullView(false);
      setRightOpen((open) => !open);
    },
    toggleFullView: () => {
      if (fullView) {
        setFullView(false);
        setRightOpen(previousRight.current[workspace]);
      } else {
        previousRight.current[workspace] = rightOpen;
        setRightOpen(true);
        setFullView(true);
      }
    },
  };
}
