import type { ChatReferenceInput, OfficeSendTarget } from "@starter/office-contract";
import type { NativeSelectionCapture } from "@starter/office-react";
import type { SavedFile } from "@/lib/chat-library-types";

export type ReferenceValue = Readonly<{
  label: string;
  input: ChatReferenceInput;
  file?: SavedFile;
}>;

export type OriginalTextCapture = Readonly<{
  captureId: string;
  start: number;
  end: number;
  text: string;
  label: string;
}>;
export type ReferenceSource = Readonly<{ chatId: string; key: string; name: string }> &
  (
    | Readonly<{
        kind: "original";
        file: SavedFile;
        reveal: (capture: OriginalTextCapture | null) => Promise<void>;
      }>
    | Readonly<{
        kind: "native";
        target: OfficeSendTarget;
        /** Parent owns hold/ACK/exact checkpoint, post-checkpoint validation and safe resume. */
        prepare: (capture: NativeSelectionCapture | null) => Promise<OfficeSendTarget>;
        /** Parent activates the exact source, then verifies and reveals the captured SDK scope. */
        reveal: (capture: NativeSelectionCapture | null) => Promise<void>;
      }>
  );
export type ReferenceObservation = Readonly<{
  chatId: string;
  sourceKey: string;
  captureId: string;
  display?: Readonly<{ label: string; fileKind: string }>;
}> &
  (
    | Readonly<{ kind: "original"; capture: OriginalTextCapture }>
    | Readonly<{ kind: "native"; capture: NativeSelectionCapture }>
  );
export type ReferenceEditorBinding = {
  /** Freezes the current caret and draft before an asynchronous source checkpoint. */
  remember: (replace?: { start: number; end: number }) => (value: ReferenceValue) => void;
  read: () => Readonly<{
    text: string;
    inputs: readonly ChatReferenceInput[];
    files: readonly SavedFile[];
  }>;
};

/** A new checkpoint/view of one native source must not create another tray entry. */
export function nativeReferenceKey(target: OfficeSendTarget): string {
  return JSON.stringify([
    "native",
    target.documentId,
    target.kind,
    ...(target.kind === "draft" ? [target.draftId, target.generation] : []),
  ]);
}
export const originalReferenceKey = (fileId: string): string => `original:${fileId}`;
