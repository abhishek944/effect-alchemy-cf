import type { Ref } from "react";
import { Icon } from "./icon";
import "./chat-library-tools.css";

export function ChatLibraryTools({
  onOpenFiles,
  buttonRef,
}: {
  onOpenFiles: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <section data-cx="chat-library-tools" aria-label="Tools">
      <h2>Tools</h2>
      <button ref={buttonRef} type="button" onClick={onOpenFiles}>
        <Icon name="folder-closed" />
        <span>Files</span>
      </button>
    </section>
  );
}
