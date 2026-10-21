import { createOfficeControlChannel, createOfficeManifestChannel } from "./native-channel.ts";
import { createOfficeBinaryChannel } from "./native-transfer.ts";
import type { OfficeRequestChannels } from "./native-request-context.ts";
import type { NativePrivateConnection } from "./native-private-connection.ts";
import type { NativePrivateResolution } from "./native-private-wire.ts";

/** Only called after genuine private Worker resolution; these are actual owned transports, not grants. */
export function nativePrivateChannels(
  connection: NativePrivateConnection,
  value: NativePrivateResolution,
  signal: AbortSignal,
): OfficeRequestChannels {
  const cleanup = new AbortController();
  const profile = {
    request: connection.request,
    invocationId: value.invocationId,
    signal,
    deadline: value.deadline,
    maxCalls: 65536,
    maxBytes: 1024 * 1024 * 1024,
    maxActive: 64,
  };
  const endpoint = (role: string) =>
    new URL(`${connection.origin}/private/${value.invocationId}/${role}`);
  return {
    work: createOfficeControlChannel({ ...profile, endpoint: endpoint("control") }),
    manifest: createOfficeManifestChannel({ ...profile, endpoint: endpoint("manifest") }),
    binary: createOfficeBinaryChannel({ ...profile, endpoint: endpoint("binary") }),
    cleanup: createOfficeControlChannel({
      ...profile,
      endpoint: endpoint("cleanup"),
      signal: cleanup.signal,
      deadline: value.cleanupDeadline,
    }),
  };
}
