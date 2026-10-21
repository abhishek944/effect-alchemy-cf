/**
 * Fallible mid-run skill activation.
 *
 * Known approved documents must produce a real SDK-formatted activation, and
 * the projected canonical active document must fit its budget before any
 * acknowledgement. A genuine state/budget failure for a known document latches
 * the attempt, persists the failure and aborts the exact owning generation; an
 * unknown/invalid model-supplied name stays an ordinary recoverable tool error.
 * The full final-request/model budget is enforced at the dispatch guard, which
 * also sees this latch; the tool has no model or full context to prove it here.
 */
import type { TaskId } from "@earendil-works/pi-durable";
import {
  activationAcknowledgement,
  renderActiveEntries,
  textDigest,
  type SkillDocument,
} from "./chat-skills-document.ts";
import { SKILLS_BUDGET, SKILLS_PINNED_UNAVAILABLE } from "./chat-skills-errors.ts";
import { MAX_SKILL_BYTES } from "./skills-model.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";

export type SkillActivationOutcome = { readonly ok: boolean; readonly message: string };

export type SkillActivationPort = {
  readonly store: ChatSkillsStore;
  readonly attemptId: string;
  readonly documents: readonly SkillDocument[];
  /** Persist + latch the failure and abort the exact owning generation. */
  readonly defect: (
    message: string,
    taskId: TaskId | undefined,
    permanent?: boolean,
  ) => Promise<void>;
  readonly notify: () => void;
};

export const createSkillActivation =
  (port: SkillActivationPort) =>
  async (
    name: string,
    formatted: string,
    taskId: TaskId | undefined,
  ): Promise<SkillActivationOutcome> => {
    const document = port.documents.find((item) => item.name === name);
    // Unknown/invalid names are recoverable; they never poison the attempt.
    if (document === undefined) return { ok: false, message: `Skill not found: ${name}` };
    // Never substitute raw document text for an unverifiable SDK activation.
    const text = formatted.trim();
    if (text.length === 0) {
      await port.defect(SKILLS_PINNED_UNAVAILABLE, taskId, true);
      return { ok: false, message: SKILLS_PINNED_UNAVAILABLE };
    }
    if (new TextEncoder().encode(text).byteLength > MAX_SKILL_BYTES) {
      // Reachable boundary: a valid upload can exceed the canonical active cap,
      // and the same pinned document will never fit on retry.
      await port.defect(SKILLS_BUDGET, taskId, true);
      return { ok: false, message: SKILLS_BUDGET };
    }
    let entry;
    try {
      entry = {
        name: document.name,
        version: document.version,
        digest: document.digest,
        textDigest: await textDigest(text),
        text,
      };
    } catch {
      await port.defect(SKILLS_PINNED_UNAVAILABLE, taskId, true);
      return { ok: false, message: SKILLS_PINNED_UNAVAILABLE };
    }
    const row = port.store.byId(port.attemptId);
    if (row === null || row.corrupt) {
      await port.defect(SKILLS_PINNED_UNAVAILABLE, taskId, true);
      return { ok: false, message: SKILLS_PINNED_UNAVAILABLE };
    }
    const projected = [...row.active.filter((item) => item.name !== name), entry];
    try {
      renderActiveEntries(projected);
    } catch {
      await port.defect(SKILLS_BUDGET, taskId, true);
      return { ok: false, message: SKILLS_BUDGET };
    }
    let next;
    try {
      next = await port.store.activate(port.attemptId, entry);
    } catch {
      const message = "The skill instructions could not be committed; this answer is incomplete.";
      await port.defect(message, taskId);
      return { ok: false, message };
    }
    port.notify();
    if (!next.some((item) => item.name === name)) {
      await port.defect(SKILLS_BUDGET, taskId, true);
      return { ok: false, message: SKILLS_BUDGET };
    }
    return { ok: true, message: activationAcknowledgement(name, document.version) };
  };
