import { Effect } from "effect";
import type { NativePrivateFile } from "../../office/src/native-private-wire.ts";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import type { ActorVerification, NativeTarget, OfficeMetadata } from "@starter/office-server/ports";
import type { HostOfficeRequest } from "@starter/office-server/native-remote";
import type { OfficeInvocation } from "./office-invocations.ts";
import type { OfficePlacement } from "./office-host-placements.ts";
import type { OfficeMetadataCall } from "./office-metadata-dispatch.ts";
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
export const officeDenied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
/** Actual Worker ref request/captured original association for the SDK's generic adapter context.
 * This is correlation only: native access is enforced by the separately acquired provider fence. */
export const officeNativeContext = (original: OfficePrivateRequest, request: object) => ({
  userID: original.original.actor.owner.ownerId,
  customData: { office: original },
  request,
});
const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** Finite DTO equality only, never original caller proof. */
export function officeSame(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value: unknown, index) => officeSame(value, right[index]))
    );
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && officeSame(left[key], right[key]))
  );
}

/** Real original private record + fresh session liveness; claims data alone never reaches this function. */
export function officePrivateAuthority(metadata: OfficeMetadata, request: OfficePrivateRequest) {
  const actor = request.original.actor;
  const live = Effect.tryPromise({ try: request.live, catch: officeDenied });
  function target(input: NativeTarget) {
    return Effect.gen(function* () {
      if (!officeSame(input.owner, actor.owner)) return yield* Effect.fail(officeDenied());
      const document = yield* metadata.document(actor.owner, input.documentId);
      if (document === null || document.unitId !== input.unitId)
        return yield* Effect.fail(officeDenied());
      if (input.scope.kind === "draft") {
        const draft = yield* metadata.draft(actor.owner, input.scope.draftId);
        if (
          draft === null ||
          draft.documentId !== input.documentId ||
          draft.generation !== input.scope.generation
        )
          return yield* Effect.fail(officeDenied());
      }
      return undefined;
    });
  }
  const verify = (input: ActorVerification) =>
    Effect.gen(function* () {
      yield* live;
      const claims = input.claims;
      if (
        claims.capability !== "human" ||
        claims.principalId !== actor.principalId ||
        (input.phase !== "recovery-observe" && claims.sessionEpoch !== actor.sessionEpoch) ||
        !officeSame(claims.owner, actor.owner)
      )
        return yield* Effect.fail(officeDenied());
      if (input.phase === "request") {
        if (!officeSame(claims, actor)) return yield* Effect.fail(officeDenied());
        if (input.target !== null) yield* target(input.target);
      } else {
        if (
          input.phase !== "recovery-observe" &&
          (claims.expiresAt <= Date.now() ||
            request.command === null ||
            !("operationId" in request.command.input) ||
            request.command.input.operationId !== input.operationId ||
            ["office.receipt", "office.cancel"].includes(request.command.method))
        )
          return yield* Effect.fail(officeDenied());
        const operation = yield* metadata.operation(actor.owner, input.operationId);
        if (
          operation === null ||
          !officeSame(operation.actor, claims) ||
          operation.intentDigest !== input.intentDigest ||
          operation.unitId !== input.target.unitId ||
          operation.documentId !== input.target.documentId
        )
          return yield* Effect.fail(officeDenied());
        // Observation preserves old control identity, without granting old-generation content reads.
        if (input.phase !== "recovery-observe") yield* target(input.target);
      }
      yield* live;
      return undefined;
    });
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
