/**
 * Exact owning-run abort for a mid-run Skills defect.
 *
 * The durable failure/latch is written for the affected attempt first. The live
 * run may only be aborted after its native input lineage proves it is that same
 * affected operation; a late defect callback that resolves after the run
 * settled and another run started must never cancel the newer run. The tool
 * reporting the defect is never self-joined.
 */
import {
  LiveDoc,
  ROOT_CONVERSATION_ID,
  type Harness,
  type TaskId,
} from "@earendil-works/pi-durable";
import { PI_BACKGROUND } from "./chat-runtime.ts";
import { reportSkillRecovery } from "./chat-skills-errors.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";

export const failSkillAttempt = async (
  input: {
    readonly store: ChatSkillsStore;
    readonly latch: (operationId: string, message: string) => void;
    readonly notify: () => void;
    readonly harness: () => Promise<Harness>;
  },
  attemptId: string,
  message: string,
  currentTaskId: TaskId | undefined,
  permanent: boolean | undefined,
): Promise<void> => {
  let affected = attemptId;
  try {
    const row = input.store.byId(attemptId);
    // The affected operation is the attempt's own native request, never the
    // mutable live tail.
    affected = row?.operationId ?? attemptId;
  } catch (error) {
    // Keep the attempt id as the best available exact key.
    reportSkillRecovery(error, "defect.read", "skills_defect_read_failed", attemptId);
  }
  try {
    input.latch(affected, message);
    input.store.incomplete(attemptId, message);
    if (permanent === true) input.store.setRecoverability(attemptId, false, message);
    input.notify();
  } catch (error) {
    // A persistence failure must still attempt the exact abort below.
    reportSkillRecovery(
      error,
      "defect.persist",
      "skills_defect_persist_failed",
      affected,
      currentTaskId,
    );
  }
  try {
    const pi = await input.harness();
    const native = await pi.snapshot(LiveDoc, ROOT_CONVERSATION_ID, PI_BACKGROUND);
    const run = native?.run;
    if (run === undefined) return;
    const first = run.inputs[0];
    if (first === undefined) return;
    const submission = await pi.submission(first, PI_BACKGROUND);
    const record = submission === undefined ? undefined : await submission.status(PI_BACKGROUND);
    // Only the proven owning operation may be cancelled; otherwise the latch is
    // the whole remedy and no task (especially not a newer run) is touched.
    if (record?.requestId !== affected) return;
    try {
      await pi.abortTask(run.taskId, PI_BACKGROUND);
    } catch (error) {
      // An unproven cancellation is reported by the gate staying closed.
      reportSkillRecovery(
        error,
        "defect.abort",
        "skills_defect_abort_failed",
        affected,
        run.taskId,
      );
    }
    for (const slot of native?.tools ?? []) {
      if (slot.status === "done" || slot.taskId === undefined) continue;
      if (currentTaskId !== undefined && slot.taskId === currentTaskId) continue;
      try {
        await pi.abortTask(slot.taskId, PI_BACKGROUND);
      } catch (error) {
        // Keep aborting the remaining tool phases; the latch stays closed.
        reportSkillRecovery(
          error,
          "defect.abort",
          "skills_defect_abort_failed",
          affected,
          slot.taskId,
        );
      }
    }
  } catch (error) {
    reportSkillRecovery(
      error,
      "defect.abort",
      "skills_defect_abort_failed",
      affected,
      currentTaskId,
    );
  }
};
