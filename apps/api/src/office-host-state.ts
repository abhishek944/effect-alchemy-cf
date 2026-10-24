import type * as cf from "@cloudflare/workers-types";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { OfficeMetadata, OwnerScope } from "@starter/office-server/ports";
import type { HostPolicy } from "@starter/office-server/native-remote";
import type { NativePrivateResolution } from "../../office/src/native-private-wire.ts";
import type { OfficeInvocationRegistry } from "./office-invocations.ts";
import type { OfficeNamespace } from "./office-private-bindings.ts";
import type { OfficePrivateBackend } from "./office-private-backend.ts";
import type { OfficeHostProcess } from "./office-host-process.ts";
import type { OfficeHostPlacements } from "./office-host-placements.ts";
import type { OfficeHostFrame } from "./office-host-frame.ts";
import type { officeHostFrameIO } from "./office-host-frame-io.ts";
import type { OfficeEditorBinding } from "./office-editor-grants.ts";

export type OfficeHostEntry = {
  readonly frame: OfficeHostFrame;
  readonly backend: OfficePrivateBackend;
  readonly resolution: NativePrivateResolution;
  readonly canonical: boolean;
  readonly channelId: string | null;
  closing?: Promise<void>;
};
export type OfficeHostChannel = {
  readonly entry: OfficeHostEntry;
  readonly binding: OfficeEditorBinding;
  readonly frames: Set<OfficeHostEntry>;
  readonly expiresAt: number;
  readonly maintain: () => Promise<void>;
  closing?: Promise<void>;
};
export type OfficeHostActive = {
  readonly options: OfficeProviderOptions;
  readonly metadata: OfficeMetadata;
  readonly placements: OfficeHostPlacements;
  readonly nodeId: string;
};
/** One concrete application composition state; no alternate provider/coordinator/NativeWorker. */
export interface OfficeHostRuntime {
  readonly state: cf.DurableObjectState;
  readonly owner: OwnerScope;
  readonly registry: OfficeInvocationRegistry;
  readonly namespace: OfficeNamespace;
  readonly self: cf.Fetcher;
  readonly policy: typeof HostPolicy.Type;
  readonly process: OfficeHostProcess;
  readonly bootIO: ReturnType<typeof officeHostFrameIO>;
  readonly entries: Map<string, OfficeHostEntry>;
  readonly channels: Map<string, OfficeHostChannel>;
  readonly consumed: Map<string, number>;
  readonly nativeAttempts: Map<string, number>;
  readonly stopped: Promise<void>;
  markStopped(): void;
  active(): Promise<OfficeHostActive>;
  close(): Promise<void>;
  closing: boolean;
  binaryActive: number;
}
