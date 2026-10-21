import { Effect } from "effect";
import {
  Id,
  OfficeInvalid,
  decodeWireSync,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";
import type { IsolatedJob, IsolatedJobs, OwnerScope } from "../ports/index.ts";
import { IsolatedJobSchema } from "./schemas.ts";

export type JobHostSubject = {
  readonly action: "submit" | "status" | "cancel";
  readonly jobId: string;
  readonly job: IsolatedJob | null;
};
/** Verifies fresh signed/private audience/stage/path/capability/target claims, not x-owner. */
export type AuthorizeJobHost = (
  request: Request,
  subject: JobHostSubject,
) => Effect.Effect<OwnerScope, OfficeError>;
const headers = { "content-type": "application/json", "cache-control": "private, no-store" };
async function metadataBody(request: Request): Promise<unknown> {
  if (!request.body || !request.headers.get("content-type")?.startsWith("application/json"))
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  const reader = request.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16 * 1024) throw new OfficeInvalid(safeFailure("LIMIT_EXCEEDED"));
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
/** Metadata-only private host RPC. It delegates execution solely through the fresh IsolatedJobs port. */
export function createPrivateJobHandler(jobs: IsolatedJobs, authorize: AuthorizeJobHost) {
  return Effect.fn("Office.jobs.privateRequest")(
    function* (request: Request) {
      const path = new URL(request.url).pathname;
      const match = /^\/office-jobs\/v1\/([A-Za-z0-9_-]{16,96})$/.exec(path);
      if (!match?.[1]) return new Response(null, { status: 404, headers });
      const id = decodeWireSync(Id)(match[1]);
      if (!["POST", "GET", "DELETE"].includes(request.method))
        return new Response(null, { status: 405, headers });
      const action =
        request.method === "POST" ? "submit" : request.method === "GET" ? "status" : "cancel";
      const job =
        action === "submit"
          ? yield* Effect.tryPromise({
              try: async () => decodeWireSync(IsolatedJobSchema)(await metadataBody(request)),
              catch: () => new OfficeInvalid(safeFailure("INVALID_INPUT")),
            })
          : null;
      if (job && job.binding.jobId !== id)
        return yield* Effect.fail(new OfficeInvalid(safeFailure("INVALID_INPUT")));
      const owner = yield* authorize(request, { action, jobId: id, job });
      const state = job
        ? yield* jobs.submit(owner, job)
        : action === "status"
          ? yield* jobs.status(owner, id)
          : yield* jobs.cancel(owner, id);
      const body = JSON.stringify(state);
      if (new TextEncoder().encode(body).byteLength > 16 * 1024)
        return yield* Effect.fail(new OfficeInvalid(safeFailure("LIMIT_EXCEEDED")));
      return new Response(body, { status: 200, headers });
    },
    Effect.catch((error: OfficeError) =>
      Effect.succeed(
        new Response(JSON.stringify(safeFailure(error.code, error.operationId)), {
          status:
            error.code === "FORBIDDEN"
              ? 403
              : error.code === "NOT_FOUND"
                ? 404
                : error.code === "INVALID_INPUT"
                  ? 400
                  : 503,
          headers,
        }),
      ),
    ),
  );
}
