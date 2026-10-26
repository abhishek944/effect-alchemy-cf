import {
  $applyNodeReplacement,
  $createTextNode,
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
} from "lexical";
import type { ChatReferenceInput } from "@starter/office-contract";
import type { ReferenceValue } from "./reference-types";
import type { SavedFile } from "@/lib/chat-library-types";

/** Atomic token identity lives in the editor node/history, never in filename-shaped text. */
export class ReferenceNode extends TextNode {
  referenceInput: ChatReferenceInput;
  originalFile: SavedFile | undefined;
  static getType(): string {
    return "reference";
  }
  static clone(node: ReferenceNode): ReferenceNode {
    return new ReferenceNode(node.getTextContent(), node.getInput(), node.getFile(), node.getKey());
  }
  constructor(text: string, input: ChatReferenceInput, file?: SavedFile, key?: NodeKey) {
    super(text, key);
    this.referenceInput = input;
    this.originalFile = file;
  }
  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.dataset.cx = "inline-reference";
    element.title = this.getTextContent();
    return element;
  }
  exportJSON(): SerializedTextNode {
    // Serialized/copied text does not carry authority; library history clones live nodes.
    return { ...super.exportJSON(), type: "reference" };
  }
  static importJSON(serialized: SerializedTextNode): TextNode {
    return $createTextNode(serialized.text);
  }
  isTextEntity(): boolean {
    return true;
  }
  canInsertTextBefore(): boolean {
    return false;
  }
  canInsertTextAfter(): boolean {
    return false;
  }
  getFile(): SavedFile | undefined {
    return this.getLatest().originalFile;
  }
  getInput(): ChatReferenceInput {
    return this.getLatest().referenceInput;
  }
}
export function $createReferenceNode(value: ReferenceValue): ReferenceNode {
  return $applyNodeReplacement(new ReferenceNode(value.label, value.input, value.file)).setMode(
    "token",
  );
}
export function $isReferenceNode(node: LexicalNode | null | undefined): node is ReferenceNode {
  return node instanceof ReferenceNode;
}
