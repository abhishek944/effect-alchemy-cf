/**
 * DO-internal `/files/*` routes for the owner catalog object.
 *
 * The routes are only reachable through the Durable Object stub from server
 * code. They carry no browser identity: owner scope comes from the object
 * instance, never from a request field. Responses use the shared
 * `ChatFilesResult` envelope so the worker client can fail closed uniformly.
 */
import type * as cf from "@cloudflare/workers-types";
import { decodeOption, json, requestBody } from "./chat-internal.ts";
import { OperationReceipt } from "./chat-contract.ts";
import type { Chat } from "./chat-model.ts";
import type { ChatFilesCatalog } from "./chat-files-catalog.ts";
import {
  filesFail,
  type ChatFileAcceptance,
  type ChatFileAcceptanceProbe,
  type ChatFilesObjectStore,
  type ChatFilesResult,
} from "./chat-files-model.ts";
import {
  ChatFilesAbort,
  ChatFilesCommit,
  ChatFilesGetQuery,
  ChatFilesListQuery,
  ChatFilesPrepare,
  ChatFilesRelease,
  ChatFilesRemove,
  ChatFilesReserve,
  ChatFilesStaged,
  ChatFilesSweep,
} from "./chat-files-ops.ts";

export type ChatFilesCatalogDeps = {
  readonly bucket: cf.R2Bucket | undefined;
  readonly objects: ChatFilesObjectStore | undefined;
  readonly probeAccepted: ChatFileAcceptanceProbe | undefined;
};

const respond = <T>(result: ChatFilesResult<T>): Response => json(result);

export const handleChatFilesCatalogRequest = async (
  catalog: ChatFilesCatalog,
  request: Request,
  deps: ChatFilesCatalogDeps,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  switch (route) {
    case "POST /files/reserve": {
      const body = decodeOption(ChatFilesReserve, await requestBody(request));
      return body === null ? json(filesFail("invalid_input"), 400) : respond(catalog.reserve(body));
    }
    case "POST /files/staged": {
      const body = decodeOption(ChatFilesStaged, await requestBody(request));
      return body === null ? json(filesFail("invalid_input"), 400) : respond(catalog.staged(body));
    }
    case "POST /files/abort": {
      const body = decodeOption(ChatFilesAbort, await requestBody(request));
      if (body === null) return json(filesFail("invalid_input"), 400);
      catalog.abort(body);
      return json({ ok: true, value: { released: 1 } });
    }
    case "POST /files/prepare": {
      const body = decodeOption(ChatFilesPrepare, await requestBody(request));
      return body === null ? json(filesFail("invalid_input"), 400) : respond(catalog.prepare(body));
    }
    case "POST /files/commit": {
      const body = decodeOption(ChatFilesCommit, await requestBody(request));
      return body === null ? json(filesFail("invalid_input"), 400) : respond(catalog.commit(body));
    }
    case "POST /files/release": {
      const body = decodeOption(ChatFilesRelease, await requestBody(request));
      if (body === null) return json(filesFail("invalid_input"), 400);
      return json({ ok: true, value: { released: catalog.release(body) } });
    }
    case "POST /files/remove": {
      const body = decodeOption(ChatFilesRemove, await requestBody(request));
      if (body === null) return json(filesFail("invalid_input"), 400);
      return json({ ok: true, value: { result: catalog.remove(body) } });
    }
    case "GET /files/get": {
      const query = decodeOption(ChatFilesGetQuery, Object.fromEntries(url.searchParams.entries()));
      if (query === null) return json(filesFail("invalid_input"), 400);
      const file = catalog.get(query.chatId, query.fileId);
      return file === null
        ? json(filesFail("attachment_not_ready"), 404)
        : json({ ok: true, value: file });
    }
    case "GET /files/list": {
      const query = decodeOption(
        ChatFilesListQuery,
        Object.fromEntries(url.searchParams.entries()),
      );
      if (query === null) return json(filesFail("invalid_input"), 400);
      return json({ ok: true, value: { files: catalog.list(query.chatId) } });
    }
    case "GET /files/usage":
      return json({ ok: true, value: catalog.usage() });
    case "POST /files/sweep": {
      const body = decodeOption(ChatFilesSweep, await requestBody(request));
      if (body === null) return json(filesFail("invalid_input"), 400);
      if (
        deps.bucket === undefined ||
        deps.objects === undefined ||
        deps.probeAccepted === undefined
      )
        return json(filesFail("unavailable"), 503);
      const result = await catalog.sweep({
        now: body.now,
        limit: body.limit,
        probe: deps.probeAccepted,
        objects: deps.objects,
      });
      return respond(result);
    }
    default:
      return null;
  }
};

export type ReceiptProbeInput = {
  readonly namespace: cf.DurableObjectNamespace | undefined;
  readonly ownerId: string;
  readonly chat: (chatId: string) => Chat | null;
};

/**
 * Conservative default probe over the private owner conversation object.
 * `accepted: false` is an unconfirmed receipt, never proof of absence, so it
 * keeps possibly accepted originals rather than erasing them.
 */
export const receiptProbe =
  (input: ReceiptProbeInput): ChatFileAcceptanceProbe =>
  async ({ operationId, chatId }): Promise<ChatFileAcceptance> => {
    const namespace = input.namespace;
    if (namespace === undefined) return "unknown";
    const chat = input.chat(chatId);
    if (chat === null) return "unknown";
    try {
      const stub = namespace.getByName(`chat:${input.ownerId}:${chatId}`);
      const response = await stub.fetch("https://chat.internal/receipt", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chat-json": encodeURIComponent(JSON.stringify(chat)),
        },
        body: JSON.stringify({ operationId }),
      });
      if (!response.ok) return "unknown";
      const receipt = decodeOption(OperationReceipt, await response.json());
      return receipt !== null && receipt.accepted ? "accepted" : "unknown";
    } catch {
      return "unknown";
    }
  };
