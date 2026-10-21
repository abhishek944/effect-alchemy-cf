import { Schema } from "effect";
import { Count, OfficeInvalid, decodeWireSync, safeFailure } from "@starter/office-contract";
import { HostId } from "@starter/office-server/native-remote";

export type OfficeControlOptions = {
  readonly endpoint: URL;
  readonly request: (request: Request) => Promise<Response>;
  readonly invocationId: string;
  readonly signal: AbortSignal;
  readonly deadline: number;
  readonly maxCalls: number;
  readonly maxBytes: number;
  readonly maxActive: number;
};
const Profile = Schema.Struct({
  invocationId: HostId,
  deadline: Count.check(Schema.isGreaterThanOrEqualTo(1)),
  maxCalls: Count.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65536)),
  maxBytes: Count.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(1024 * 1024 * 1024),
  ),
  maxActive: Count.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(64)),
});

/** Detach operator configuration; neither a URL nor an invocation ID authenticates the channel. */
export function officeChannelProfile(options: OfficeControlOptions) {
  const profile = Object.freeze(
    decodeWireSync(Profile)({
      invocationId: options.invocationId,
      deadline: options.deadline,
      maxCalls: options.maxCalls,
      maxBytes: options.maxBytes,
      maxActive: options.maxActive,
    }),
  );
  const endpoint = new URL(options.endpoint.href);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    typeof options.request !== "function" ||
    !(options.signal instanceof AbortSignal)
  )
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  const url = endpoint.href,
    request = options.request,
    parent = options.signal;

  return Object.freeze({ ...profile, url, request, signal: parent });
}
