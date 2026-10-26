import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

type FocusTarget = HTMLTextAreaElement | (() => void) | null;
type DraftFocus = { register: (input: FocusTarget) => void; focus: () => void };
const Context = createContext<DraftFocus | null>(null);

/** View focus only; Lexical retains its own caret/history and assistant-ui owns draft text. */
export function ChatReferenceFocusProvider({ children }: { children: ReactNode }) {
  const input = useRef<FocusTarget>(null);
  const register = useCallback((node: FocusTarget) => {
    input.current = node;
  }, []);
  const focus = useCallback(() => {
    const node = input.current;
    if (typeof node === "function") {
      node();
      return;
    }
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
