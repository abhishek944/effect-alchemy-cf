import { Effect } from "effect";
import { OfficeSourcePage, OfficeSourceRequest, decodeWireSync } from "@starter/office-contract";
import { CurrentOfficeSession } from "./office-authentication.ts";
import { officeHostFetch, officeInvocation, type OfficeDispatch } from "./office-http-call.ts";
import {
  invalid,
  officeFailure,
  officeJson,
  officeInvalid,
  readBounded,
  unavailable,
} from "./office-http-model.ts";

/** Same generated portable contract, real authenticated session and finite private Root read. */
export function officeSources(
  dispatch: OfficeDispatch,
  documentId: string,
  query: URLSearchParams,
) {
  return Effect.gen(function* () {
    for (const key of query.keys())
      if (key !== "cursor" || query.getAll(key).length !== 1) return officeInvalid();
    const input = yield* Effect.try({
      try: () => decodeWireSync(OfficeSourceRequest)({ documentId, cursor: query.get("cursor") }),
      catch: invalid,
    });
    const session = yield* CurrentOfficeSession;
    const invocationId = yield* officeInvocation(dispatch);
    const response = yield* officeHostFetch(dispatch, session, `/sources/${invocationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (response.status !== 200) return yield* Effect.fail(unavailable());
    const bytes = yield* readBounded(response, 12 * 1024);
    const value = yield* Effect.try({
      try: () =>
        decodeWireSync(OfficeSourcePage)(
          JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
        ),
      catch: unavailable,
    });
    return officeJson(value);
  }).pipe(Effect.catch((error) => Effect.succeed(officeFailure(error))));
}
