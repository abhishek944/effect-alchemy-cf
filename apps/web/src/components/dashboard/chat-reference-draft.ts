export type ReferenceDraft = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

export type ReferenceToken = { start: number; end: number; query: string };

/** A selected range, email address or mid-token @ is not a reference lookup. */
export function referenceToken(draft: ReferenceDraft): ReferenceToken | null {
  const caret = draft.selectionStart;
  if (caret !== draft.selectionEnd || caret < 0 || caret > draft.text.length) return null;
  const prefix = draft.text.slice(0, caret);
  const match = /(?:^|\s)@([^@\n]*)$/u.exec(prefix);
  if (!match) return null;
  return { start: prefix.lastIndexOf("@"), end: caret, query: match[1] ?? "" };
}

/** Removes only the active @ query; every other character and the caret survive. */
export function consumeReferenceToken(
  draft: ReferenceDraft,
  token: ReferenceToken,
): ReferenceDraft {
  return {
    text: draft.text.slice(0, token.start) + draft.text.slice(token.end),
    selectionStart: token.start,
    selectionEnd: token.start,
  };
}
