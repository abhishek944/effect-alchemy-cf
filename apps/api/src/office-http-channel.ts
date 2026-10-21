import { Option, Schema } from "effect";
import { Id, OfficeChannel, OfficeChannelRequest } from "@starter/office-contract";
export { OfficeChannel, OfficeChannelRequest } from "@starter/office-contract";
const decodeId = (value: string | undefined): string | null =>
  value === undefined ? null : Option.getOrNull(Schema.decodeUnknownOption(Id)(value));
const decodeChannel = (value: unknown) =>
  Option.getOrNull(Schema.decodeUnknownOption(OfficeChannel, { onExcessProperty: "error" })(value));
const scopedChannel = /^\/api\/office\/channels\/([A-Za-z0-9_-]{16,96})\/protocol(\/.*)$/;
const viewProtocol = /^\/api\/office\/views\/[A-Za-z0-9_-]{16,96}\/protocol(?:\/.*)?$/;
const unsafe = /%|\\|#|\/\.|\/\//;
const isNativePath = (path: string): boolean =>
  path.length <= 4096 &&
  !unsafe.test(path) &&
  (path.startsWith("/universer-api/") || viewProtocol.test(path));
const nativeQuery = (raw: URLSearchParams): string => {
  const forwarded = new URLSearchParams();
  for (const [name, value] of raw) if (name !== "channelId") forwarded.append(name, value);
  const text = forwarded.toString();
  return text.length === 0 ? "" : `?${text}`;
};
export type OfficeProtocol = {
  readonly channelId: string;
  readonly nativePath: string;
  readonly query: string;
};
/**
 * Two real authenticated selectors resolve to one canonical channel: an explicit channel-scoped
 * prefix (native suffix preserved), or the native path itself with one `channelId` selector query.
 * The selector is stripped before Node; no cookie, ticket or session header selects a channel.
 */
export function officeProtocolPath(
  method: string,
  pathname: string,
  raw: URLSearchParams,
): OfficeProtocol | null {
  if (method !== "GET" && method !== "POST") return null;
  const scoped = scopedChannel.exec(pathname);
  let channelId: string | null;
  let nativePath: string;
  if (scoped !== null) {
    channelId = decodeId(scoped[1]);
    nativePath = scoped[2] ?? "";
  } else {
    const selector = raw.getAll("channelId");
    if (selector.length !== 1) return null;
    channelId = decodeId(selector[0]);
    nativePath = pathname;
  }
  if (channelId === null || !isNativePath(nativePath)) return null;
  return { channelId, nativePath, query: nativeQuery(raw) };
}
export { decodeChannel as officeChannelReply };
export const officeChannelRequest = (value: unknown) =>
  Option.getOrNull(
    Schema.decodeUnknownOption(OfficeChannelRequest, { onExcessProperty: "error" })(value),
  );
