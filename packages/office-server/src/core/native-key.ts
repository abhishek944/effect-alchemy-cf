import type { NativeReceiptKey, WritePermit } from "../ports/index.ts";
import type { NativeStep } from "./native-lease.ts";
import { officeFailure } from "./failure.ts";

/** SDK inputs -> shared semantic keys. Provider action strings remain exclusively in T22/T16. */
export function nativeReceiptKey(step: NativeStep, permit: WritePermit): NativeReceiptKey {
  const generation = () => {
    if (
      permit.target.scope.kind !== "draft" ||
      permit.expectedGeneration === null ||
      permit.expectedGeneration !== permit.target.scope.generation
    )
      throw officeFailure("AUTHORITY_LOST", permit.operationId);
    return permit.expectedGeneration;
  };
  switch (step.kind) {
    case "core-create":
      return { kind: "create-main" };
    case "core-snapshot":
      return { kind: "snapshot", revision: step.input.snapshot.rev };
    case "core-commit":
      return { kind: "main-change", revision: step.input.changeset.revision };
    case "draft-create":
      return { kind: "create-draft", worktreeId: step.input.unit.worktreeID };
    case "draft-commit":
      return {
        kind: "draft-change",
        worktreeId: step.input.worktreeID,
        revision: step.input.changeset.revision,
      };
    case "draft-artifact":
      return {
        kind: "merge-artifact",
        worktreeId: step.input.worktreeID,
        readyRevision: step.input.artifact.readyDraftHeadRevision,
      };
    case "worktree-create":
      return { kind: "create-worktree", worktreeId: step.input.record.worktreeID };
    case "worktree-add":
      return { kind: "add-unit", worktreeId: step.input.unit.worktreeID };
    case "worktree-result":
      return {
        kind: "merge-result",
        worktreeId: step.input.worktreeID,
        readyRevision: step.input.readyDraftHeadRevision,
      };
    case "worktree-remove":
      return {
        kind: "set-removed",
        worktreeId: step.input.worktreeID,
        generation: generation(),
        removed: step.input.removed,
      };
    case "worktree-transition": {
      const targets = {
        markReady: "ready",
        reopenWorktree: "draft",
        discardWorktree: "discarded",
        startOrResumeMerge: "merging",
        finishMerge: "merged",
      } as const;
      return {
        kind: "transition",
        worktreeId: step.worktreeId,
        generation: generation(),
        target: targets[step.action],
      };
    }
  }
  throw officeFailure("INVALID_INPUT", permit.operationId);
}
export function nativeWriteHeader(step: NativeStep, permit: WritePermit, nativeType: number) {
  switch (step.kind) {
    case "core-commit":
    case "draft-commit": {
      const change = step.input.changeset;
      return {
        kind: "changeset" as const,
        nativeType: change.type,
        baseRevision: change.baseRev,
        sid: change.sid ?? null,
        reqId: change.reqId ?? null,
      };
    }
    case "core-create":
      return {
        kind: "create-unit" as const,
        nativeType: step.input.record.type,
        baseRevision: null,
        sid: null,
        reqId: null,
      };
    case "draft-create":
      return {
        kind: "create-unit" as const,
        nativeType: step.input.unit.type,
        baseRevision: null,
        sid: null,
        reqId: null,
      };
    case "core-snapshot":
      return {
        kind: "snapshot" as const,
        nativeType: step.input.snapshot.type,
        baseRevision: permit.expectedHead,
        sid: null,
        reqId: null,
      };
    default:
      return {
        kind: "lifecycle" as const,
        nativeType,
        baseRevision: permit.expectedHead,
        sid: null,
        reqId: null,
      };
  }
}
