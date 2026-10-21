import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

type DraftFocus = { register: (input: HTMLTextAreaElement | null) => void; focus: () => void };
const Context = createContext<DraftFocus | null>(null);

/** Native draft focus/caret only; selecting an immutable reference never edits or submits text. */
export function ChatReferenceFocusProvider({ children }: { children: ReactNode }) {
  const input = useRef<HTMLTextAreaElement | null>(null);
  const register = useCallback((node: HTMLTextAreaElement | null) => {
    input.current = node;
  }, []);
  const focus = useCallback(() => {
    const node = input.current;
    if (!node?.isConnected) return;
    const { selectionStart, selectionEnd, selectionDirection } = node;
    node.focus({ preventScroll: true });
    node.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  }, []);
  const value = useMemo(() => ({ register, focus }), [register, focus]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChatReferenceFocus(): DraftFocus {
  const value = useContext(Context);
  if (!value) throw new Error("Draft focus requires the selected conversation provider.");
  return value;
}
