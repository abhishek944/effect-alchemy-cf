import { createStrictNativeStorage } from "@starter/office-cloudflare/native";
import type {
  NativeValueHeader,
  NativeValueRef,
  NativeScope,
} from "@starter/office-cloudflare/native";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { OfficeMetadata } from "@starter/office-server/ports";
import type { HostNativeProducer } from "@starter/office-server/native-remote";
import type { OfficeHeldTurn } from "./office-private-turns.ts";
import { officeEditorPreparation, type OfficeEditorHeld } from "./office-editor-grants.ts";
import { officeNativePreparation } from "./office-native-preparation.ts";
import { officeNativeProducer } from "./office-native-producer.ts";
import { officeNativeBasis } from "./office-native-basis.ts";
import { assertOfficeTaskBasis } from "./office-task-native-policy.ts";
import type { OfficePrivateRequest } from "./office-private-authority.ts";

/** One actual strict writer for the FIRST acknowledged Core/SDK-member grant, never a guessed fence. */
export async function officeNativeWriter(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  held: OfficeHeldTurn | OfficeEditorHeld,
  request: OfficePrivateRequest,
  imageDigest: string,
  policyVersion: string,
) {
  await request.live();
  const { target } = held.permit;
  const scope: NativeScope = {
    stage: target.owner.stage,
    ownerID: target.owner.ownerId,
    documentID: target.documentId,
    unitID: target.unitId,
  };
  const fence = await officeNativeBasis(options, metadata, held, request);
  await assertOfficeTaskBasis(metadata, request, held, fence);
  await request.live();
  const proof = officeNativeProducer(held, request, imageDigest, policyVersion);
  const storage = createStrictNativeStorage(options, scope, {
    admission:
      held.kind === "core"
        ? {
            turnId: held.turn.id,
            fence: held.turn.fence,
            authorizationDigest: held.turn.authorizationDigest,
            notAfter: held.turn.authNotAfter,
          }
        : held.admission,
    beforePublication:
      held.kind === "core"
        ? officeNativePreparation(options, metadata, held, request)
        : officeEditorPreparation(held, request.live),
    verifyProducer: (value, header, actual) => proof.verify(value, header, actual),
  });
  const writer = storage.invocation(fence);
  return {
    kind: held.kind,
    writer,
    verify: (value: NativeValueRef, producer: typeof HostNativeProducer.Type) =>
      proof.committed(value, producer),
    async register(
      value: NativeValueRef,
      header: NativeValueHeader,
      producer: typeof HostNativeProducer.Type,
    ) {
      await proof.register(value, header, producer);
      return writer.references.payloads.registerValue(value, header);
    },
  };
}
