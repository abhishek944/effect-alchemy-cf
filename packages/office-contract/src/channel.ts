import { Schema } from "effect";
import * as Endpoint from "effect/http-api/HttpApiEndpoint";
import { OfficeErrors } from "./errors.ts";
import { Count, Id } from "./primitives.ts";

/** Authenticated public channel acquisition; these selectors are not credentials. */
export const OfficeChannelRequest = Schema.Struct({
  viewId: Id,
  editorId: Schema.NullOr(Id),
});
export type OfficeChannelRequest = typeof OfficeChannelRequest.Type;
export const OfficeChannel = Schema.Struct({
  channelId: Id,
  expiresAt: Count,
  protocolBase: Schema.String.check(
    Schema.isPattern(/^\/api\/office\/channels\/[A-Za-z0-9_-]{16,96}$/),
  ),
}).check(
  Schema.makeFilter((value) => value.protocolBase === `/api/office/channels/${value.channelId}`),
);
export type OfficeChannel = typeof OfficeChannel.Type;
export const OfficeChannelEndpoint = Endpoint.post("channel", "/api/office/channels", {
  payload: OfficeChannelRequest,
  error: OfficeErrors,
  success: OfficeChannel,
});
