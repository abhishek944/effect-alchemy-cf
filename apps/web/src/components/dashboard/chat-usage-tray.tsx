import { useState } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import PopupPanel from "./chat-popup";
import ChatUsageDetails from "./chat-usage-details";
import {
  compactTokens,
  exactTokens,
  formatCost,
  formatPercent,
  knownSubtotal,
} from "./chat-usage-format";
import Tooltip from "./tooltip";
import "./chat-usage.css";

function ContextFigure() {
  const { usage } = useChatStore().usage;
  if (!usage || usage.context.provenance !== "estimated")
    return <span data-cx="usage-figure">Context unknown</span>;
  const { estimatedTokens, contextWindow, model } = usage.context;
  if (estimatedTokens === null || contextWindow === null)
    return <span data-cx="usage-figure">Context unknown</span>;
  const percent = formatPercent(estimatedTokens, contextWindow);
  return (
    <span>
      {compactTokens(estimatedTokens)} / {compactTokens(contextWindow)}
      <span className="sr-only">
        {` estimated context: ${exactTokens(estimatedTokens)} of ${exactTokens(
          contextWindow,
        )} tokens${percent ? `, ${percent}` : ""}${model ? `, model ${model}` : ""}`}
      </span>
    </span>
  );
}

function CostFigure() {
  const { usage } = useChatStore().usage;
  const subtotal = usage ? knownSubtotal(usage) : null;
  if (!usage || !subtotal) return <span data-cx="usage-figure">Cost unknown</span>;
  // Whole-chat completeness decides the label: token counters alone can look
  // complete while speech cost is still unknown.
  const partial = usage.completeness !== "complete";
  return (
    <span>
      {formatCost(subtotal.known)}
      {partial ? " partial" : ""}
      <span className="sr-only">
        {` estimated chat cost, a known ${
          partial ? "subtotal; some categories may be unknown" : "total"
        } combining token counters and speech; an estimate from catalog prices, not an invoice`}
      </span>
    </span>
  );
}

/**
 * Shallow numeric tray tucked below the composer. Known values are numbers
 * only; hover/focus identifies each figure with an accessible meaning, and an
 * explicit activation opens the categorized ledger. Unknown or failed loads
 * stay honest instead of showing a fabricated zero.
 */
export default function ChatUsageTray({ chatId }: { chatId: string }) {
  const { usage, status, error, mismatch, reload, reconcile } = useChatStore().usage;
  const [open, setOpen] = useState(false);
  const [tray, setTray] = useState<HTMLElement | null>(null);
  // The Context/Cost button that initiated the open ledger is the Escape target.
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const toggle = (button: HTMLButtonElement) => {
    setTrigger(button);
    setOpen((value) => !value);
  };

  if (chatId === "none") return null;
  if (!usage && status === "loading")
    return (
      <output data-cx="usage-tray" data-state="loading">
        Loading usage…
      </output>
    );
  if (!usage)
    return (
      <div data-cx="usage-tray" data-state="error">
        <output>{mismatch ? "Usage model changed" : "Usage unavailable"}</output>
        <button type="button" data-cx="usage-action" onClick={mismatch ? reconcile : reload}>
          {mismatch ? "Refresh model settings and retry" : "Retry usage"}
        </button>
        {error && <span className="sr-only">{error}</span>}
      </div>
    );

  const context = usage.context;
  const contextLabel =
    context.provenance === "estimated" &&
    context.estimatedTokens !== null &&
    context.contextWindow !== null
      ? `Estimated context: ${exactTokens(context.estimatedTokens)} of ${exactTokens(
          context.contextWindow,
        )} tokens${
          formatPercent(context.estimatedTokens, context.contextWindow)
            ? ` (${formatPercent(context.estimatedTokens, context.contextWindow)})`
            : ""
        }. A server-context estimate, not loaded history.`
      : "Context is unknown for this chat.";
  const subtotal = knownSubtotal(usage);
  const pieces: string[] = [];
  if (subtotal?.token !== null && subtotal?.token !== undefined)
    pieces.push(`token counters ${formatCost(subtotal.token)}`);
  if (subtotal?.speech !== null && subtotal?.speech !== undefined)
    pieces.push(`speech ${formatCost(subtotal.speech)}`);
  const costLabel = subtotal
    ? `Estimated chat cost: ${formatCost(subtotal.known)}${
        pieces.length > 1 ? ` (${pieces.join(" + ")})` : ""
      }. ${
        usage.completeness === "complete"
          ? "All categories are accounted for."
          : "Some categories are unknown, so this is a known subtotal."
      } An estimate from catalog prices, not an invoice.`
    : "Chat cost is unknown for this chat.";

  return (
    // The host observes descendant focus departure; it is not a new interactive control.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={setTray}
      data-cx="usage-tray"
      data-open={open || undefined}
      aria-label="Usage and estimated cost"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Tooltip label={contextLabel}>
        <button
          type="button"
          data-cx="usage-figure"
          aria-expanded={open}
          aria-label="Estimated context usage details"
          onClick={(event) => toggle(event.currentTarget)}
        >
          <ContextFigure />
        </button>
      </Tooltip>
      <Tooltip label={costLabel}>
        <button
          type="button"
          data-cx="usage-figure"
          aria-expanded={open}
          aria-label="Estimated chat cost details"
          onClick={(event) => toggle(event.currentTarget)}
        >
          <CostFigure />
        </button>
      </Tooltip>
      {open && (
        <PopupPanel
          anchor={tray}
          returnFocusTo={trigger}
          width={340}
          label="Usage details"
          onClose={() => setOpen(false)}
        >
          <h2 data-cx="chat-popup-title">Usage details</h2>
          <ChatUsageDetails usage={usage} />
        </PopupPanel>
      )}
    </section>
  );
}
