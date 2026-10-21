import type { OfficeProviderOptions } from "./store.ts";
import { MetadataStore, storeEffect } from "./store.ts";
import { captureContext, forbidden } from "./coordinator/context.ts";
import type { VerifiedCoordinatorContext } from "./coordinator/types.ts";
import type { NativeEditorAdmission } from "./native-editor-schema.ts";
import { joinChannel, revokeChannel } from "./native-editor-channel.ts";
import { admitEditor } from "./native-editor-admit.ts";
import { stageEditor } from "./native-editor-journal.ts";
import { prepareEditor } from "./native-editor-preparation.ts";
import { observeEditor } from "./native-editor-proof.ts";
import { releaseEditor } from "./native-editor-turn.ts";

/** Trusted persistence only. T47 verifies the real joined request BEFORE constructing this facade. */
export function createNativeEditorAdmission(
  options: OfficeProviderOptions,
  verifiedContext: VerifiedCoordinatorContext,
): NativeEditorAdmission {
  const db = new MetadataStore(options),
    context = captureContext(db, verifiedContext);
  if (context.kind !== "editor") throw forbidden();
  return {
    join: (viewId, until) => storeEffect(() => joinChannel(db, context, viewId, until)),
    revoke: () => storeEffect(() => revokeChannel(db, context)),
    admit: (id, turnId, client) => storeEffect(() => admitEditor(db, context, id, turnId, client)),
    stage: (permit, leaf) => storeEffect(() => stageEditor(db, context, permit, leaf)),
    prepare: (permit, id, binding) =>
      storeEffect(() => prepareEditor(db, context, permit, id, binding)),
    observe: (permit) => storeEffect(() => observeEditor(db, context, permit)),
    release: (permit) => storeEffect(() => releaseEditor(db, context, permit)),
  };
}
