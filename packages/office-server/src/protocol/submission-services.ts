import type { IUniverCollabService } from "@univerjs-pro/collaboration-service";
import type { IUniverCollabWorktreeService } from "@univerjs-pro/collaboration-worktree-service";
import type { NativeServices } from "../core/native-services.ts";
import { officeFailure } from "../core/failure.ts";

type MainSubmit = IUniverCollabService["submitChangeset"];
type DraftSubmit = IUniverCollabWorktreeService["submitChangeset"];
/** Actual joined-session/editor verification and admission are supplied by the concrete host client. */
export type OfficeSubmissionAuthority = {
  readonly main: (
    input: Parameters<MainSubmit>[0],
    context: Parameters<MainSubmit>[1],
    next: () => ReturnType<MainSubmit>,
  ) => ReturnType<MainSubmit>;
  readonly draft: (
    input: Parameters<DraftSubmit>[0],
    context: Parameters<DraftSubmit>[1],
    next: () => ReturnType<DraftSubmit>,
  ) => ReturnType<DraftSubmit>;
};

/** Preserve the authority's actual SDK outcome; fresh next is one-shot and expires with its call. */
async function submit<A, C, R>(
  authority: (input: A, context: C, next: () => Promise<R>) => Promise<R>,
  actual: (input: A, context: C) => Promise<R>,
  input: A,
  context: C,
): Promise<R> {
  let active = true;
  let outcome: Promise<PromiseSettledResult<R>> | undefined;
  try {
    const observed = await authority(input, context, () => {
      if (!active || outcome !== undefined) return Promise.reject(officeFailure("FORBIDDEN"));
      const pending = Promise.resolve().then(() => actual(input, context));
      // Observe immediately, even while authority is awaiting other IO; this promise never rejects.
      outcome = pending.then(
        (value) => ({ status: "fulfilled", value }),
        (reason: unknown) => ({ status: "rejected", reason }),
      );
      return pending;
    });
    active = false;
    if (outcome === undefined) return observed;
    const settled = await outcome;
    if (settled.status === "rejected") throw settled.reason;
    return settled.value;
  } catch (primary) {
    active = false;
    // Lease revocation belongs to the handler; settlement never rolls back persisted receipts.
    if (outcome !== undefined) await outcome;
    throw primary;
  } finally {
    active = false;
  }
}

/** Public interface facades ONLY. All delegates retain the same real SDK instances and their this. */
export function submissionServices(services: NativeServices, authority: OfficeSubmissionAuthority) {
  if (typeof authority?.main !== "function" || typeof authority?.draft !== "function")
    throw officeFailure("FORBIDDEN");
  const main: Omit<IUniverCollabService, "dbAdapter"> = {
    use: (action, middleware) => services.core.use(action, middleware),
    on: (event, listener) => services.core.on(event, listener),
    getUnitLoadData: (input, context) => services.core.getUnitLoadData(input, context),
    getUnitLoadDataWithBlocks: (input, context) =>
      services.core.getUnitLoadDataWithBlocks(input, context),
    getChangesets: (input, context) => services.core.getChangesets(input, context),
    getSheetBlock: (input, context) => services.core.getSheetBlock(input, context),
    createUnitFromSnapshot: (input, context) =>
      services.core.createUnitFromSnapshot(input, context),
    createUnitFromData: (input, context) => services.core.createUnitFromData(input, context),
    deleteUnits: (input, context) => services.core.deleteUnits(input, context),
    recoverUnits: (input, context) => services.core.recoverUnits(input, context),
    submitChangeset: (input, context) =>
      submit(
        (value, actor, next) => authority.main(value, actor, next),
        (value, actor) => services.core.submitChangeset(value, actor),
        input,
        context,
      ),
    dispose: () => services.core.dispose(),
  };
  const drafts: IUniverCollabWorktreeService = {
    use: (action, middleware) => services.drafts.use(action, middleware),
    on: (event, listener) => services.drafts.on(event, listener),
    setUnitRemoved: (input, context) => services.drafts.setUnitRemoved(input, context),
    createWorktree: (input, context) => services.drafts.createWorktree(input, context),
    getWorktree: (input, context) => services.drafts.getWorktree(input, context),
    addUnit: (input, context) => services.drafts.addUnit(input, context),
    createUnitFromSnapshot: (input, context) =>
      services.drafts.createUnitFromSnapshot(input, context),
    createUnitFromData: (input, context) => services.drafts.createUnitFromData(input, context),
    markReady: (input, context) => services.drafts.markReady(input, context),
    reopenWorktree: (input, context) => services.drafts.reopenWorktree(input, context),
    discardWorktree: (input, context) => services.drafts.discardWorktree(input, context),
    mergeWorktree: (input, context) => services.drafts.mergeWorktree(input, context),
    evaluateWorktreeUnitMerge: (input, context) =>
      services.drafts.evaluateWorktreeUnitMerge(input, context),
    getUnitLoadData: (input, context) => services.drafts.getUnitLoadData(input, context),
    getChangesets: (input, context) => services.drafts.getChangesets(input, context),
    getSheetBlock: (input, context) => services.drafts.getSheetBlock(input, context),
    submitChangeset: (input, context) =>
      submit(
        (value, actor, next) => authority.draft(value, actor, next),
        (value, actor) => services.drafts.submitChangeset(value, actor),
        input,
        context,
      ),
    dispose: () => services.drafts.dispose(),
  };
  return { main, drafts };
}
