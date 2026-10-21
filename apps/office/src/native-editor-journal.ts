import { isDeepStrictEqual } from "node:util";
import { Effect, type Scope } from "effect";
import { OfficeForbidden, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { HostEditorPermit } from "@starter/office-server/native-remote";
import { decodeWireSync } from "@starter/office-contract";
import { prepareSdkEditorCommit } from "@starter/office-server/native-codec";
import type { OfficeNativeRuntime } from "@starter/office-server";
import type {
  NativeEditorLeaf,
  NativeEditorPermit,
  OfficeDependencies,
} from "@starter/office-server/ports";
import type { OfficeEditorClient } from "./native-editor-client.ts";
import { captureNativeTarget } from "./native-target.ts";
import { stageEditorArtifact } from "./native-editor-artifact.ts";
import type { OfficeEditorPublication, EditorPublication } from "./native-editor-publication.ts";

type Journal = NonNullable<Parameters<OfficeNativeRuntime["invoke"]>[3]>;
const denied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
const unknown = () => new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
export const makeOfficeEditorJournal = Effect.fn("Office.editorJournal")(function* (options: {
  readonly bytes: OfficeDependencies["bytes"];
  readonly policy: OfficeDependencies["policy"];
  readonly editor: OfficeEditorClient;
  readonly publication: OfficeEditorPublication;
  readonly permit: NativeEditorPermit;
  readonly worktreeId: string | null;
  readonly signal: AbortSignal;
  readonly deadline: number;
}) {
  const context = yield* Effect.context<Scope.Scope>();
  const run = Effect.runPromiseWith(context);
  const captured = decodeWireSync(HostEditorPermit)(structuredClone(options.permit));
  const permit = Object.freeze({ ...captured, target: captureNativeTarget(captured.target) });
  let used = false;
  const check = () => {
    if (
      options.signal.aborted ||
      !Number.isSafeInteger(options.deadline) ||
      Date.now() >= options.deadline
    )
      throw denied();
  };
  const journal: Journal = async (step, dispatch) => {
    check();
    if (used || (step.kind !== "core-commit" && step.kind !== "draft-commit")) throw denied();
    used = true;
    if (
      options.worktreeId === null
        ? step.kind !== "core-commit"
        : step.kind !== "draft-commit" || step.input.worktreeID !== options.worktreeId
    )
      throw denied();
    const prepared = prepareSdkEditorCommit(
      step.input.changeset,
      permit,
      options.policy,
      step.input.changeset.type,
    );
    const receipt: NativeEditorLeaf["receipt"] =
      options.worktreeId === null
        ? { kind: "main-change", revision: prepared.header.revision }
        : {
            kind: "draft-change",
            worktreeId: options.worktreeId,
            revision: prepared.header.revision,
          };
    const id = crypto.randomUUID();
    const payload = await run(
      stageEditorArtifact(
        options.bytes,
        permit.target.owner,
        id,
        {
          version: 1,
          kind: "editor-native-write",
          id,
          submissionId: permit.submissionId,
          stepId: permit.stepId,
          target: permit.target,
          receipt,
          step,
        },
        options.policy.limits.nativeBytes,
      ),
    );
    check();
    const state: EditorPublication = {
      permit,
      prepared,
      worktreeId: options.worktreeId,
      leaf: { id, submissionId: permit.submissionId, payload, receipt },
      editor: options.editor,
      signal: options.signal,
      deadline: options.deadline,
      active: true,
      used: false,
      staged: null,
    };
    const result = await options.publication.run(state, dispatch);
    check();
    if (!state.used || state.staged === null) throw unknown();
    const observed = await run(options.editor.observe(permit));
    check();
    if (
      observed.state !== "confirmed" ||
      observed.acceptedRevision !== prepared.header.revision ||
      observed.binding.authorityEpoch !== permit.authorityEpoch ||
      !isDeepStrictEqual(observed.committed, state.staged.committed)
    )
      throw unknown();
    return result;
  };
  return journal;
});
