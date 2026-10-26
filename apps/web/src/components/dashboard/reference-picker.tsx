import { useId, useState, type KeyboardEvent } from "react";
import type { SavedFile } from "@/lib/chat-library-types";
import { useChatReferencesLookup } from "./use-chat-references-lookup";
import { referenceToken, type ReferenceDraft } from "./chat-reference-draft";
import { useReferenceWorkspace } from "./reference-workspace";
import {
  originalReferenceKey,
  type ReferenceSource,
  type ReferenceObservation,
} from "./reference-types";
import { observationLabel } from "./reference-admission";

type Choice = {
  id: string;
  label: string;
  source: ReferenceSource;
  observation: ReferenceObservation | null;
};
export function useReferencePicker({
  chatId,
  draft,
  enabled,
  revealOriginal,
  report,
}: {
  chatId: string;
  draft: ReferenceDraft;
  enabled: boolean;
  revealOriginal: (file: SavedFile) => void;
  report: (message: string) => void;
}) {
  const workspace = useReferenceWorkspace();
  const token = referenceToken(draft);
  const key = JSON.stringify([chatId, draft]);
  const [dismissed, setDismissed] = useState("");
  const [index, setIndex] = useState(0);
  const overlapsToken =
    token !== null &&
    workspace
      .editor(chatId)
      ?.read()
      .inputs.some((input) => token.start < input.end && token.end > input.start);
  const open = enabled && token !== null && !overlapsToken && dismissed !== key;
  const lookup = useChatReferencesLookup(chatId, open ? token.query : null);
  const listId = useId();
  const query = token?.query.toLocaleLowerCase() ?? "";
  const native = workspace
    .sources(chatId)
    .filter(
      (source) => source.kind === "native" && source.name.toLocaleLowerCase().includes(query),
    );
  const choices: Choice[] = native.flatMap((source) => {
    const observation = workspace
      .observations(chatId)
      .find((item) => item.sourceKey === source.key);
    return [
      { id: source.key, label: `${source.name} · Whole document`, source, observation: null },
      ...(observation
        ? [
            {
              id: observation.captureId,
              label: observationLabel(source, observation),
              source,
              observation,
            },
          ]
        : []),
    ];
  });
  for (const file of lookup.files) {
    if (file.state !== "ready") continue;
    choices.push({
      id: file.id,
      label: file.name,
      observation: null,
      source: {
        kind: "original",
        key: originalReferenceKey(file.id),
        name: file.name,
        file,
        chatId,
        reveal: async () => {
          revealOriginal(file);
        },
      },
    });
  }
  const activeIndex = Math.min(index, Math.max(0, choices.length - 1));
  const choose = (choice: Choice) => {
    if (!token || !open) return;
    setDismissed(key);
    void workspace
      .add(choice.source, choice.observation, token)
      .catch((error: unknown) =>
        report(error instanceof Error ? error.message : "Reference unavailable."),
      );
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !open ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      (event.key === "Enter" && event.shiftKey)
    )
      return;
    if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setDismissed(key);
      return;
    }
    if (event.key === "Enter") {
      if (choices[activeIndex]) choose(choices[activeIndex]);
      return;
    }
    setIndex(
      (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
        Math.max(1, choices.length),
    );
  };
  return {
    open,
    lookup,
    choices,
    choose,
    listId,
    activeIndex,
    setIndex,
    dismiss: () => setDismissed(key),
    inputProps: {
      role: "combobox",
      "aria-autocomplete": "list" as const,
      "aria-expanded": open,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open && choices.length ? `${listId}-${activeIndex}` : undefined,
      onKeyDownCapture,
    },
  };
}
