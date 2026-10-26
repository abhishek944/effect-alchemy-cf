import { isRecord, isText } from "./chat-validate-base";

/** Immutable descriptive display only; never a native selector or permission. */
export type ChatInputSelection = { name: string; scope: string; quote: string | null };

export function parseInputSelections(value: unknown): ChatInputSelection[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) return null;
  const selections: ChatInputSelection[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isText(item.name) || !isText(item.scope)) return null;
    if (item.quote !== null && !isText(item.quote)) return null;
    selections.push({ name: item.name, scope: item.scope, quote: item.quote });
  }
  return selections;
}
