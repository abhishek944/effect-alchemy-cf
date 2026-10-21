import type * as cf from "@cloudflare/workers-types";
import type { DurableImageHost } from "@abhishek944/pi-image-gen/durable";
import type {
  CloudflareRun,
  ImageMetadata,
  PreparedImageRequest,
} from "@abhishek944/pi-image-gen/core";
import type { Storage } from "@earendil-works/pi-durable";
import type { ChatImageCallStore } from "./chat-image-call-store.ts";
import type { ImageCallFile, ImageCallUpdate } from "./chat-image-call-schema.ts";
import type { ProvenImageCall } from "./chat-image-native-proof.ts";
import type { ImageNativeAccess } from "./chat-image-request-types.ts";
import type { ImageMemoryLease } from "./chat-image-memory.ts";
import type { SavedOriginalMetadata } from "./chat-library-original.ts";
import type { SavedFile } from "./chat-library-schema.ts";
import type { ChatGeneratedClient } from "./chat-generated-client.ts";

export type ImageHostCallback = DurableImageHost<SavedFile>["runAdmittedCall"];
export type ImageHostApi = Parameters<ImageHostCallback>[0];
export type ImageHostContext = Parameters<ImageHostCallback>[1];
export type ImageHostRun = Parameters<ImageHostCallback>[3];
export type ImageHostReady = Extract<ProvenImageCall["snapshot"]["image"], { state: "ready" }>;

export type ChatImageHostDependencies = {
  readonly storage: Storage;
  readonly proofAccess: ImageNativeAccess;
  readonly calls: ChatImageCallStore;
  readonly catalog: cf.DurableObjectStub;
  /** Parent resolves this from the authenticated owner's real catalog namespace lookup. */
  readonly expectedOwnerScope: string;
  readonly bucket: cf.R2Bucket;
  /** Actual bound AI.run adapter. The host forwards every package argument unchanged. */
  readonly cloudflareRun: CloudflareRun | undefined;
  /** Trusted current binding/stage check, never a browser configuration claim or probe. */
  readonly configurationReady: (frozen: ImageHostReady) => boolean;
  /** Exact proven operation's skill health; refuses before any paid dispatch. */
  readonly dispatchGate: (operationId: string) => Promise<void>;
  /** Synchronous final known-failure fence; null means allowed. */
  readonly dispatchFence: (operationId: string) => string | null;
  readonly notify: () => void | Promise<void>;
  readonly waitUntil: (work: Promise<void>) => void;
};

export type ImageHostSource = {
  readonly url: string;
  readonly authority: SavedOriginalMetadata;
};
export type ImageHostPlan = {
  readonly proof: ProvenImageCall;
  readonly key: string;
  readonly request: PreparedImageRequest;
  readonly requestDigest: string;
  readonly sources: readonly ImageHostSource[];
  readonly assistantEntryId: number;
  readonly modelIndex: number;
  readonly callPosition: number;
};
export type ImageHostLifetime = {
  readonly lease: ImageMemoryLease;
  drain(): Promise<void>;
};
export type ImageHostExecution = {
  readonly deps: ChatImageHostDependencies;
  readonly plan: ImageHostPlan;
  readonly lifetime: ImageHostLifetime;
  readonly client: ChatGeneratedClient;
  readonly files: Map<number, SavedFile>;
  readonly responses: Set<Response>;
  readonly paidBlocked: () => boolean;
  readonly blockPaid: () => void;
  retainedOutputBackingBytes: number;
  dispatched: boolean;
  storing: boolean;
  metadata?: ImageMetadata;
};
export type ImageHostOutcome = ImageCallUpdate["outcome"];
export type ImageHostFiles = readonly ImageCallFile[];
