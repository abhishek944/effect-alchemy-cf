import type { AssistantMessage } from "@earendil-works/pi-ai";
import { projectPublicTools } from "./chat-tool-projection.ts";

export const partialToolPreview = (message: AssistantMessage | undefined) =>
  message === undefined
    ? { tools: [], toolsTruncated: false, visited: 0 }
    : projectPublicTools(message, new Map(), 32, undefined, [], false, true);
