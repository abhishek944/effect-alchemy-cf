/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Keyboard scrolling of the bounded existing cost-details body. */
import type {
  ChatAttemptCategory,
  ChatUsage,
  ChatUsageAmount,
} from "@/lib/chat-capability-usage-types";
import { ATTEMPT_CATEGORIES } from "@/lib/chat-capability-usage-types";
import { completenessLabel, exactTokens, formatCost, formatPercent } from "./chat-usage-format";
import { ImageUsageDetails } from "./image-usage-details";

const CATEGORY_LABELS: Record<ChatAttemptCategory, string> = {
  reply: "Replies",
  retry: "Retries",
  failed: "Reported failed",
  aborted: "Reported stopped",
  summarization: "Summarization",
  title: "Title generation",
};

function amountLine(amount: ChatUsageAmount, label: string) {
  const tokens = amount.tokens;
  const parts: string[] = [];
  if (tokens.inputUncached !== null || tokens.cacheRead !== null)
    parts.push(`input ${exactTokens(tokens.inputUncached ?? 0)}`);
  if (tokens.cacheRead !== null) parts.push(`cache read ${exactTokens(tokens.cacheRead)}`);
  if (tokens.output !== null) parts.push(`output ${exactTokens(tokens.output)}`);
  if (tokens.reasoning !== null) parts.push(`reasoning ${exactTokens(tokens.reasoning)}`);
  return (
    <div data-cx="usage-detail-row" key={label}>
      <dt>{label}</dt>
      <dd>
        {parts.length > 0 ? parts.join(" · ") : "Counters unknown"}
        {amount.estimatedCostUsd !== null ? ` · ${formatCost(amount.estimatedCostUsd)}` : ""}
      </dd>
    </div>
  );
}

/** Categorized accounting shown only after an explicit details activation. */
export default function ChatUsageDetails({ usage }: { usage: ChatUsage | null }) {
  if (!usage)
    return (
      <div data-cx="usage-details" tabIndex={0} aria-label="Usage and separate cost breakdown">
        <p data-cx="usage-detail-lede">
          Native text and speech usage is unavailable. Image accounting is read separately; missing
          native usage is not zero.
        </p>
        <ImageUsageDetails key="image-costs" />
      </div>
    );
  const categories = ATTEMPT_CATEGORIES.map((category) => ({
    category,
    attempts: usage.attempts.filter((attempt) => attempt.category === category),
  })).filter((entry) => entry.attempts.length > 0);

  return (
    <div data-cx="usage-details" tabIndex={0} aria-label="Usage and separate cost breakdown">
      <p data-cx="usage-detail-lede">
        Text and speech: {completenessLabel(usage.completeness)}. Estimates use installed catalog
        prices and the server context, never an invoice. Image accounting is separate below.
      </p>
      <dl data-cx="usage-detail-list">
        <div data-cx="usage-detail-row">
          <dt>Context</dt>
          <dd>
            {usage.context.provenance === "estimated" &&
            usage.context.estimatedTokens !== null &&
            usage.context.contextWindow !== null
              ? `${exactTokens(usage.context.estimatedTokens)} of ${exactTokens(
                  usage.context.contextWindow,
                )} tokens${
                  formatPercent(usage.context.estimatedTokens, usage.context.contextWindow)
                    ? ` (${formatPercent(usage.context.estimatedTokens, usage.context.contextWindow)})`
                    : ""
                }`
              : "Unknown"}
          </dd>
        </div>
        {amountLine(usage.amount, `Token counters (${usage.amount.provenance})`)}
        {categories.map((entry) => {
          const known = entry.attempts
            .map((attempt) => attempt.amount.estimatedCostUsd)
            .filter((value): value is number => value !== null);
          const total = known.reduce((sum, value) => sum + value, 0);
          return (
            <div data-cx="usage-detail-row" key={entry.category}>
              <dt>{CATEGORY_LABELS[entry.category]}</dt>
              <dd>
                {entry.attempts.length} attempt{entry.attempts.length === 1 ? "" : "s"}
                {known.length > 0 ? ` · ~${formatCost(total)}` : " · Cost unknown"}
              </dd>
            </div>
          );
        })}
        <div data-cx="usage-detail-row">
          <dt>Speech</dt>
          <dd>
            {usage.speech.completeness === "unknown"
              ? "Unknown"
              : usage.speech.units.length > 0
                ? usage.speech.units
                    .map(
                      (unit) =>
                        `${unit.quantity === null ? "Unknown" : exactTokens(unit.quantity)} ${unit.unit.replace("_", " ")}`,
                    )
                    .join(" · ")
                : "None"}
            {usage.speech.estimatedCostUsd !== null
              ? ` · ~${formatCost(usage.speech.estimatedCostUsd)}`
              : ""}
          </dd>
        </div>
      </dl>
      <ImageUsageDetails key="image-costs" />
    </div>
  );
}
