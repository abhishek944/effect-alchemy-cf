import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ContextView, EntryRecord } from "./chat-transcript-types.ts";

/** Data projection only: retain old head/edit semantics without running old tasks. */
export const transcriptContext = (all: readonly EntryRecord[]): ContextView => {
  const head = all.findLast((entry) => entry.head !== undefined);
  const first = head?.head;
  const range = first === undefined ? all : all.filter((entry) => entry.id >= first);
  const edits = new Map(
    range.flatMap((entry) => (entry.edits ?? []).map((edit) => [edit.target, edit] as const)),
  );
  const entries =
    head === undefined ? [...range] : [head, ...range.filter((entry) => entry.head === undefined)];
  const raw = entries.flatMap((entry) => {
    const edit = edits.get(entry.id);
    const messages =
      edit === undefined
        ? (entry.model ?? [])
        : edit.action === "omit"
          ? []
          : (edit.messages ?? []);
    return messages.filter(
      (message) =>
        message.role !== "assistant" ||
        (message.stopReason !== "aborted" &&
          message.stopReason !== "error" &&
          message.stopReason !== "deferred"),
    );
  });
  const messages: Message[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const message = raw[i];
    if (message === undefined || message.role === "toolResult") continue;
    messages.push(message);
    if (message.role !== "assistant") continue;
    const results = new Map<string, ToolResultMessage>();
    for (let next = i + 1; next < raw.length; next += 1) {
      const candidate = raw[next];
      if (candidate?.role === "assistant") break;
      if (candidate?.role === "toolResult" && !results.has(candidate.toolCallId))
        results.set(candidate.toolCallId, candidate);
    }
    for (const call of message.content) {
      if (call.type !== "toolCall") continue;
      messages.push(
        results.get(call.id) ?? {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [
            {
              type: "text",
              text: "Tool result unavailable: this earlier call did not finish. Its outcome is unknown; do not assume success or replay paid work.",
            },
          ],
          details: { reason: "missing_result" },
          isError: true,
          timestamp: message.timestamp,
        },
      );
    }
  }
  const system = messages.findIndex((message) => message.role !== "user");
  const firstNonUser = messages[system];
  return {
    entries,
    messages:
      system > 0 && firstNonUser?.role === "system"
        ? [firstNonUser, ...messages.slice(0, system), ...messages.slice(system + 1)]
        : messages,
  };
};
