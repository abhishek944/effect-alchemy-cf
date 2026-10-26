import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalNode,
  type PointType,
} from "lexical";
import { freezeChatReferenceInputs } from "@starter/office-contract";
import { $isReferenceNode } from "./reference-node";
import type { SavedFile } from "@/lib/chat-library-types";

/** PlainTextPlugin creates one paragraph and line-break leaves; UTF-16 lengths match runtime text. */
function $leaves(): LexicalNode[] {
  const output: LexicalNode[] = [];
  const visit = (node: LexicalNode) => {
    if ($isElementNode(node)) node.getChildren().forEach(visit);
    else output.push(node);
  };
  $getRoot().getChildren().forEach(visit);
  return output;
}
function $offset(point: PointType): number {
  let offset = 0;
  const target = point.getNode();
  for (const leaf of $leaves()) {
    if (leaf.is(target)) return offset + point.offset;
    if ($isElementNode(target) && target.isParentOf(leaf)) {
      const children = target.getChildren();
      const before = children.slice(0, point.offset);
      if (
        !before.some((child) => child.is(leaf) || ($isElementNode(child) && child.isParentOf(leaf)))
      )
        return offset;
    }
    offset += leaf.getTextContentSize();
  }
  return offset;
}
export function $readReferenceEditor() {
  const text = $getRoot().getTextContent();
  let offset = 0;
  const inputs = [];
  const files = new Map<string, SavedFile>();
  for (const node of $leaves()) {
    const end = offset + node.getTextContentSize();
    if ($isReferenceNode(node)) {
      inputs.push({ ...node.getInput(), start: offset, end });
      const file = node.getFile();
      if (file) files.set(file.id, file);
    }
    offset = end;
  }
  const selection = $getSelection();
  const start = $isRangeSelection(selection) ? $offset(selection.anchor) : text.length;
  const end = $isRangeSelection(selection) ? $offset(selection.focus) : start;
  return {
    text,
    inputs: freezeChatReferenceInputs(inputs),
    files: Object.freeze([...files.values()]),
    selectionStart: Math.min(start, end),
    selectionEnd: Math.max(start, end),
  };
}
export function $selectReferenceOffsets(start: number, end: number): void {
  const selection = $createRangeSelection();
  const leaves = $leaves();
  const point = (position: number, output: PointType) => {
    let offset = 0;
    for (const node of leaves) {
      const length = node.getTextContentSize();
      if (position <= offset + length) {
        if ($isTextNode(node)) output.set(node.getKey(), position - offset, "text");
        else {
          const parent = node.getParentOrThrow();
          output.set(
            parent.getKey(),
            node.getIndexWithinParent() + (position > offset ? 1 : 0),
            "element",
          );
        }
        return;
      }
      offset += length;
    }
    let paragraph = $getRoot().getFirstChild();
    if (!$isElementNode(paragraph)) {
      paragraph = $createParagraphNode();
      $getRoot().append(paragraph);
    }
    output.set(
      paragraph.getKey(),
      $isElementNode(paragraph) ? paragraph.getChildrenSize() : 0,
      "element",
    );
  };
  point(start, selection.anchor);
  point(end, selection.focus);
  $setSelection(selection);
}

/** Runtime/voice text changes use one minimal edit; unaffected tokens retain their identity. */
export function $projectRuntimeText(next: string): void {
  const previous = $getRoot().getTextContent();
  if (previous === next) return;
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = previous.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  let offset = 0;
  for (const node of $leaves()) {
    const nodeEnd = offset + node.getTextContentSize();
    if ($isReferenceNode(node) && start < nodeEnd && end > offset)
      node.replace($createTextNode(node.getTextContent()));
    offset = nodeEnd;
  }
  $selectReferenceOffsets(start, end);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) selection.insertRawText(next.slice(start, nextEnd));
}
