/**
 * Read-only paid-dispatch gate for already-proven operations.
 *
 * Account tools and the image host call this immediately before a catalog
 * mutation, profile read or paid image call with the operation id they proved
 * from native lineage. It never resolves the live tail: only the exact supplied
 * operation is inspected, and a failure latches that operation so later model
 * dispatch also stays closed.
 */
import {
  SKILLS_PINNED_UNAVAILABLE,
  SKILLS_UNAVAILABLE,
  SkillRuntimeError,
} from "./chat-skills-errors.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";
import type { SendEra } from "./chat-send-records.ts";
import { verifyAttemptState } from "./chat-skills-verify.ts";

/**
 * Synchronous, I/O-free final fence for the exact operation: memory latch,
 * stored status/corruption and positive provenance only. No live-tail guess and
 * no await, so it can run immediately before a mutation after an async gate.
 */
export const skillDispatchBlocked = (
  store: ChatSkillsStore,
  sendEra: (operationId: string) => SendEra,
  latched: Map<string, string>,
  operationId: string,
): string | null => {
  const memory = latched.get(operationId);
  if (memory !== undefined) return memory;
  const row = store.byOperation(operationId);
  if (row === null) return sendEra(operationId) === "legacy" ? null : SKILLS_PINNED_UNAVAILABLE;
  if (row.corrupt) return SKILLS_PINNED_UNAVAILABLE;
  if (row.classification === "legacy") return null;
  if (row.status === "incomplete" || row.status === "unavailable")
    return row.failure ?? SKILLS_UNAVAILABLE;
  return null;
};

export const assertSkillDispatchAllowed = async (
  input: {
    readonly store: ChatSkillsStore;
    readonly scope: () => string | null;
    readonly sendEra: (operationId: string) => SendEra;
    readonly fail: (operationId: string, message: string) => void;
  },
  latched: Map<string, string>,
  operationId: string,
): Promise<void> => {
  const memory = latched.get(operationId);
  if (memory !== undefined) throw new SkillRuntimeError("unavailable", memory);
  const row = input.store.byOperation(operationId);
  if (row === null) {
    if (input.sendEra(operationId) === "legacy") return;
    throw new SkillRuntimeError("unavailable", SKILLS_PINNED_UNAVAILABLE);
  }
  if (row.corrupt) throw new SkillRuntimeError("unavailable", SKILLS_PINNED_UNAVAILABLE);
  if (row.classification === "legacy") return;
  if (row.status === "incomplete" || row.status === "unavailable")
    throw new SkillRuntimeError("unavailable", row.failure ?? SKILLS_UNAVAILABLE);
  const verified = await verifyAttemptState(row, input.scope());
  if (!verified.ok) {
    input.fail(operationId, verified.message);
    throw new SkillRuntimeError("unavailable", verified.message);
  }
};

/** Bound latch memory by dropping only durably persisted terminal failures. */
export const pruneSkillLatch = (store: ChatSkillsStore, latched: Map<string, string>): void => {
  if (latched.size < 64) return;
  for (const operationId of latched.keys()) {
    const row = store.byOperation(operationId);
    if (row !== null && (row.status === "incomplete" || row.status === "unavailable"))
      latched.delete(operationId);
    if (latched.size < 64) break;
  }
};
