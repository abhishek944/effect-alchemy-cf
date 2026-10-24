import type { ReactNode } from "react";
import type { ChatTool } from "@/lib/chat-tool-types";
import { ChatToolIcon, ToolChevron, type ToolIconName } from "./chat-tool-icon";
import { absentToolOutput, toolStatusText } from "./chat-tool-presentation";
import "./chat-tool-activity.css";

export type ToolActivityCounts = {
  total: number;
  active: number;
  failed: number;
  cancelled: number;
  unknown: number;
};

/** Native disclosures preserve user expansion across tool progress updates. */
export function ToolActivityGroup({
  counts,
  children,
}: {
  counts: ToolActivityCounts;
  children: ReactNode;
}) {
  const { total, active, failed, cancelled, unknown } = counts;
  const label = active
    ? `Using ${total} ${total === 1 ? "tool" : "tools"}`
    : cancelled || unknown
      ? `${total} ${total === 1 ? "tool call" : "tool calls"}`
      : `Used ${total} ${total === 1 ? "tool" : "tools"}`;
  return (
    <details data-cx="tool-activity" data-active={active > 0}>
      <summary
        aria-label={[
          label,
          failed && `${failed} failed`,
          cancelled && `${cancelled} cancelled`,
          unknown && `${unknown} unknown`,
          active && `${active} active`,
        ]
          .filter(Boolean)
          .join(", ")}
      >
        <span data-cx="tool-line">
          <span data-cx="tool-icon">
            <ChatToolIcon name="tools" />
          </span>
          <span data-cx="tool-title" aria-live="polite" aria-atomic="true">
            {label}
            {failed > 0 && <span data-cx="tool-failed"> · {failed} failed</span>}
            {cancelled > 0 && <span> · {cancelled} cancelled</span>}
            {unknown > 0 && <span> · {unknown} unknown</span>}
          </span>
          <ToolChevron />
        </span>
      </summary>
      <div data-cx="tool-members">{children}</div>
    </details>
  );
}

/** Presentation only. Neither disclosure nor its text can execute a tool. */
export function ToolActivityRow({
  tool,
  title,
  icon,
}: {
  tool: ChatTool;
  title: string;
  icon: ToolIconName;
}) {
  const status = toolStatusText[tool.status];
  return (
    <details data-cx="tool-call" data-status={tool.status}>
      <summary aria-label={`${title}, ${status}`} title={`${tool.name} · ${status}`}>
        <span data-cx="tool-line">
          <span data-cx="tool-icon">
            <ChatToolIcon name={icon} />
          </span>
          <span data-cx="tool-title">
            {title}
            {tool.status !== "succeeded" && (
              <span data-cx={tool.status === "failed" ? "tool-failed" : "tool-state"}>
                {" "}
                · {status}
              </span>
            )}
          </span>
          <ToolChevron />
        </span>
      </summary>
      <div data-cx="tool-details">
        <pre data-cx="tool-input">{tool.input || "No input preview is available."}</pre>
        {tool.inputTruncated && <p data-cx="tool-preview-note">Input preview is truncated.</p>}
        <div data-cx="tool-result-label">Result</div>
        <pre data-cx="tool-output">{tool.output ?? absentToolOutput(tool.status)}</pre>
        {tool.outputTruncated && <p data-cx="tool-preview-note">Output preview is truncated.</p>}
      </div>
    </details>
  );
}
