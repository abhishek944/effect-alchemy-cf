import type { ReactNode } from "react";
import "./chat-notice-lane.css";

/** A persistent scan location; content owners retain their own errors and actions. */
export default function ChatNoticeLane({ children }: { children: ReactNode }) {
  return (
    // Keyboard users can scroll this bounded region even when no recovery button exists.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <section data-cx="chat-notice-lane" aria-label="Chat notices" tabIndex={0}>
      <div data-cx="chat-notice-content">{children}</div>
    </section>
  );
}
