import type { IncomingMessage } from "node:http";

const text = (chunk: unknown): string => {
  if (typeof chunk === "string") return chunk;
  throw new Error("Expected a UTF-8 decoded request body");
};

/** Read a complete request body. The Worker always sends a decoded request first. */
export const readBody = async (request: IncomingMessage): Promise<string> => {
  request.setEncoding("utf8");
  const chunks: string[] = [];
  for await (const chunk of request) chunks.push(text(chunk));
  return chunks.join("");
};

/** Yield body lines as they arrive, so a provider stream is forwarded without buffering it all. */
export async function* readLines(request: IncomingMessage): AsyncGenerator<string> {
  request.setEncoding("utf8");
  let pending = "";
  for await (const chunk of request) {
    pending += text(chunk);
    let index = pending.indexOf("\n");
    while (index >= 0) {
      const line = pending.slice(0, index).trim();
      pending = pending.slice(index + 1);
      if (line.length > 0) yield line;
      index = pending.indexOf("\n");
    }
  }
  const rest = pending.trim();
  if (rest.length > 0) yield rest;
}
