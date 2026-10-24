import { Schema } from "effect";
import { reportFailure } from "@starter/diagnostics";
import { Id, decodeWireSync } from "@starter/office-contract";
import type { ChatOfficeTaskBroker } from "./chat-office-task-broker.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import { json } from "./chat-internal.ts";

export const OFFICE_CHAT_TASK_ORIGIN = "http://office-chat-task.internal";
const Resolve = Schema.Struct({ id: Id });

/** PRIVATE same-script namespace only; never register a public API/proxy to this audience.
 * URL/ID are selectors, not authentication. The actual private binding supplies caller access.
 * Resolves existing live native closures only; no actor, session renewal or native grant.
 */
export async function chatOfficeTaskEndpoint(
  request: Request,
  broker: ChatOfficeTaskBroker,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.origin !== OFFICE_CHAT_TASK_ORIGIN) return null;
  if (
    request.method !== "POST" ||
    url.pathname !== "/resolve" ||
    url.search !== "" ||
    url.username !== "" ||
    url.password !== ""
  )
    return json({ message: "Not found" }, 404);
  const deadline = Date.now() + 10_000;
  const stop = new AbortController();
  const signal = AbortSignal.any([request.signal, stop.signal]);
  const timer = setTimeout(() => stop.abort(), 10_000);
  try {
    const input = decodeWireSync(Resolve)(
      await readOfficePrivateJson(request.body, signal, deadline, 1024),
    );
    signal.throwIfAborted();
    // Await the ACTUAL original proof. Timeout cannot certify foreign IO settlement.
    const current = await broker.resolve(input.id);
    signal.throwIfAborted();
    if (current === null || Date.now() >= deadline)
      return json({ message: "Office task is unavailable" }, 403);
    const body = JSON.stringify(current);
    if (new TextEncoder().encode(body).byteLength > 32 * 1024)
      return json({ message: "Office task is unavailable" }, 503);
    return new Response(body, {
      headers: { "content-type": "application/json", "cache-control": "private, no-store" },
    });
  } catch (cause) {
    reportFailure(cause, {
      component: "office.admission",
      operation: "resolve-callback",
      reason: "callback-failed",
    });
    return json({ message: "Office task is unavailable" }, 503);
  } finally {
    clearTimeout(timer);
  }
}
