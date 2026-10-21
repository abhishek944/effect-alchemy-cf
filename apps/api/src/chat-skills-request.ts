import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { MAX_ACTIVE_TEXT_BYTES, MAX_SKILL_CATALOG_BYTES } from "./chat-skills-document.ts";
import {
  SKILLS_BUDGET,
  SKILLS_INCOMPLETE,
  SKILLS_PINNED_UNAVAILABLE,
  SKILLS_REQUEST_BUDGET,
  SKILLS_UNKNOWN_PROVENANCE,
} from "./chat-skills-errors.ts";
import { canonicalSkillContext, type GuardedRequest } from "./chat-skills-guard.ts";
import { requestBudgetBytes, requestTextBytes } from "./chat-request-budget.ts";
import type { SendEra } from "./chat-send-records.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";
import { verifyAttemptState } from "./chat-skills-verify.ts";
import { recordLostAttempt } from "./chat-skills-store-lost.ts";

export type SkillRequestAccess = {
  readonly store: ChatSkillsStore;
  readonly scope: () => string | null;
  readonly sendEra: (operationId: string) => SendEra;
  readonly logicalOperation: (operationId: string) => string | null;
  readonly notify: () => void;
  readonly latched: Map<string, string>;
  readonly fail: (operationId: string, message: string) => void;
  readonly now: number;
};
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

/** Exact supplied operation only; never resolves authority through the mutable live tail. */
export const prepareSkillRequestFor = async (
  access: SkillRequestAccess,
  operationId: string,
  model: Model<Api>,
  context: Context,
  signal?: AbortSignal,
): Promise<GuardedRequest> => {
  // The in-memory latch is authoritative even if its durable write failed.
  const latched = access.latched.get(operationId);
  if (latched !== undefined) return { ok: false, message: latched };
  const row = access.store.byOperation(operationId);
  if (row === null) {
    const era = access.sendEra(operationId);
    if (era === "legacy") {
      access.store.classifyLegacy(operationId, access.now);
      access.notify();
      return { ok: true, context: canonicalSkillContext(context, null, null, access.now) };
    }
    // Only a positively evidenced pre-feature record may look legacy; featured
    // loss and unknown/missing provenance both fail closed with a durable,
    // truthful unrecoverable row so the incomplete attribution survives restart.
    const message = era === "featured" ? SKILLS_PINNED_UNAVAILABLE : SKILLS_UNKNOWN_PROVENANCE;
    recordLostAttempt(
      access.store,
      operationId,
      access.logicalOperation(operationId) ?? operationId,
      message,
      access.now,
    );
    access.fail(operationId, message);
    return { ok: false, message };
  }
  if (row.corrupt) {
    access.fail(operationId, SKILLS_PINNED_UNAVAILABLE);
    return { ok: false, message: SKILLS_PINNED_UNAVAILABLE };
  }
  if (row.classification === "legacy")
    return { ok: true, context: canonicalSkillContext(context, null, null, access.now) };
  // This boundary is only reached with the exact live operation (the raw live
  // input or a verified image-generation proof), so a prepared candidate whose
  // native submit succeeded but whose HTTP continuation died is promoted here.
  if ((row.status === "released" || row.status === "prepared") && row.pin !== null) {
    if (!access.store.accept(operationId)) {
      access.fail(operationId, SKILLS_PINNED_UNAVAILABLE);
      return { ok: false, message: SKILLS_PINNED_UNAVAILABLE };
    }
    access.latched.delete(operationId);
    access.notify();
  } else if (row.status === "released") {
    access.fail(operationId, SKILLS_PINNED_UNAVAILABLE);
    return { ok: false, message: SKILLS_PINNED_UNAVAILABLE };
  } else if (row.status === "incomplete" || row.status === "unavailable") {
    const message = row.failure ?? SKILLS_INCOMPLETE;
    access.latched.set(operationId, message);
    return { ok: false, message };
  }
  const current = access.store.byOperation(operationId);
  const verified =
    current === null
      ? ({ ok: false, message: SKILLS_PINNED_UNAVAILABLE } as const)
      : await verifyAttemptState(current, access.scope());
  if (!verified.ok) {
    access.fail(operationId, verified.message);
    return { ok: false, message: verified.message };
  }
  const { catalog, active } = verified.state;
  if (
    (catalog !== null && bytes(catalog) > MAX_SKILL_CATALOG_BYTES) ||
    bytes(active) > MAX_ACTIVE_TEXT_BYTES
  ) {
    access.fail(operationId, SKILLS_BUDGET);
    return { ok: false, message: SKILLS_BUDGET };
  }
  if (signal?.aborted) return { ok: false, message: "This answer was stopped before it started." };
  const projected = canonicalSkillContext(
    context,
    catalog,
    active.length > 0 ? active : null,
    access.now,
  );
  if (requestTextBytes(projected) > requestBudgetBytes(model)) {
    access.fail(operationId, SKILLS_REQUEST_BUDGET);
    return { ok: false, message: SKILLS_REQUEST_BUDGET };
  }
  return { ok: true, context: projected };
};
