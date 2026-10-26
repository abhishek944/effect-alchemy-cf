/** Internal drag transports a lookup key only, never document authority or a captured payload. */
export const REFERENCE_DRAG_TYPE = "application/x-starter-reference-source";
export function writeReferenceDrag(
  transfer: DataTransfer,
  source: Readonly<{ chatId: string; key: string }>,
): void {
  transfer.setData(REFERENCE_DRAG_TYPE, JSON.stringify({ chatId: source.chatId, key: source.key }));
  transfer.effectAllowed = "copy";
}
export function readReferenceDrag(transfer: DataTransfer): { chatId: string; key: string } | null {
  const raw = transfer.getData(REFERENCE_DRAG_TYPE);
  if (!raw || raw.length > 2048) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("chatId" in value) ||
      !("key" in value) ||
      typeof value.chatId !== "string" ||
      typeof value.key !== "string" ||
      !value.chatId ||
      !value.key ||
      value.key.length > 1024
    )
      return null;
    return { chatId: value.chatId, key: value.key };
  } catch {
    return null;
  }
}
