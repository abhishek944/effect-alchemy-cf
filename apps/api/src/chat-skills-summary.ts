/**
 * Summary-health gate for the pinned raw summarization path.
 *
 * Beyond row flags and a non-null pin, the full attempt verifier must pass:
 * a schema-valid but malformed pin or active document (bad manifest digest,
 * unbound entry, altered text digest) must not reach a paid summarizer.
 */
import type { SendEra } from "./chat-send-records.ts";
import {
  SKILLS_INCOMPLETE,
  SKILLS_PINNED_UNAVAILABLE,
  SKILLS_UNKNOWN_PROVENANCE,
  SKILLS_UNAVAILABLE,
} from "./chat-skills-errors.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";
import { verifyAttemptState } from "./chat-skills-verify.ts";
import { recordLostAttempt } from "./chat-skills-store-lost.ts";

export type SummaryHealth =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export const skillSummaryHealth = async (input: {
  readonly store: ChatSkillsStore;
  readonly scope: () => string | null;
  readonly sendEra: (operationId: string) => SendEra;
  readonly logicalOperation: (operationId: string) => string | null;
  readonly latched: Map<string, string>;
  readonly fail: (operationId: string, message: string) => void;
  readonly live: () => Promise<{ readonly run: boolean; readonly operationId: string | null }>;
}): Promise<SummaryHealth> => {
  const live = await input.live();
  if (!live.run) return { ok: true };
  if (live.operationId === null) return { ok: false, message: SKILLS_PINNED_UNAVAILABLE };
  const operationId = live.operationId;
  const latched = input.latched.get(operationId);
  if (latched !== undefined) return { ok: false, message: latched };
  const row = input.store.byOperation(operationId);
  if (row === null) {
    const era = input.sendEra(operationId);
    if (era === "legacy") return { ok: true };
    const message = era === "featured" ? SKILLS_PINNED_UNAVAILABLE : SKILLS_UNKNOWN_PROVENANCE;
    recordLostAttempt(
      input.store,
      operationId,
      input.logicalOperation(operationId) ?? operationId,
      message,
      Date.now(),
    );
    return { ok: false, message };
  }
  if (row.corrupt) return { ok: false, message: SKILLS_PINNED_UNAVAILABLE };
  if (row.classification === "legacy") return { ok: true };
  if (row.status === "incomplete") return { ok: false, message: row.failure ?? SKILLS_INCOMPLETE };
  if (row.status === "unavailable")
    return { ok: false, message: row.failure ?? SKILLS_UNAVAILABLE };
  if (row.pin === null) return { ok: false, message: SKILLS_UNAVAILABLE };
  const verified = await verifyAttemptState(row, input.scope());
  if (!verified.ok) {
    input.fail(operationId, verified.message);
    return { ok: false, message: verified.message };
  }
  return { ok: true };
};
