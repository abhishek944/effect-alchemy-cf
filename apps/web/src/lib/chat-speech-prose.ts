/**
 * Read-aloud prose extraction and bounded ordered chunking.
 *
 * Only complete loaded reply text is planned: fenced code and raw destinations
 * are skipped with a visible flag, headings/prose/lists/link labels are spoken,
 * and long content becomes ordered bounded chunks instead of a silent prefix.
 * Splitting happens at sentence or word boundaries and never drops content.
 */
import { SPEECH_CHUNK_TARGET_CHARS } from "@/lib/chat-capability-speech-types";

export type SpeechPlan = {
  readonly chunks: readonly string[];
  readonly skippedCode: boolean;
};

export const speakableProse = (
  markdown: string,
): { readonly text: string; readonly skippedCode: boolean } => {
  const kept: string[] = [];
  let fence = false;
  let skippedCode = false;
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    const marker = /^(`{3,}|~{3,})/.test(trimmed);
    if (!fence && marker) {
      fence = true;
      skippedCode = true;
      continue;
    }
    if (fence) {
      if (marker) fence = false;
      continue;
    }
    kept.push(line);
  }
  const text = kept
    .join("\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<https?:\/\/[^>]*>/gi, " ")
    .replace(/https?:\/\/[^\s)]+/gi, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, skippedCode };
};

const sentencesOf = (text: string): string[] => {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (".!?\u2026".includes(text[index] ?? "")) {
      const sentence = text.slice(start, index + 1).trim();
      if (sentence !== "") sentences.push(sentence);
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail !== "") sentences.push(tail);
  return sentences;
};

/** Splits an over-long sentence at word boundaries; never drops content. */
const splitLong = (sentence: string, target: number): string[] => {
  const pieces: string[] = [];
  let current = "";
  for (const word of sentence.split(" ")) {
    if (word.length > target) {
      if (current !== "") pieces.push(current);
      current = "";
      for (let index = 0; index < word.length; index += target)
        pieces.push(word.slice(index, index + target));
      continue;
    }
    if (current !== "" && current.length + word.length + 1 > target) {
      pieces.push(current);
      current = word;
    } else {
      current = current === "" ? word : `${current} ${word}`;
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
};

export const chunkText = (text: string, target: number): string[] => {
  const chunks: string[] = [];
  let current = "";
  const push = (): void => {
    const value = current.trim();
    if (value !== "") chunks.push(value);
    current = "";
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    const normalized = paragraph.replace(/\s+/g, " ").trim();
    if (normalized === "") continue;
    for (const sentence of sentencesOf(normalized)) {
      const units = sentence.length > target ? splitLong(sentence, target) : [sentence];
      for (const unit of units) {
        if (current !== "" && current.length + unit.length + 1 > target) push();
        current = current === "" ? unit : `${current} ${unit}`;
      }
    }
  }
  push();
  return chunks;
};

export const planSpeech = (markdown: string): SpeechPlan => {
  const prose = speakableProse(markdown);
  return {
    chunks: chunkText(prose.text, SPEECH_CHUNK_TARGET_CHARS),
    skippedCode: prose.skippedCode,
  };
};
