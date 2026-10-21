import { WorkerEntrypoint } from "cloudflare:workers";
import type * as cf from "@cloudflare/workers-types";

export type OfficeStorageProps = { readonly target: cf.Fetcher };
/** Native SAME-worker loopback service, installed on the ORIGINAL container before startup.
 * This actual platform binding is callback-only: it NEVER exposes authenticated human forwarding
 * or registration to Node (including indirect SDK fetch/SSRF). Props carry a REAL binding, not IDs.
 */
export class OfficeStorageIngress extends WorkerEntrypoint<unknown, OfficeStorageProps> {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const allowed =
      /^\/(bootstrap\/(ready|shutdown|stopped)|private\/[A-Za-z0-9_-]{1,256}\/(resolve|member-check|closed|finished|socket-closed|job-run|job-status|control|manifest|binary|cleanup))$/;
    const boot = request.headers.get("x-office-boot");
    if (
      request.method !== "POST" ||
      url.origin !== "http://office-storage.internal" ||
      url.href !== url.origin + url.pathname ||
      !allowed.test(url.pathname) ||
      boot === null ||
      request.headers.has("cookie") ||
      request.headers.has("authorization") ||
      request.headers.has("proxy-authorization")
    )
      return new Response(null, { status: 403 });
    const target = this.ctx.props.target;
    if (target === undefined) return new Response(null, { status: 503 });
    // Fixed callback audience; no original URL/upstream/Actor/session headers are forwarded.
    return target.fetch("http://office-node-callback.internal" + url.pathname, {
      method: "POST",
      body: request.body,
      signal: request.signal,
      redirect: "manual",
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/octet-stream",
        "x-office-boot": boot,
      },
    });
  }
}
