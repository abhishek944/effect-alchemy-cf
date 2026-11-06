import { Schema } from "effect";
import { OwnerClaims } from "@highchat/office-server/ports";
import { HostId } from "@highchat/office-server/native-remote";
import { Id } from "@highchat/office-contract";

export const OfficeHostRole = Schema.Union([
  Schema.Tuple([Schema.Literal("office-host"), OwnerClaims]),
  Schema.Tuple([Schema.Literal("office-job"), OwnerClaims, Id, HostId, Id]),
]);
export type OfficeHostRole = typeof OfficeHostRole.Type;
