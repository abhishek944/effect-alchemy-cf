import { useState, type MouseEvent, type KeyboardEvent } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import { useReferenceWorkspace } from "./reference-workspace";
import type { ReferenceObservation, ReferenceSource } from "./reference-types";
import { observationLabel } from "./reference-admission";
import { ReferenceSelectionMenu } from "./reference-selection-menu";
import "./reference-editor.css";

export function ReferenceKindIcon({
  source,
  fileKind,
}: {
  source?: ReferenceSource;
  fileKind?: string;
}) {
  const kind = source
    ? source.kind === "native"
      ? source.target.documentKind
      : source.file.kind === "office" && source.file.name.toLowerCase().endsWith(".xlsx")
        ? "sheet"
        : source.file.kind
    : fileKind;
  return (
    <span data-cx="reference-kind">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "sheet" ? (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 3v18M3 15h18" />
          </>
        ) : kind === "image" ? (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="m4 17 5-5 4 4 3-3 4 4" />
          </>
        ) : kind === "text" ? (
          <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12l-2 2 2 2M14 12l2 2-2 2" />
        ) : (
          <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7" />
        )}
      </svg>
    </span>
  );
}
type Menu = {
  source: ReferenceSource;
  observation: ReferenceObservation;
  anchor: HTMLButtonElement;
};
export function ReferenceTray({ chatId }: { chatId: string }) {
  const workspace = useReferenceWorkspace();
  const store = useChatStore();
  const [menu, setMenu] = useState<Menu | null>(null);
  // Rejections that arrive after a chat switch still belong to this observed chat.
  const report = (error: unknown) =>
    store.reportChatError(
      chatId,
      error instanceof Error ? error.message : "Selection unavailable.",
    );
  const observations = workspace.observations(chatId);
  const open = (
    event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>,
    source: ReferenceSource,
    observation: ReferenceObservation,
  ) => {
    event.preventDefault();
    setMenu({ source, observation, anchor: event.currentTarget });
  };
  if (!observations.length) return null;
  return (
    <>
      <div data-cx="reference-tray" aria-label="Selections across attachments">
        {observations.map((observation) => {
          const source = workspace.source(chatId, observation.sourceKey);
          const label = source
            ? observationLabel(source, observation)
            : (observation.display?.label ?? "Selection source unavailable");
          return (
            <span data-cx="reference-tray-entry" key={observation.sourceKey}>
              <button
                type="button"
                aria-label={`View ${label}`}
                title={label}
                onClick={() => void workspace.view(observation).catch(report)}
                onContextMenu={(event) => {
                  if (source) open(event, source, observation);
                }}
                onKeyDown={(event) => {
                  if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu")
                    if (source) open(event, source, observation);
                }}
              >
                {source ? (
                  <ReferenceKindIcon source={source} />
                ) : (
                  <ReferenceKindIcon fileKind={observation.display?.fileKind ?? "text"} />
                )}
                <span data-cx="selection-label">{label}</span>
              </button>
              <button
                type="button"
                data-cx="reference-close"
                aria-label={`Close ${label}`}
                onClick={() => workspace.close(observation)}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      {menu && (
        <ReferenceSelectionMenu
          anchor={menu.anchor}
          label="Add reference"
          onClose={() => setMenu(null)}
          onChoose={() => {
            const pending = menu;
            setMenu(null);
            void workspace.add(pending.source, pending.observation).catch(report);
          }}
        />
      )}
    </>
  );
}
