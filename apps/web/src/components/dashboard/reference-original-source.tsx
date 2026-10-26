import { useEffect, useLayoutEffect, useRef } from "react";
import type { SavedFile } from "@/lib/chat-library-types";
import {
  originalReferenceKey,
  type OriginalTextCapture,
  type ReferenceSource,
} from "./reference-types";
import { useReferenceWorkspace } from "./reference-workspace";

/** Parent may use this for an already loaded original tab; it never fetches, uploads or imports. */
export function useOriginalReferenceSource(
  file: SavedFile | null,
  reveal: (capture: OriginalTextCapture | null) => Promise<void>,
) {
  const { registerSource } = useReferenceWorkspace();
  const latest = useRef(reveal);
  useLayoutEffect(() => {
    latest.current = reveal;
  }, [reveal]);
  useEffect(() => {
    if (!file || file.state !== "ready") return undefined;
    const source: ReferenceSource = {
      kind: "original",
      chatId: file.chatId,
      key: originalReferenceKey(file.id),
      name: file.name,
      file,
      reveal: (capture) => latest.current(capture),
    };
    return registerSource(source);
  }, [file, registerSource]);
}
