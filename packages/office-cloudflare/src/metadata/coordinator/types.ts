import type {
  SerialAdmission,
  Store,
  NativeTarget,
  OwnerScope,
} from "@starter/office-server/ports";

export type DocumentKey = {
  readonly owner: OwnerScope;
  readonly documentId: string;
  readonly unitId: string;
};
type VerifiedBase = {
  readonly document: DocumentKey;
  readonly authorizationDigest: string;
  readonly notAfter: number;
};
export type CoreBinding =
  | {
      readonly kind: "operation";
      readonly operationId: string;
      readonly intentDigest: string;
      readonly lineageDigest: string;
    }
  | {
      readonly kind: "new-merge";
      readonly operationId: string;
      readonly approvalOperationId: string;
      readonly principalId: string;
      readonly sessionEpoch: number;
      readonly reviewFingerprint: string;
    };
/** Supplied only after T47 verifies the real request. Decoding this type is not authentication. */
export type VerifiedCoordinatorContext = VerifiedBase &
  (
    | { readonly kind: "placement"; readonly nodeId: string }
    | {
        readonly kind: "core";
        readonly target: NativeTarget;
        readonly binding: CoreBinding;
        readonly placementId: string;
        readonly purpose: SerialAdmission["purpose"];
      }
    | {
        readonly kind: "editor";
        readonly target: NativeTarget;
        readonly channelId: string;
        readonly placementId: string;
        readonly editorId: string;
        readonly editorEpoch: number;
        readonly principalId: string;
        readonly sessionEpoch: number;
        readonly memberId: string;
      }
    | { readonly kind: "read"; readonly target: NativeTarget; readonly viewId: string }
  );
export type Placement = DocumentKey & {
  readonly id: string;
  readonly nodeId: string;
  readonly authorityEpoch: number;
  readonly serviceEpoch: number;
  readonly until: number;
  readonly state: "live" | "retired";
};
export type PlacementChange =
  | {
      readonly kind: "claim";
      readonly id: string;
      readonly nodeId: string;
      readonly expectedServiceEpoch: number | null;
      readonly until: number;
    }
  | {
      readonly kind: "renew";
      readonly id: string;
      readonly serviceEpoch: number;
      readonly until: number;
    }
  | { readonly kind: "retire"; readonly id: string; readonly serviceEpoch: number };
export type Turn = {
  readonly id: string;
  readonly version: number;
  /** Immutable admission fence; unlike version, it does not change on an in-lease renewal. */
  readonly fence: number;
  readonly target: NativeTarget;
  readonly placementId: string;
  readonly commandId: string;
  readonly stepId: string;
  readonly authorityEpoch: number;
  readonly serviceEpoch: number;
  readonly deadline: number;
  readonly authNotAfter: number;
  readonly mode: SerialAdmission["purpose"];
  readonly state: "held" | "released" | "expired";
  readonly origin: CoreBinding;
  readonly authorizationDigest: string;
  readonly admission: SerialAdmission;
  readonly nativePlan: "fresh" | "ready-capture" | "newborn-unit" | null;
};
export type TurnChange =
  | { readonly kind: "renew"; readonly until: number }
  | { readonly kind: "release" };
/** First implemented slice only: no cast or placeholder for later channel/editor/file methods. */
export interface CoordinatorControl {
  placement(document: DocumentKey): Store<Placement | null>;
  place(document: DocumentKey, change: PlacementChange): Store<Placement>;
  acquireCore(
    id: string,
    placementId: string,
    target: NativeTarget,
    admission: SerialAdmission,
  ): Store<Turn>;
  changeTurn(id: string, expectedVersion: number, action: TurnChange): Store<Turn>;
}
