/**
 * Startup reconstruction from the newly opened raw pi-durable Harness.
 *
 * This runs inside the PiHarness factory after `Harness.open` and before the
 * factory returns, so it must never re-enter PiHarness: `runtime.pi()` would
 * await the very `_doOpen` that is awaiting this work and deadlock every open,
 * including a fresh empty chat. The exact live run is read from the raw
 * `LiveDoc`/submission lineage and, when a pinned restore fails, the exact
 * generation and its live tool phases are aborted before resume so no earlier
 * tool phase can mutate first. Missing post-feature state, corrupt rows and
 * unresolvable accepted-input evidence all fail closed.
 */
import {
  LiveDoc,
  ROOT_CONVERSATION_ID,
  type Harness,
  type SubmissionId,
  type TaskId,
} from "@earendil-works/pi-durable";
import type { SendEra } from "./chat-send-records.ts";
import type { SkillAttempts } from "./chat-skills-attempts.ts";
import type { PiContext } from "./chat-projection.ts";
import {
  SKILLS_INTEGRITY,
  SKILLS_PINNED_UNAVAILABLE,
  SKILLS_UNKNOWN_PROVENANCE,
  SKILLS_UNRECOVERABLE,
  SKILLS_UNAVAILABLE,
  SkillRuntimeError,
} from "./chat-skills-errors.ts";
import { loadPinnedLibrary } from "./chat-skills-pin.ts";
import type { SkillLibrarySource } from "./chat-skills-library.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";
import { verifyAttemptState } from "./chat-skills-verify.ts";
import { recordLostAttempt } from "./chat-skills-store-lost.ts";

export type SkillBootPort = {
  readonly store: ChatSkillsStore;
  readonly attempts: SkillAttempts;
  readonly owner: () => string | null;
  readonly scope: () => string | null;
  readonly library: () => SkillLibrarySource | null;
  readonly sendEra: (operationId: string) => SendEra;
  readonly logicalOperation: (operationId: string) => string | null;
  readonly latch: (operationId: string, message: string) => void;
  readonly notify: () => void;
  readonly now: () => number;
};

export type SkillBootResult =
  | { readonly status: "ready" }
  | { readonly status: "affected-run-failed"; readonly aborted: boolean };

type LiveRun = {
  readonly operationId: string | null;
  readonly taskId: TaskId;
  readonly tools: readonly TaskId[];
};

const liveRun = async (harness: Harness, context: PiContext): Promise<LiveRun | null> => {
  const native = await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context);
  const run = native?.run;
  if (run === undefined) return null;
  const input: SubmissionId | undefined = run.inputs[0];
  let operationId: string | null = null;
  if (input !== undefined) {
    const submission = await harness.submission(input, context);
    const record = submission === undefined ? undefined : await submission.status(context);
    const requestId = record?.requestId;
    operationId = requestId !== undefined && requestId.length > 0 ? requestId : null;
  }
  const tools: TaskId[] = [];
  for (const slot of native?.tools ?? []) {
    if (slot.status !== "done" && slot.taskId !== undefined) tools.push(slot.taskId);
  }
  return { operationId, taskId: run.taskId, tools };
};

const abortTask = async (harness: Harness, context: PiContext, id: TaskId): Promise<boolean> => {
  try {
    await harness.abortTask(id, context);
    return true;
  } catch {
    // An abort that cannot be proven must never be reported as cancelled.
    return false;
  }
};

/** Abort the exact run and tool phases; only a proven scope abort is a fallback. */
const abortRun = async (harness: Harness, context: PiContext, run: LiveRun): Promise<boolean> => {
  const aborted = await abortTask(harness, context, run.taskId);
  for (const tool of run.tools) await abortTask(harness, context, tool);
  if (aborted) return true;
  try {
    const conversation = await harness.conversation(ROOT_CONVERSATION_ID, context);
    if (conversation === undefined) return false;
    await conversation.abort(context);
    return true;
  } catch {
    return false;
  }
};

export const recoverSkillsBeforeResume = async (
  port: SkillBootPort,
  harness: Harness,
  context: PiContext,
): Promise<SkillBootResult> => {
  const run = await liveRun(harness, context);
  if (run === null) return { status: "ready" };
  if (run.operationId === null)
    return { status: "affected-run-failed", aborted: await abortRun(harness, context, run) };
  const operationId = run.operationId;
  const failClosed = async (message: string, notRecoverable: boolean): Promise<SkillBootResult> => {
    port.store.incomplete(operationId, message);
    if (notRecoverable) port.store.setRecoverability(operationId, false, SKILLS_UNRECOVERABLE);
    port.latch(operationId, message);
    port.notify();
    return { status: "affected-run-failed", aborted: await abortRun(harness, context, run) };
  };
  const row = port.store.byOperation(operationId);
  if (row === null) {
    const era = port.sendEra(operationId);
    if (era === "legacy") {
      port.store.classifyLegacy(operationId, port.now());
      port.notify();
      return { status: "ready" };
    }
    // Only a positively evidenced pre-feature record may look legacy.
    const message = era === "featured" ? SKILLS_PINNED_UNAVAILABLE : SKILLS_UNKNOWN_PROVENANCE;
    recordLostAttempt(
      port.store,
      operationId,
      port.logicalOperation(operationId) ?? operationId,
      message,
      port.now(),
    );
    return failClosed(message, true);
  }
  if (row.corrupt) return failClosed(SKILLS_PINNED_UNAVAILABLE, false);
  if (row.classification === "legacy") return { status: "ready" };
  // A prepared row with this proven live input is native-accepted evidence: the
  // HTTP continuation may have died before skills.accept. Terminal failures stay
  // sticky and are handled below; nothing is promoted on mere row existence.
  if ((row.status === "released" || row.status === "prepared") && row.pin !== null) {
    if (!port.store.accept(operationId)) return failClosed(SKILLS_PINNED_UNAVAILABLE, false);
    port.notify();
  } else if (row.status === "released") {
    return failClosed(SKILLS_PINNED_UNAVAILABLE, false);
  }
  if (row.status === "incomplete" || row.status === "unavailable") {
    port.latch(operationId, row.failure ?? SKILLS_UNAVAILABLE);
    return { status: "affected-run-failed", aborted: await abortRun(harness, context, run) };
  }
  const ownerId = port.owner();
  const scope = port.scope();
  const source = port.library();
  try {
    if (row.pin === null || ownerId === null || scope === null || source === null)
      throw new SkillRuntimeError("unavailable", SKILLS_UNAVAILABLE);
    const loaded = await loadPinnedLibrary(source, ownerId, row.pin, row.active, row.catalog);
    const current = port.store.byOperation(operationId);
    const verified =
      current === null
        ? { ok: false as const, message: SKILLS_PINNED_UNAVAILABLE }
        : await verifyAttemptState(current, scope);
    if (!verified.ok) throw new SkillRuntimeError("integrity", SKILLS_INTEGRITY);
    await port.attempts.install(
      operationId,
      loaded.library.documents,
      loaded.catalog,
      loaded.library.manifest.digest,
    );
    return { status: "ready" };
  } catch (error) {
    const integrity = error instanceof SkillRuntimeError && error.code === "integrity";
    return failClosed(integrity ? SKILLS_INTEGRITY : SKILLS_UNAVAILABLE, integrity);
  }
};
