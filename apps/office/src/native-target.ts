import { decodeWireSync } from "@starter/office-contract";
import { HostPermit, HostTarget } from "@starter/office-server/native-remote";
import type { NativeTarget, WritePermit } from "@starter/office-server/ports";

/** Detached identity validation only; never an authentication or admission constructor. */
export function captureNativeTarget(input: NativeTarget): NativeTarget {
  const target = decodeWireSync(HostTarget)(input);
  return Object.freeze({
    ...target,
    owner: Object.freeze({ ...target.owner }),
    scope: Object.freeze({ ...target.scope }),
  });
}
export function captureWritePermit(input: WritePermit): WritePermit {
  const permit = decodeWireSync(HostPermit)(input);
  return Object.freeze({
    ...permit,
    owner: Object.freeze({ ...permit.owner }),
    target: captureNativeTarget(permit.target),
  });
}
export function sameNativeTarget(left: NativeTarget, right: NativeTarget): boolean {
  return (
    left.owner.stage === right.owner.stage &&
    left.owner.ownerId === right.owner.ownerId &&
    left.documentId === right.documentId &&
    left.unitId === right.unitId &&
    (left.scope.kind === "main"
      ? right.scope.kind === "main"
      : right.scope.kind === "draft" &&
        left.scope.draftId === right.scope.draftId &&
        left.scope.generation === right.scope.generation)
  );
}
