import { AsyncLocalStorage } from "node:async_hooks";
import type { NativeAccess, NativeAdapters, NativeTarget, WritePermit } from "../ports/index.ts";
import type {
  CreateUnitDatabaseInput,
  CommitChangesetInput,
  SaveSnapshotInput,
} from "@univerjs-pro/collaboration-service";
import type {
  CreateWorktreeUnitDatabaseInput,
  CommitWorktreeChangesetInput,
  SaveWorktreeUnitMergeArtifactInput,
  CreateWorktreeDatabaseInput,
  AddWorktreeUnitDatabaseInput,
  RecordUnitMergeResultInput,
  SetWorktreeUnitRemovedDatabaseInput,
} from "@univerjs-pro/collaboration-worktree-service";
import { officeFailure } from "./failure.ts";

export type NativeStep =
  | { kind: "core-create"; input: CreateUnitDatabaseInput }
  | { kind: "core-commit"; input: CommitChangesetInput }
  | { kind: "core-snapshot"; input: SaveSnapshotInput }
  | { kind: "draft-create"; input: CreateWorktreeUnitDatabaseInput }
  | { kind: "draft-commit"; input: CommitWorktreeChangesetInput }
  | { kind: "draft-artifact"; input: SaveWorktreeUnitMergeArtifactInput }
  | { kind: "worktree-create"; input: CreateWorktreeDatabaseInput }
  | { kind: "worktree-add"; input: AddWorktreeUnitDatabaseInput }
  | { kind: "worktree-result"; input: RecordUnitMergeResultInput }
  | { kind: "worktree-remove"; input: SetWorktreeUnitRemovedDatabaseInput }
  | {
      kind: "worktree-transition";
      action:
        | "markReady"
        | "reopenWorktree"
        | "discardWorktree"
        | "startOrResumeMerge"
        | "finishMerge";
      worktreeId: string;
    };
/** SDK Promise interop only: journal exact input before the supplied real native mutation. */
export type NativeJournal = <A>(step: NativeStep, dispatch: () => Promise<A>) => Promise<A>;
export type NativeLease = {
  readonly access: NativeAccess;
  readonly target: NativeTarget;
  readonly pair: NativeAdapters;
  readonly journal: NativeJournal | null;
  readonly worktreeId: string | null;
  readonly mode: "read" | "draft" | "main" | "merge" | "lifecycle";
  active: boolean;
};
export class NativeLeaseContext {
  readonly local = new AsyncLocalStorage<NativeLease>();
  readonly target: NativeTarget;
  constructor(target: NativeTarget) {
    this.target = target;
  }
  current(userID: string, unitID?: string, worktreeID?: string): NativeLease {
    const lease = this.local.getStore();
    if (
      !lease?.active ||
      lease.target.owner.ownerId !== userID ||
      lease.target.owner.ownerId !== this.target.owner.ownerId ||
      lease.target.owner.stage !== this.target.owner.stage ||
      lease.target.documentId !== this.target.documentId ||
      lease.target.unitId !== this.target.unitId ||
      (unitID !== undefined && unitID !== this.target.unitId)
    )
      throw officeFailure("FORBIDDEN");
    if (worktreeID !== undefined) {
      if (lease.target.scope.kind !== "draft" || lease.worktreeId !== worktreeID)
        throw officeFailure("FORBIDDEN");
    }
    return lease;
  }
  assertWrite(
    userID: string,
    kind: NativeStep["kind"],
    action?: Extract<NativeStep, { kind: "worktree-transition" }>["action"],
  ): void {
    const lease = this.current(userID);
    if (
      (lease.access.kind !== "write" && lease.access.kind !== "editor") ||
      lease.journal === null ||
      lease.mode === "read" ||
      kind === "worktree-remove"
    )
      throw officeFailure("FORBIDDEN");
    if (lease.access.kind === "editor") {
      if (
        (lease.mode === "main" && lease.target.scope.kind === "main" && kind === "core-commit") ||
        (lease.mode === "draft" && lease.target.scope.kind === "draft" && kind === "draft-commit")
      )
        return;
      throw officeFailure("FORBIDDEN");
    }
    if (lease.mode === "main" && !kind.startsWith("core-")) throw officeFailure("FORBIDDEN");
    if (lease.mode === "draft" && kind !== "draft-commit") throw officeFailure("FORBIDDEN");
    if (
      lease.mode === "lifecycle" &&
      ![
        "worktree-create",
        "worktree-add",
        "draft-create",
        "draft-artifact",
        "worktree-transition",
      ].includes(kind)
    )
      throw officeFailure("FORBIDDEN");
    if (
      lease.mode === "merge" &&
      (lease.access.permit.reviewFingerprint === null ||
        ![
          "core-create",
          "core-commit",
          "core-snapshot",
          "draft-artifact",
          "worktree-result",
          "worktree-transition",
        ].includes(kind))
    )
      throw officeFailure("FORBIDDEN");
    if (lease.mode !== "main" && lease.target.scope.kind !== "draft")
      throw officeFailure("FORBIDDEN");
    if (
      kind === "worktree-transition" &&
      (action === undefined ||
        (lease.mode === "lifecycle" &&
          !["markReady", "reopenWorktree", "discardWorktree"].includes(action)) ||
        (lease.mode === "merge" && !["startOrResumeMerge", "finishMerge"].includes(action)))
    )
      throw officeFailure("FORBIDDEN");
  }
  write<A>(
    userID: string,
    step: NativeStep,
    dispatch: (pair: NativeAdapters) => Promise<A>,
  ): Promise<A> {
    this.assertWrite(
      userID,
      step.kind,
      step.kind === "worktree-transition" ? step.action : undefined,
    );
    const lease = this.current(userID);
    if (lease.access.kind === "editor") {
      if (step.kind !== "core-commit" && step.kind !== "draft-commit")
        throw officeFailure("FORBIDDEN");
      const change = step.input.changeset,
        permit = lease.access.permit;
      if (
        change.unitID !== lease.target.unitId ||
        change.userID !== userID ||
        change.memberID !== permit.memberId ||
        change.sid !== permit.sid ||
        change.reqId !== permit.reqId ||
        change.baseRev !== permit.expectedHead ||
        change.revision !== permit.expectedHead + 1
      )
        throw officeFailure("FORBIDDEN");
    }
    if (lease.journal === null) throw officeFailure("FORBIDDEN");
    const journal = lease.journal;
    return journal(step, () => {
      this.current(userID);
      if (!lease.active) throw officeFailure("AUTHORITY_LOST");
      return dispatch(lease.pair);
    });
  }
  permit(): WritePermit {
    const lease = this.local.getStore();
    if (!lease?.active || lease.access.kind !== "write") throw officeFailure("FORBIDDEN");
    return lease.access.permit;
  }
}
