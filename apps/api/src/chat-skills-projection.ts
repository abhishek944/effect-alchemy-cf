/**
 * Verified current skill projection for honest context estimates, plus the
 * estimate-only helpers used before measuring.
 *
 * `currentSkillProjection` reports three distinct states so idle/legacy is
 * never confused with unknown live guidance. `canonicalEstimateMessages`
 * replaces the owned `skills`/`skill_context` sections in place instead of
 * appending them (the SDK already stores rendered sections), preserving array
 * length and order. `storedGuidanceMatches` detects whether the effective
 * guidance changed, and `invalidateMeasuredUsage` then strips measured usage
 * from estimate-only copies so the estimator cannot reuse an obsolete measured
 * prefix that covered the old guidance; image contribution indexes are
 * preserved because only usage fields change. If the uncovered originals cannot
 * be reconstructed, the caller returns Unknown rather than a false estimate.
 */
import type { Message, SystemMessage, Usage } from "@earendil-works/pi-ai";
import type { ChatSkillsStore } from "./chat-skills-store.ts";
import { verifyAttemptState } from "./chat-skills-verify.ts";

export type SkillProjection = {
  readonly catalog: string | null;
  readonly active: string | null;
};

export type SkillProjectionState =
  | { readonly kind: "sections"; readonly catalog: string | null; readonly active: string | null }
  | { readonly kind: "none" }
  | { readonly kind: "unknown" };

export const currentSkillProjection = async (
  store: ChatSkillsStore,
  scope: () => string | null,
  live: () => Promise<{ readonly run: boolean; readonly operationId: string | null }>,
): Promise<SkillProjectionState> => {
  const active = await live();
  if (!active.run) return { kind: "none" };
  if (active.operationId === null) return { kind: "unknown" };
  const row = store.byOperation(active.operationId);
  if (row === null || row.corrupt) return { kind: "unknown" };
  if (row.classification === "legacy") return { kind: "none" };
  const verified = await verifyAttemptState(row, scope());
  if (!verified.ok) return { kind: "unknown" };
  return {
    kind: "sections",
    catalog: verified.state.catalog,
    active: verified.state.active.length > 0 ? verified.state.active : null,
  };
};

/** True only when the stored owned sections already equal the effective ones. */
export const storedGuidanceMatches = (
  messages: readonly Message[],
  target: SkillProjection | null,
): boolean => {
  let head: SystemMessage | undefined;
  for (const message of messages) {
    if (message.role !== "system") continue;
    if (head === undefined) {
      head = message;
      continue;
    }
    // A later positional delta carrying owned sections is itself a change.
    if (message.sections?.skills !== undefined || message.sections?.skill_context !== undefined)
      return false;
  }
  const skills = head?.sections?.skills ?? null;
  const context = head?.sections?.skill_context ?? null;
  return skills === (target?.catalog ?? null) && context === (target?.active ?? null);
};

const zeroUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Estimate-only copies: measured usage cannot describe changed guidance. */
export const invalidateMeasuredUsage = (messages: readonly Message[]): readonly Message[] =>
  messages.map((message) =>
    message.role === "assistant" ? { ...message, usage: zeroUsage } : message,
  );

const withoutOwnedSections = (
  message: SystemMessage,
  projection: SkillProjection | null,
): SystemMessage => {
  const sections: Record<string, string | null> = { ...message.sections };
  delete sections.skills;
  delete sections.skill_context;
  if (projection !== null) {
    if (projection.catalog !== null) sections.skills = projection.catalog;
    if (projection.active !== null) sections.skill_context = projection.active;
  }
  return { ...message, sections };
};

export const canonicalEstimateMessages = (
  messages: readonly Message[],
  projection: SkillProjection | null,
): readonly Message[] | null => {
  const head = messages.findIndex((message) => message.role === "system");
  if (head < 0) {
    // Creating a head would shift image/measured-prefix indexes; only a
    // projection that wants sections is unresolved, otherwise nothing changes.
    return projection === null ? messages : null;
  }
  return messages.map((message, index) =>
    message.role === "system"
      ? withoutOwnedSections(message, index === head ? projection : null)
      : message,
  );
};
