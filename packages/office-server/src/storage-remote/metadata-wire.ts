/** Exact schemas for existing ports only; this is not a dynamic RPC implementation. */
import type { OfficeMetadata, OfficeBytes } from "../ports/index.ts";
import { HostMetadataReads, HostBytes } from "./metadata-read-wire.ts";
import { HostMetadataWrites } from "./metadata-write-wire.ts";

export const HostMetadata = Object.freeze({
  ...HostMetadataReads,
  ...HostMetadataWrites,
} satisfies Record<keyof OfficeMetadata, object>);
const bytesMethods = HostBytes satisfies Record<keyof OfficeBytes, object>;
export { bytesMethods as HostBytes };
