import { Effect } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { decodeWireSync } from "@starter/office-contract";
import { makeOfficeClient } from "@starter/office-contract/client";
import { HostOffice, HostOfficeRequest } from "@starter/office-server/native-remote";
import type { OfficeTaskClient } from "@starter/office-pi";
import { assertOfficeTaskCommand, assertOfficeTaskReceipt } from "./office-task-command.ts";
import { officeDenied } from "./office-private-authority.ts";
import { officeCommandResponse } from "./office-http-call.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import type { OfficeTaskTransport } from "./chat-office-transport.ts";

const posts = new Map<string, keyof typeof HostOffice>([
  ["/api/office/documents", "create"],
  ["/api/office/drafts", "createDraft"],
  ["/api/office/views", "open"],
  ["/api/office/execute", "execute"],
  ["/api/office/import-into", "importInto"],
  ["/api/office/inspect", "inspect"],
  ["/api/office/render", "render"],
  ["/api/office/export", "export"],
  ["/api/office/ready", "ready"],
  ["/api/office/reopen", "reopen"],
  ["/api/office/discard", "discard"],
]);

/** Only generated Office tool HTTP routes. Root independently proves the original intent again. */
async function requestCall(request: Request, transport: OfficeTaskTransport) {
  const url = new URL(request.url);
  if (url.origin !== "http://office-task.client") throw officeDenied();
  const intent = transport.proof.association.intent.command;
  let key: keyof typeof HostOffice;
  let input: unknown;
  const match = /^\/api\/office\/(drafts|reviews|operations)\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && url.pathname === "/api/office/documents") {
    key = "list";
    input = { cursor: cursor() };
  } else if (request.method === "GET" && url.pathname === "/api/office/drafts") {
    key = "drafts";
    input = { cursor: cursor() };
  } else if (match !== null && match[2] !== undefined && request.method === "GET") {
    const id = decodeURIComponent(match[2]);
    key = match[1] === "drafts" ? "draft" : match[1] === "reviews" ? "review" : "receipt";
    input =
      key === "draft"
        ? { id }
        : key === "review"
          ? { reviewId: id, cursor: cursor() }
          : { operationId: id };
  } else {
    const selected = posts.get(url.pathname);
    if (request.method !== "POST" || selected === undefined) throw officeDenied();
    key = selected;
    input = await readOfficePrivateJson(
      request.body,
      request.signal,
      transport.proof.lease.notAfter,
      16 * 1024,
    );
  }
  if (key !== "list" && key !== "drafts" && key !== "review" && url.search !== "")
    throw officeDenied();
  const call = decodeWireSync(HostOfficeRequest)({ method: HostOffice[key].method, input });
  if (key === "receipt") assertOfficeTaskReceipt(transport.proof, call);
  else assertOfficeTaskCommand(transport.proof, call);
  return { key, call };

  function cursor() {
    if (intent.command !== "list" && intent.command !== "drafts" && intent.command !== "review")
      throw officeDenied();
    if (
      [...url.searchParams.keys()].some((name) => name !== "cursor") ||
      url.searchParams.getAll("cursor").length > 1
    )
      throw officeDenied();
    const actual = url.searchParams.get("cursor");
    const expected = intent.cursor;
    // The generated query encoder may omit null or spell it "null"; the proven typed selector wins.
    if (actual !== expected && !(expected === null && actual === "null")) throw officeDenied();
    return expected;
  }
}

export async function officeTaskClient(transport: OfficeTaskTransport): Promise<OfficeTaskClient> {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const { key, call } = await requestCall(request, transport);
    return transport.request(
      "core",
      {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(call),
      },
      key === "receipt",
      async (response, signal, deadline, invocationId) => {
        if (response.status !== 200) throw officeDenied();
        const payload = await readOfficePrivateJson(response.body, signal, deadline, 256 * 1024);
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        // Current private core emits a bare payload; the existing owning decoder validates method/schema.
        return HttpServerResponse.toWeb(officeCommandResponse(key, invocationId, bytes));
      },
    );
  };
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      return yield* makeOfficeClient("http://office-task.client").pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.transformResponse(http, Effect.uninterruptible),
        ),
      );
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    ),
  );
  return client.office;
}
