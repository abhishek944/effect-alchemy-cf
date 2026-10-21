import { Effect } from "effect";
import { createCoordinatorControl } from "@starter/office-cloudflare/coordinator-control";
import type {
  CoordinatorControl,
  VerifiedCoordinatorContext,
} from "@starter/office-cloudflare/coordinator-control";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type {
  OfficeMetadata,
  NativeTarget,
  SerialAdmission,
  WritePermit,
} from "@starter/office-server/ports";
import { officeCoreContext } from "./office-private-placement.ts";
import { assertOfficeTaskSerial } from "./office-task-native-policy.ts";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";

type Turn = Effect.Success<ReturnType<CoordinatorControl["acquireCore"]>>;
export type OfficeHeldTurn = {
  readonly kind: "core";
  readonly context: VerifiedCoordinatorContext;
  readonly turn: Turn;
  readonly permit: WritePermit;
};
export function officePrivateTurns(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  nodeId: string,
  request: OfficePrivateRequest,
  nativeAttempts: Map<string, number>,
) {
  const held = new Map<string, OfficeHeldTurn>();
  const attempted = new Set<string>();
  const releasing = new Map<
    string,
    {
      readonly version: number;
      readonly promise: Promise<{
        readonly turnId: string;
        readonly version: number;
        readonly state: "held" | "released" | "expired";
      }>;
    }
  >();
  function release(id: string, version: number) {
    const known = releasing.get(id);
    if (known !== undefined) {
      if (known.version !== version) return Promise.reject(officeDenied());
      return known.promise;
    }
    const original = held.get(id);
    if (original === undefined || original.turn.version !== version)
      return Promise.reject(officeDenied());
    const promise = Promise.resolve().then(async () => {
      const cleanup = { ...original.context, notAfter: request.cleanupDeadline };
      const changed = await Effect.runPromise(
        createCoordinatorControl(options, cleanup).changeTurn(id, version, { kind: "release" }),
      );
      held.delete(id);
      return { turnId: changed.id, version: changed.version, state: changed.state };
    });
    releasing.set(id, { version, promise });
    return promise;
  }
  function requirePermit(permit: WritePermit): OfficeHeldTurn {
    const original = [...held.values()].find((item) => officeSame(item.permit, permit));
    if (
      original === undefined ||
      releasing.has(original.turn.id) ||
      original.turn.state !== "held" ||
      original.turn.deadline <= Date.now()
    )
      throw officeDenied();
    return original;
  }
  return {
    verifyPermit: requirePermit,
    async acquire(attemptId: string, target: NativeTarget, admission: SerialAdmission) {
      await request.live();
      if (
        attempted.has(attemptId) ||
        held.size >= 8 ||
        request.command === null ||
        !("operationId" in request.command.input) ||
        request.command.input.operationId !== admission.operationId
      )
        throw officeDenied();
      await assertOfficeTaskSerial(metadata, request, target, admission);
      const identity = JSON.stringify([
        admission.operationId,
        target.owner.stage,
        target.owner.ownerId,
        target.documentId,
        target.unitId,
        target.scope.kind === "main"
          ? ["main"]
          : ["draft", target.scope.draftId, target.scope.generation],
      ]);
      if (admission.purpose === "native") {
        for (const [key, until] of nativeAttempts)
          if (until <= Date.now()) nativeAttempts.delete(key);
        if (nativeAttempts.has(identity) || nativeAttempts.size >= 4096) throw officeDenied();
        // Immutable ORIGINAL actor expiry: expiring this deny memo can never refresh that actor.
        nativeAttempts.set(identity, request.original.actor.expiresAt);
      }
      attempted.add(attemptId); // First ACK only; failure is never an invitation to acquire again.
      const context = await officeCoreContext(
        options,
        metadata,
        nodeId,
        request,
        target,
        admission.operationId,
        admission.purpose,
      );
      const control = createCoordinatorControl(options, context);
      const turn = await Effect.runPromise(
        control.acquireCore(attemptId, context.placementId, target, admission),
      );
      if (turn.state !== "held" || turn.deadline <= Date.now()) throw officeDenied();
      const permit: WritePermit = {
        owner: target.owner,
        documentId: target.documentId,
        operationId: turn.commandId,
        stepId: turn.stepId,
        authorityEpoch: turn.authorityEpoch,
        serviceEpoch: turn.serviceEpoch,
        target,
        expectedHead: admission.expectedHead,
        expectedGeneration: target.scope.kind === "draft" ? target.scope.generation : null,
        reviewFingerprint: admission.reviewFingerprint,
      };
      held.set(attemptId, { kind: "core", context, turn, permit });
      return {
        turnId: turn.id,
        version: turn.version,
        fence: turn.fence,
        deadline: turn.deadline,
        notAfter: turn.authNotAfter,
        permit,
      };
    },
    require(permit: WritePermit): OfficeHeldTurn {
      const original = requirePermit(permit);
      if (original.turn.mode !== "native") throw officeDenied();
      return original;
    },
    provisional(operationId: string): OfficeHeldTurn {
      const original = [...held.values()].find(
        (item) =>
          item.turn.commandId === operationId &&
          item.context.kind === "core" &&
          item.context.binding.kind === "new-merge",
      );
      if (original === undefined || original.turn.mode !== "native") throw officeDenied();
      return requirePermit(original.permit);
    },
    release,
    async drain() {
      const released = await Promise.allSettled(
        [...held.values()].map((original) => release(original.turn.id, original.turn.version)),
      );
      if (released.some((item) => item.status === "rejected")) throw officeDenied();
    },
  };
}
export type OfficePrivateTurns = ReturnType<typeof officePrivateTurns>;
