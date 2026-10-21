/** Public image accounting only; never canonical requests, prompts or native tasks. */
export type ImageCost =
  | {
      kind: "reported";
      amount: number;
      currency: string;
      source: string;
      basis: "provider-response" | "gateway-estimate";
    }
  | {
      kind: "estimated";
      completeness: "complete" | "partial";
      usd: number;
      components: Readonly<Record<string, number>>;
      missing: readonly string[];
      sources: readonly string[];
    }
  | { kind: "unknown"; missing: readonly string[] };

export type ImageUsageValue =
  | number
  | string
  | boolean
  | null
  | readonly ImageUsageValue[]
  | { readonly [key: string]: ImageUsageValue };
export type ImageOutputMetadata = {
  index: number;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
};
export type ImageCallMetadata = {
  model: string;
  provider: string;
  durationMs: number;
  requestId?: string;
  reportedUsage?: Readonly<Record<string, ImageUsageValue>>;
  cost: ImageCost;
  outputs: readonly ImageOutputMetadata[];
  quality?: string;
  size?: string;
};
export type ImageCallPresentation = {
  callId: string;
  messageId: string;
  status: "prepared" | "started" | "complete" | "failed" | "unresolved";
  dispatched: boolean;
  outputCount: number;
  uncertain: boolean;
  storageUncertain: boolean;
  partial: boolean;
  cost: ImageCost;
  metadata: ImageCallMetadata | null;
};
export type ImageUsagePresentation = {
  callCount: number;
  startedCalls: number;
  dispatchedCalls: number;
  notDispatchedCalls: number;
  reportedUsd: number;
  estimatedUsd: number;
  partialEstimatedUsd: number;
  unknownCalls: number;
  partialCalls: number;
  otherCurrencyCalls: number;
  completeness: "complete" | "partial" | "unknown";
  recent: readonly ImageCallPresentation[];
};
