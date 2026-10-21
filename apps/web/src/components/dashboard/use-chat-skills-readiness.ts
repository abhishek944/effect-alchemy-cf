import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/chat-api";
import { getSkillReadiness } from "@/lib/chat-skills-readiness-api";

type State = {
  chatId: string;
  status: "unknown" | "ready" | "unavailable";
  message: string;
  checking: boolean;
};

/**
 * Known-unavailable gate for the composer: a verified readiness probe runs when
 * the chat becomes active, and a blocked Send re-runs it so recovery is
 * verified rather than assumed. Unknown never blocks by itself.
 */
export function useChatSkillsReadiness(chatId: string, enabled: boolean) {
  const [state, setState] = useState<State>({
    chatId,
    status: "unknown",
    message: "",
    checking: false,
  });
  const generation = useRef(0);
  const check = useCallback(async (): Promise<void> => {
    const attempt = ++generation.current;
    if (!enabled || chatId.length === 0) return;
    setState((current) =>
      current.chatId === chatId
        ? { ...current, checking: true }
        : { chatId, status: "unknown", message: "", checking: true },
    );
    try {
      const readiness = await getSkillReadiness(chatId);
      if (attempt !== generation.current) return;
      setState({
        chatId,
        status: readiness.ready ? "ready" : "unavailable",
        message: readiness.ready ? "" : readiness.message,
        checking: false,
      });
    } catch (error) {
      if (attempt !== generation.current) return;
      setState({ chatId, status: "unavailable", message: errorMessage(error), checking: false });
    }
  }, [chatId, enabled]);

  useEffect(() => {
    generation.current += 1;
    // Deferred probe: the effect never sets state synchronously.
    const timer = enabled && chatId.length > 0 ? setTimeout(() => void check(), 0) : null;
    return () => {
      if (timer !== null) clearTimeout(timer);
      generation.current += 1;
    };
  }, [chatId, enabled, check]);

  const current =
    enabled && state.chatId === chatId
      ? state
      : { chatId, status: "unknown" as const, message: "", checking: false };
  return {
    status: current.status,
    message: current.message,
    checking: current.checking,
    blockedReason:
      current.status === "unavailable"
        ? current.message || "Skills are temporarily unavailable. Try again shortly."
        : null,
    recheck: check,
  };
}
