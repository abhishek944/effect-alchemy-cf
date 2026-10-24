import { Effect } from "effect";
import type { NativePrivateFile } from "../../office/src/native-private-wire.ts";
import type { OfficeMetadata } from "@starter/office-server/ports";
import type { HostOfficeRequest } from "@starter/office-server/native-remote";
import type { OfficeInvocation } from "./office-invocations.ts";
import type { OfficePlacement } from "./office-host-placements.ts";
import type { OfficeMetadataCall } from "./office-metadata-dispatch.ts";
import { officeHumanAuthority } from "./office-private-human.ts";
import { officeDenied, officeSame } from "./office-private-values.ts";
export { officeDenied, officeSame, officeSameView } from "./office-private-values.ts";
import { officeTaskVerifier } from "./office-task-file-actor.ts";

export type OfficePrivateIO = {
  readonly close: () => Promise<void>;
  readonly drain: () => Promise<void>;
};
export type OfficePrivateRequest = {
  readonly id: string;
  readonly original: OfficeInvocation;
  readonly command: HostOfficeRequest | null;
  readonly file: NativePrivateFile | null;
  readonly viewId: string | null;
  readonly cleanupDeadline: number;
  readonly signal: AbortSignal;
  readonly currentPlacement: (documentId: string) => Promise<OfficePlacement>;
  readonly charge: (bytes: number) => void;
  readonly receive: (callId: string) => void;
  readonly keepIO: (resource: OfficePrivateIO, cleanup: boolean) => void;
  /** Actual original process proof is checked before this object is selected. */
  readonly live: () => Promise<void>;
};
export { officeCaught } from "./office-failure.ts";
/** Actual Worker ref request/captured original association for the SDK's generic adapter context.
 * This is correlation only: native access is enforced by the separately acquired provider fence. */
export const officeNativeContext = (original: OfficePrivateRequest, request: object) => ({
  userID: original.original.actor.owner.ownerId,
  customData: { office: original },
  request,
});
/** Real original private record + fresh session liveness; claims data alone never reaches this function. */
export function officePrivateAuthority(metadata: OfficeMetadata, request: OfficePrivateRequest) {
  const actor = request.original.actor;
  const { verify, target, live } = officeHumanAuthority(metadata, request);
  const authorize = (call: OfficeMetadataCall) =>
    Effect.gen(function* () {
      yield* live;
      const input = call.input;
      const owner =
        "owner" in input
          ? input.owner
          : "record" in input
            ? input.record.owner
            : "permit" in input
              ? input.permit.owner
              : "review" in input
                ? input.review.owner
                : "approval" in input
                  ? input.approval.owner
                  : null;
      if (owner === null || !officeSame(owner, actor.owner))
        return yield* Effect.fail(officeDenied());
      if (call.method === "metadata.prepareWrite" || call.method === "metadata.claimQueued")
        return yield* Effect.fail(officeDenied());
      if ("record" in input && "actor" in input.record && !officeSame(input.record.actor, actor)) {
        if (call.method !== "metadata.advanceOperation") return yield* Effect.fail(officeDenied());
        const stored = yield* metadata.operation(
          actor.owner,
          call.input.record.receipt.operationId,
        );
        if (
          stored === null ||
          stored.actor.principalId !== actor.principalId ||
          !officeSame(stored.actor, call.input.record.actor)
        )
          return yield* Effect.fail(officeDenied());
        // Preserve the immutable original actor during proven receipt/metadata repair. No native grant.
      }
      if (
        call.method === "metadata.approve" &&
        (request.command?.method !== "office.approve" ||
          call.input.approval.operationId !== request.command.input.operationId ||
          call.input.approval.reviewId !== request.command.input.reviewId ||
          call.input.approval.humanPrincipalId !== actor.principalId ||
          call.input.approval.sessionEpoch !== actor.sessionEpoch)
      )
        return yield* Effect.fail(officeDenied());
      if (
        call.method === "metadata.admitPublication" &&
        !officeSame(call.input.operation.actor, actor)
      )
        return yield* Effect.fail(officeDenied());
      if (request.command === null) {
        if (
          ![
            "metadata.document",
            "metadata.draft",
            "metadata.view",
            "metadata.editor",
            "metadata.editors",
          ].includes(call.method)
        )
          return yield* Effect.fail(officeDenied());
      } else if ("operationId" in request.command.input) {
        const id = request.command.input.operationId;
        if (
          ("permit" in input && input.permit.operationId !== id) ||
          ("record" in input &&
            "originOperationId" in input.record &&
            input.record.originOperationId !== id) ||
          ("record" in input &&
            "receipt" in input.record &&
            input.record.receipt.operationId !== id) ||
          ("record" in input &&
            "job" in input.record &&
            input.record.job.binding.operationId !== id)
        )
          return yield* Effect.fail(officeDenied());
      }
      return undefined;
    });
  return { verify: officeTaskVerifier(metadata, request, verify), authorize, target, live };
}
