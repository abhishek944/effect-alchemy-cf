import type { ChatTool } from "@/lib/chat-tool-types";
import type { ToolIconName } from "./chat-tool-icon";

type Presentation = { title: string; icon: ToolIconName };

/** Labels derive from the tool name and status only, never from formatted input text. */
export function toolPresentation(tool: ChatTool): Presentation {
  const done = tool.status === "succeeded";
  if (tool.name === "open_in_panel")
    // This tool requests navigation; it cannot prove that a panel rendered its content.
    return { title: done ? "Panel requested" : "Panel request", icon: "panel" };
  if (tool.name === "univer_cli") return { title: "Office document tool", icon: "tools" };
  const name = tool.name.replaceAll(/[_-]+/g, " ").trim();
  return {
    title: name ? name.charAt(0).toUpperCase() + name.slice(1) : "Tool call",
    icon: "tools",
  };
}

export const toolStatusText: Record<ChatTool["status"], string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Outcome unknown",
};

export function absentToolOutput(status: ChatTool["status"]): string {
  switch (status) {
    case "pending":
      return "Waiting to start.";
    case "running":
      return "No output yet.";
    case "cancelled":
      return "Cancelled; no completed result is available.";
    case "unknown":
      return "No completed result is available. The outcome is unknown.";
    default:
      return "No text result preview is available.";
  }
}
