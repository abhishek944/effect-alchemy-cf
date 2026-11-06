import { officePrivateStream } from "./office-private-stream.ts";
import { officeDenied } from "./office-private-authority.ts";
import type { officeHostFrameIO } from "./office-host-frame-io.ts";

type Owner = ReturnType<typeof officeHostFrameIO>;
/** Bounded metadata only. Actual body-reader/pull ownership survives returning HTTP headers. */
export function officePrivateResponse(
  value: unknown,
  maximum: number | null,
  owner: Owner,
  signal: AbortSignal,
  deadline: number,
  cleanup: boolean,
  peer: () => Promise<void>,
  status: number = 200,
) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (maximum !== null && bytes.byteLength > maximum) throw officeDenied();
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const resource = officePrivateStream(
    source,
    Math.max(1, bytes.byteLength),
    signal,
    deadline,
    peer,
    () => owner.revokeWork(),
  ); // Peer-only final verification: cleanup never revives expired work authority.
  owner.hold(resource, cleanup);
  return new Response(resource.body, {
    status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}
