import type { ChatFileDescriptor } from "./chat-capability-file-types";
import type { ChatUsageAmount } from "./chat-capability-usage-types";
import type { TextInfo } from "./chat-history-types";
import type { ChatTool } from "./chat-tool-types";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  /** Exact ordered prefix of this message's public text, never an ellipsis. */
  text: string;
  createdAt: string;
  /** Original send operation UUID for public user messages, else null. */
  operationId: string | null;
  /** Staged originals submitted with this user message; empty on replies. */
  attachments: ChatFileDescriptor[];
  /** True only for actual saved receipts tied to this exact assistant entry/model slot. */
  hasGeneratedFiles: boolean;
  /** Logical operation a retry answer belongs to; null for an original send. */
  attemptOf: string | null;
  /** True only for an answer whose pinned attempt failed; partials stay visible. */
  incomplete: boolean;
  /** Native calls in content order, with bounded public input/result excerpts. */
  tools?: ChatTool[];
  toolsTruncated?: boolean;
  /** Message-specific reported/estimated counters; null while streaming or unknown. */
  usage: ChatUsageAmount | null;
} & TextInfo;
