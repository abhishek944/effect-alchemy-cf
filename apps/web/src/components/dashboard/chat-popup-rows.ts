/** Shared roving focus for the two composer popup lists. */

export const popupRows = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-cx="chat-popup-row"]'));

export function moveRow(step: number): void {
  const items = popupRows();
  if (items.length === 0) return;
  const active = document.activeElement;
  const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
  items[(index + step + items.length) % items.length]?.focus();
}

export function edgeRow(position: "first" | "last"): void {
  const items = popupRows();
  (position === "first" ? items[0] : items.at(-1))?.focus();
}
