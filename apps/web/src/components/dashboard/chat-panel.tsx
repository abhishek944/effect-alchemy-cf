import { useRef } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import ChatConversation from "./chat-conversation";

/**
 * One conversation component per selected chat, keyed so speech is disposed.
 * `active` is the route visibility: leaving the visible chat keeps drafts and
 * Pi work, and cancels only owned audio resources.
 */
export default function ChatPanel({ active }: { active: boolean }) {
  const { selectedId } = useChatStore();
  const draftsRef = useRef(new Map<string, string>());
  return <ChatConversation key={selectedId ?? "none"} draftsRef={draftsRef} active={active} />;
}
