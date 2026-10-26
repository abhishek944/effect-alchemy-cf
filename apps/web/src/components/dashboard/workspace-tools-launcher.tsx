import { useLayoutEffect, useRef } from "react";
import { useWorkspacePreview } from "./workspace-preview-context";
import { Icon } from "./icon";

/** Plus and last-close land here without touching drafts, work or stored bytes. */
export function WorkspaceToolsLauncher() {
  const preview = useWorkspacePreview();
  const launcher = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (preview.focus.target === "tools" && preview.focus.sequence > 0) launcher.current?.focus();
  }, [preview.focus.target, preview.focus.sequence]);
  return (
    <section data-cx="workspace-tools" aria-label="Tools">
      <h2>Tools</h2>
      <button ref={launcher} type="button" onClick={preview.showFiles}>
        <Icon name="folder-closed" />
        <span>Files</span>
      </button>
    </section>
  );
}
