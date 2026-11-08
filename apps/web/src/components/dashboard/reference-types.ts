import type { ChatReferenceInput } from "@highchat/chat-contract";
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
  Readonly<{
    kind: "original";
    file: SavedFile;
    reveal: (capture: OriginalTextCapture | null) => Promise<void>;
  }>;
export type ReferenceObservation = Readonly<{
  chatId: string;
  sourceKey: string;
  captureId: string;
  display?: Readonly<{ label: string; fileKind: string }>;
}> &
  Readonly<{ kind: "original"; capture: OriginalTextCapture }>;
export type ReferenceEditorBinding = {
  /** Freezes the current caret and draft before an asynchronous source checkpoint. */
  remember: (replace?: { start: number; end: number }) => (value: ReferenceValue) => void;
  read: () => Readonly<{
    text: string;
    inputs: readonly ChatReferenceInput[];
    files: readonly SavedFile[];
  }>;
};

export const originalReferenceKey = (fileId: string): string => `original:${fileId}`;
