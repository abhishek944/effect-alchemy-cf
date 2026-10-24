import { useMemo, type ReactNode } from "react";
import { MessagePrimitive, groupPartByType, useAuiState } from "@assistant-ui/react";
import { parseChatTool } from "@/lib/chat-tool-validate";
import { isRecord } from "@/lib/chat-validate-base";
import { ChatMarkdown } from "./chat-markdown";
import { ToolActivityGroup, ToolActivityRow, type ToolActivityCounts } from "./chat-tool-activity";
import { toolPresentation } from "./chat-tool-presentation";

const groupTools = groupPartByType({ "tool-call": ["group-tool"] });

function ToolGroup({ indices, children }: { indices: readonly number[]; children: ReactNode }) {
  const content = useAuiState((state) => state.message.content);
  const counts = useMemo(() => {
    const value: ToolActivityCounts = {
      total: indices.length,
      active: 0,
      failed: 0,
      cancelled: 0,
      unknown: 0,
    };
    for (const index of indices) {
      const part = content[index];
      const tool = part?.type === "tool-call" ? parseChatTool(part.artifact) : null;
      if (!tool || tool.status === "unknown") value.unknown += 1;
      else if (tool.status === "pending" || tool.status === "running") value.active += 1;
      else if (tool.status === "failed") value.failed += 1;
      else if (tool.status === "cancelled") value.cancelled += 1;
    }
    return value;
  }, [content, indices]);
  return <ToolActivityGroup counts={counts}>{children}</ToolActivityGroup>;
}

/** SDK grouping preserves adjacent tool keys without gathering calls across prose. */
export function ChatAssistantParts() {
  return (
    <MessagePrimitive.GroupedParts groupBy={groupTools} indicator="never">
      {({ part, children }) => {
        switch (part.type) {
          case "group-tool":
            return <ToolGroup indices={part.indices}>{children}</ToolGroup>;
          case "text":
            return <ChatMarkdown />;
          case "tool-call": {
            const tool = parseChatTool(part.artifact);
            if (!tool) return <p data-cx="tool-preview-note">Tool activity is unavailable.</p>;
            const presentation = toolPresentation(tool);
            return <ToolActivityRow tool={tool} {...presentation} />;
          }
          default:
            return <></>;
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

export function ToolPreviewNote() {
  const note = useAuiState((state) => {
    const custom: unknown = state.message.metadata.custom;
    if (!isRecord(custom)) return null;
    if (custom.toolPositionsUnavailable === true)
      return "Tool positions are unavailable in this text section.";
    if (custom.toolsDeferred === true)
      return "Tool activity will appear as the preceding message text loads.";
    if (custom.toolsTruncated === true) return "This tool activity preview is incomplete.";
    return null;
  });
  return note ? <p data-cx="tool-preview-note">{note}</p> : null;
}
