import { createContext, useContext, type ReactNode } from "react";

export type MessageImageAlt = { readonly alt: string; readonly src: string };

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(\s*([^\s)]+)[^)]*\)/g;

/** Markdown image alts in one message, keyed by source URL for file-card lookup. */
export function collectMessageImageAlts(text: string): readonly MessageImageAlt[] {
  const pattern = new RegExp(IMAGE_MARKDOWN);
  const found: MessageImageAlt[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const alt = (match[1] ?? "").trim();
    const src = match[2] ?? "";
    if (src !== "" && !found.some((entry) => entry.src === src)) found.push({ alt, src });
  }
  return found;
}

const MessageImageAltsContext = createContext<readonly MessageImageAlt[]>([]);

export function MessageImageAltsProvider({
  value,
  children,
}: {
  value: readonly MessageImageAlt[];
  children: ReactNode;
}) {
  return (
    <MessageImageAltsContext.Provider value={value}>{children}</MessageImageAltsContext.Provider>
  );
}

export function useMessageImageAlts(): readonly MessageImageAlt[] {
  return useContext(MessageImageAltsContext);
}
