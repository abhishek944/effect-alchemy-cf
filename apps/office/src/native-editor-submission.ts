import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { IChangeset } from "@univerjs/protocol";
import type { CollabMemberContext } from "@univerjs-pro/collaboration-service";
import { OfficeForbidden, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { OfficeNativeRuntime } from "@starter/office-server";
import type { OfficeSubmissionAuthority } from "@starter/office-server/native-protocol";
import type { NativeTarget, OfficeDependencies } from "@starter/office-server/ports";
import type { NativeApplicationOptions } from "./native-app.ts";
import type { OfficeEditorClient } from "./native-editor-client.ts";
import type { OfficeEditorPublication } from "./native-editor-publication.ts";
import { stageEditorArtifact } from "./native-editor-artifact.ts";
import { makeOfficeEditorJournal } from "./native-editor-journal.ts";
import { captureNativeTarget, sameNativeTarget } from "./native-target.ts";

type Joined = Parameters<NativeApplicationOptions["bindAuthority"]>[0]["joinedSession"];
export type OfficeEditorInvocation = {
  readonly target: NativeTarget;
  readonly submissionId: string;
  readonly turnId: string;
  readonly memberId: string;
  readonly worktreeId: string | null;
  readonly deadline: number;
  readonly signal: AbortSignal;
};
const denied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
const unknown = () => new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
/** Required resolver is T47's ORIGINAL authenticated SDK/request/turn binding, never a claims decoder. */
export function createOfficeSubmissionAuthority(options: {
  readonly runtime: OfficeNativeRuntime;
  readonly bytes: OfficeDependencies["bytes"];
  readonly policy: OfficeDependencies["policy"];
  readonly editor: OfficeEditorClient;
  readonly publication: OfficeEditorPublication;
  readonly joinedSession: Joined;
  readonly resolve: (input: {
    readonly changeset: IChangeset;
    readonly context: CollabMemberContext;
    readonly worktreeId: string | null;
  }) => Promise<OfficeEditorInvocation>;
}): OfficeSubmissionAuthority {
  async function submit<A>(
    changeset: IChangeset,
    context: CollabMemberContext,
    worktreeId: string | null,
    dispatch: () => Promise<A>,
  ): Promise<A> {
    const binding = await options.resolve({ changeset, context, worktreeId });
    const target = captureNativeTarget(binding.target);
    const check = () => {
      if (
        !(binding.signal instanceof AbortSignal) ||
        binding.signal.aborted ||
        !Number.isSafeInteger(binding.deadline) ||
        Date.now() >= binding.deadline
      )
        throw denied();
    };
    check();
    const sid = changeset.sid,
      reqId = changeset.reqId;
    if (
      binding.worktreeId !== worktreeId ||
      (target.scope.kind === "draft") !== (worktreeId !== null) ||
      target.owner.ownerId !== context.userID ||
      binding.memberId !== context.memberID ||
      changeset.unitID !== target.unitId ||
      typeof sid !== "string" ||
      new TextEncoder().encode(sid).byteLength < 1 ||
      new TextEncoder().encode(sid).byteLength > 256 ||
      typeof reqId !== "number" ||
      !Number.isSafeInteger(reqId) ||
      reqId < 0 ||
      options.joinedSession(worktreeId, target.unitId, context.memberID, context.userID) === null
    )
      throw denied();
    // Stable ORIGINAL identity, not body/deadline/current-head: changed bytes must conflict at the SAME ID.
    const clientId = createHash("sha256")
      .update(
        JSON.stringify([
          "office-editor-client",
          1,
          target.owner.stage,
          target.owner.ownerId,
          target.documentId,
          target.unitId,
          target.scope.kind === "draft"
            ? ["draft", target.scope.draftId, target.scope.generation]
            : ["main"],
          binding.submissionId,
          binding.turnId,
          context.memberID,
          worktreeId,
          sid,
          reqId,
        ]),
      )
      .digest("hex");
    const client = await Effect.runPromise(
      stageEditorArtifact(
        options.bytes,
        target.owner,
        clientId,
        {
          version: 1,
          kind: "editor-client",
          target,
          worktreeId,
          memberId: context.memberID,
          changeset,
        },
        Math.min(options.policy.limits.nativeBytes, 16 * 1024 * 1024),
      ),
    );
    check();
    // Exactly ONE admission attempt. Lost ACK/observed does not supply a dispatch permit.
    const admission = await Effect.runPromise(
      options.editor.admit(binding.submissionId, binding.turnId, { sid, reqId, client }),
    );
    if (admission.kind !== "admitted") throw unknown();
    const permit = admission.permit;
    let actual: Promise<PromiseSettledResult<A>> | undefined;
    const work = async () => {
      check();
      if (
        !sameNativeTarget(permit.target, target) ||
        permit.submissionId !== binding.submissionId ||
        permit.memberId !== context.memberID ||
        permit.sid !== sid ||
        permit.reqId !== reqId ||
        admission.admission.turnId !== binding.turnId ||
        admission.admission.notAfter <= Date.now()
      )
        throw denied();
      const deadline = Math.min(binding.deadline, admission.admission.notAfter);
      return Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* makeOfficeEditorJournal({
              bytes: options.bytes,
              policy: options.policy,
              editor: options.editor,
              publication: options.publication,
              permit,
              worktreeId,
              signal: binding.signal,
              deadline,
            });
            return yield* options.runtime.invoke(
              { kind: "editor", permit },
              worktreeId,
              worktreeId === null ? "main" : "draft",
              journal,
              () => {
                if (actual !== undefined) return Promise.reject(denied());
                const task = Promise.resolve().then(check).then(dispatch);
                actual = task.then(
                  (value): PromiseFulfilledResult<A> => ({ status: "fulfilled", value }),
                  (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
                );
                return task;
              },
            );
          }),
        ),
      );
    };
    const outcome = await Promise.resolve()
      .then(work)
      .then(
        (value): { readonly ok: true; readonly value: A } => ({ ok: true, value }),
        (error: unknown): { readonly ok: false; readonly error: unknown } => ({ ok: false, error }),
      );
    // Revoke original permit first; still join real next even if Effect/Scope stopped waiting.
    const released = await Promise.allSettled([Effect.runPromise(options.editor.release(permit))]);
    if (actual !== undefined) await actual;
    if (!outcome.ok) throw outcome.error;
    if (released.some((value) => value.status === "rejected")) throw unknown();
    return outcome.value;
  }
  return {
    main: (input, context, next) => submit(input.changeset, context, null, next),
    draft: (input, context, next) => submit(input.changeset, context, input.worktreeID, next),
  };
}
