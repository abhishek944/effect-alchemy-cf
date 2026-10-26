import { Effect } from "effect";
import type { OfficeSessionBinding } from "@starter/auth/office-session";
import { revalidateOfficeSessionBinding } from "@starter/auth/office-session";
import { createOfficeMetadata } from "@starter/office-cloudflare/metadata";
import { freezeChatReferenceInputs, type ChatReferenceInputs } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import type { OfficeHostRole } from "./office-host-role.ts";
import { officeStorageBindings } from "./office-storage-bindings.ts";
import { officeTaskTargetReads } from "./office-task-target-reads.ts";
import { officeCaught, officeDenied } from "./office-private-authority.ts";

/** Same-script binding only. Validates descriptive native metadata without issuing any actor. */
export const validateOfficeReferenceTargets = Effect.fn("Office.referenceAdmission")(function* (
  role: OfficeHostRole,
  session: OfficeSessionBinding,
  references: ChatReferenceInputs,
) {
  if (
    role[0] !== "office-host" ||
    session.ownerId !== role[1].ownerId ||
    session.stage !== role[1].stage
  )
    return yield* Effect.fail(officeDenied());
  const live = revalidateOfficeSessionBinding(role[1].stage, session).pipe(
    Effect.mapError(officeCaught),
  );
  yield* live;
  const inputs = yield* Effect.try({
    try: () => freezeChatReferenceInputs(references),
    catch: officeCaught,
  });
  const resources = yield* officeStorageBindings;
  const owner: OwnerScope = role[1];
  const metadata = createOfficeMetadata({ ...resources, stage: owner.stage });
  yield* Effect.tryPromise({
    try: async () => {
      const reads = officeTaskTargetReads(metadata, owner, []);
      for (const input of inputs) {
        if (input.kind !== "native") continue;
        const target = input.target;
        const checked = await reads.view(target.viewId);
        const scope = checked.target.scope;
        if (
          checked.source.kind === "artifact" ||
          checked.view.documentId !== target.documentId ||
          checked.view.kind !== target.documentKind ||
          checked.view.revision !== target.expectedRevision ||
          checked.source.revision !== target.expectedRevision ||
          scope.kind !== target.kind ||
          (target.kind === "draft" &&
            (scope.kind !== "draft" ||
              scope.draftId !== target.draftId ||
              scope.generation !== target.generation))
        )
          throw officeDenied();
        if (target.kind === "draft") {
          const draft = await Effect.runPromise(metadata.draft(owner, target.draftId));
          if (draft?.generation !== target.generation) throw officeDenied();
        }
      }
    },
    catch: officeCaught,
  });
  yield* live;
  return true as const;
});
