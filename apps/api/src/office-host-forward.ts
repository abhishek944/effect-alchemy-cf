import { officePrivateStream } from "./office-private-stream.ts";
import { Schema } from "effect";
import { reportFailure } from "@starter/diagnostics";
import { decodeWireSync } from "@starter/office-contract";
import { HostOffice, hostEnvelope } from "@starter/office-server/native-remote";
import { readOfficePrivateJson } from "./office-private-json.ts";
import { closeOfficeHostEntry } from "./office-host-entry.ts";
import { officeDenied } from "./office-private-authority.ts";
import type { OfficeHostEntry, OfficeHostRuntime } from "./office-host-state.ts";

const CoreReply = hostEnvelope(
  Schema.Union(Object.values(HostOffice).map((definition) => definition.response)),
);
/** Exactly one dispatch; actual original ingress abort and body ownership remain linked. */
export async function forwardOfficeHost(
  root: OfficeHostRuntime,
  entry: OfficeHostEntry,
  incoming: Request,
  path: string,
  body: ReadableStream<Uint8Array> | string | null,
  maximum: number,
  protocol: boolean,
  callId: string | null = null,
) {
  const escalate = (reason: string) => (cause: unknown) => {
    if (!root.closing)
      reportFailure(cause, {
        component: "office.host",
        operation: "cleanup-escalation",
        reason,
        eventId: entry.frame.id,
      });
    return root.close();
  };
  const abort = () => entry.frame.revoke();
  incoming.signal.addEventListener("abort", abort, { once: true });
  if (incoming.signal.aborted) abort();
  const headers = new Headers({ "x-office-invocation": entry.frame.id });
  if (protocol) {
    for (const key of [
      "content-type",
      "upgrade",
      "connection",
      "sec-websocket-key",
      "sec-websocket-version",
      "sec-websocket-protocol",
      "sec-websocket-extensions",
    ])
      if (incoming.headers.has(key)) headers.set(key, incoming.headers.get(key) ?? "");
  } else
    headers.set(
      "content-type",
      entry.resolution.file === null ? "application/json" : "application/octet-stream",
    );
  const init: RequestInit & { duplex: "half" } = {
    method: protocol ? incoming.method : "POST",
    headers,
    body,
    signal: entry.frame.work.signal,
    redirect: "manual",
    duplex: "half",
  };
  try {
    const response = await root.process.request(
      new Request("http://office-node.internal" + path, init),
    );
    if (entry.frame.request.command !== null) {
      const reply = decodeWireSync(CoreReply)(
        await readOfficePrivateJson(
          response.body,
          entry.frame.work.signal,
          entry.frame.deadline,
          16 * 1024,
        ),
      );
      if (
        response.status !== 200 ||
        reply.invocationId !== entry.frame.id ||
        reply.callId !== callId ||
        reply.payload.method !== entry.frame.request.command.method
      )
        throw officeDenied();
      await entry.frame.request.live();
      await closeOfficeHostEntry(root, entry);
      incoming.signal.removeEventListener("abort", abort);
      // Only bounded metadata is translated: the public decoder already supports this bare reply.
      return Response.json(reply.payload);
    }
    if (response.status === 101) {
      if (entry.frame.kind !== "upgrade" || response.webSocket === null) throw officeDenied();
      // Transfer the GENUINE native101 socket. No fetch-to-JSON or invented socket/SDK bridge.
      root.state.waitUntil(
        closeOfficeHostEntry(root, entry)
          .catch(escalate("upgrade-entry-close"))
          .catch(() => undefined),
      );
      return response;
    }
    const source =
      response.body ??
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    const finish = async () => {
      await closeOfficeHostEntry(root, entry);
      incoming.signal.removeEventListener("abort", abort);
    };
    const resource = officePrivateStream(
      source,
      maximum,
      entry.frame.work.signal,
      entry.frame.deadline,
      finish,
      abort,
    );
    // This public body OWNS finish; it is NOT registered in its own frame, avoiding a self-join.
    const output = new Response(resource.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, no-store",
      },
    });
    root.state.waitUntil(
      resource
        .drain()
        .catch(async (cause) => {
          reportFailure(cause, {
            component: "office.host",
            operation: "forward-body",
            eventId: entry.frame.id,
          });
          // A failed response is not a failed host. Escalate only if its owner cannot close.
          await finish();
        })
        .catch(escalate("forward-entry-close"))
        .catch(() => undefined),
    );
    return output;
  } catch (error) {
    abort();
    incoming.signal.removeEventListener("abort", abort);
    root.state.waitUntil(
      closeOfficeHostEntry(root, entry)
        .catch(escalate("failed-forward-entry-close"))
        .catch(() => undefined),
    );
    throw error;
  }
}
