/** Display rules and explicit effort resolution shared by the selection UI. */
import type { ChatCatalogEntry, ChatEffort, ChatModelEffort } from "@/lib/chat-capability-types";

export const EFFORT_LABELS: Record<ChatEffort, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

export const effortLabel = (effort: ChatEffort): string => EFFORT_LABELS[effort];

/** Descending preference for a first-use level at or below High. */
const AT_OR_BELOW_HIGH = ["high", "medium", "low", "minimal", "off"] as const;

export type EffortResolution =
  | { kind: "remembered"; effort: ChatEffort }
  | { kind: "first_use"; effort: ChatEffort; preferred: ChatEffort; adjusted: boolean }
  | { kind: "remembered_unsupported"; effort: ChatEffort }
  | { kind: "no_safe_level" };

/**
 * Resolves the effort for one model without guessing away a remembered choice.
 * An unsupported remembered effort and a model with no supported level at or
 * below High are explicit outcomes that require the user to choose.
 */
export function resolveEffort(
  entries: readonly ChatModelEffort[],
  entry: ChatCatalogEntry,
): EffortResolution {
  const remembered = entries.find((item) => item.model === entry.model)?.effort;
  if (remembered) {
    return entry.efforts.includes(remembered)
      ? { kind: "remembered", effort: remembered }
      : { kind: "remembered_unsupported", effort: remembered };
  }
  const safe = AT_OR_BELOW_HIGH.find((effort) => entry.efforts.includes(effort));
  if (!safe) return { kind: "no_safe_level" };
  return { kind: "first_use", effort: safe, preferred: "high", adjusted: safe !== "high" };
}

export type ModelPlan =
  | { kind: "write"; effort: ChatEffort; notice: string }
  | { kind: "stage"; effort: ChatEffort; notice: string };

/** Plans a model change: save immediately, or stage until the user chooses. */
export function planModelChoice(
  entries: readonly ChatModelEffort[],
  entry: ChatCatalogEntry,
  currentEffort: ChatEffort,
): ModelPlan {
  const resolution = resolveEffort(entries, entry);
  if (resolution.kind === "remembered")
    return { kind: "write", effort: resolution.effort, notice: "" };
  if (resolution.kind === "first_use")
    return {
      kind: "write",
      effort: resolution.effort,
      notice: resolution.adjusted
        ? `First use of ${entry.name}: ${effortLabel(resolution.preferred)} isn't supported; applied ${effortLabel(resolution.effort)}.`
        : `First use of ${entry.name}: applied ${effortLabel(resolution.effort)}.`,
    };
  if (resolution.kind === "remembered_unsupported")
    return {
      kind: "stage",
      effort: resolution.effort,
      notice: `Saved effort ${effortLabel(resolution.effort)} isn't supported by ${entry.name}. Choose a supported effort for this chat.`,
    };
  return {
    kind: "stage",
    effort: currentEffort,
    notice: `${entry.name} has no supported level at or below High. Choose a supported effort for this chat.`,
  };
}
