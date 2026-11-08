import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AssistantMessageEvent,
  AuthorizationHeader,
  BearerScheme,
  ChatHostPaths,
  JsonMediaType,
  NdjsonMediaType,
  RunRequest,
  ToolReply,
  httpStatusOf,
  type HostError,
  type HostErrorCode,
} from "@highchat/chat-runtime";
import { readBody, readLines } from "./body.ts";
import { decodeJson, decodeRecord } from "./decode.ts";
import { HostFailure, failureMessage } from "./errors.ts";
import { RunRegistry } from "./registry.ts";
import { RunStream } from "./run-stream.ts";
import { Run } from "./run.ts";

const respond = (response: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": JsonMediaType,
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
};

const refuse = (response: ServerResponse, code: HostErrorCode, message?: string): void => {
  const body: HostError = message === undefined ? { error: code } : { error: code, message };
  respond(response, httpStatusOf(code), body);
};

const authorized = (request: IncomingMessage, token: string): boolean => {
  const header = request.headers[AuthorizationHeader];
  if (typeof header !== "string") return false;
  const [scheme, value] = header.split(" ");
  if (scheme !== BearerScheme || value === undefined) return false;
  const expected = Buffer.from(token, "utf8");
  const given = Buffer.from(value, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};

const requireMethod = (request: IncomingMessage, method: string): void => {
  if (request.method !== method) throw new HostFailure("method_not_allowed", `expected ${method}`);
};

const mediaType = (request: IncomingMessage): string =>
  (request.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "";

export const createHandler = (token: string) => {
  const registry = new RunRegistry();

  const startRun = async (request: IncomingMessage, response: ServerResponse) => {
    const runRequest = decodeJson(RunRequest, await readBody(request));
    const stream = new RunStream(response);
    const run = new Run(runRequest, stream.emit);
    registry.start(run);
    stream.attach(run);
    response.writeHead(200, {
      "content-type": NdjsonMediaType,
      "cache-control": "no-store",
    });
    // A run reports its own failure through `settled`; this only guarantees cleanup.
    void run
      .execute()
      .finally(() => {
        registry.finish(runRequest.runId);
        stream.end();
      })
      .catch(() => undefined);
  };

  const stopRun = (runId: string, response: ServerResponse) => {
    respond(response, 200, { runId, stopped: registry.stop(runId) });
  };

  const replyTo = async (
    request: IncomingMessage,
    response: ServerResponse,
    runId: string,
    requestId: string,
  ) => {
    const type = mediaType(request);
    if (type === NdjsonMediaType) {
      for await (const record of readLines(request)) {
        const event = decodeRecord(AssistantMessageEvent, record, "invalid_reply");
        registry.pushModelEvent(runId, requestId, event);
      }
    } else if (type === JsonMediaType) {
      registry.replyTool(runId, requestId, decodeJson(ToolReply, await readBody(request)));
    } else {
      throw new HostFailure("invalid_reply", "reply must be JSON or NDJSON");
    }
    respond(response, 200, { accepted: true });
  };

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (!authorized(request, token)) throw new HostFailure("unauthorized");
      const segments = new URL(request.url ?? "/", "http://chat-host").pathname
        .split("/")
        .filter((segment) => segment.length > 0);
      if (segments[0] === "health") {
        requireMethod(request, "GET");
        respond(response, 200, { ok: true });
        return;
      }
      if (segments[0] !== "runs") throw new HostFailure("not_found", "unknown path");
      if (segments.length === 1) {
        requireMethod(request, "POST");
        await startRun(request, response);
        return;
      }
      const runId = decodeURIComponent(segments[1] ?? "");
      if (segments.length === 3 && segments[2] === "stop") {
        requireMethod(request, "POST");
        stopRun(runId, response);
        return;
      }
      if (segments.length === 4 && segments[2] === "replies") {
        requireMethod(request, "POST");
        await replyTo(request, response, runId, decodeURIComponent(segments[3] ?? ""));
        return;
      }
      throw new HostFailure("not_found", `unknown path ${ChatHostPaths.runs}${request.url ?? ""}`);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HostFailure) {
        refuse(response, error.code, error.message);
        return;
      }
      refuse(response, "internal", failureMessage(error));
    }
  };
};
