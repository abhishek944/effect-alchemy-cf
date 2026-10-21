import { Effect, Schema, type Scope } from "effect";
import { OfficeLimits, decodeWire, type OfficeError } from "@starter/office-contract";
import type { OfficeDependencies, OfficeService } from "../ports/index.ts";
import { makeNativeRuntime, type OfficeNativeRuntime } from "./native-runtime.ts";
import { makeOfficeReads } from "./reads.ts";
import { makeOfficeFiles } from "./files.ts";
import { makeOfficeViews } from "./views.ts";
import { makeOfficeEditors } from "./editors.ts";
import { makeOfficeCreation } from "./create.ts";
import { makeOfficeExecution } from "./execute.ts";
import { makeOfficeImportInto } from "./import-into.ts";
import { makeOfficeReady } from "./ready.ts";
import { makeOfficeApproval } from "./approve.ts";
import { makeOfficeMerge } from "./merge.ts";
import { makeOfficeReadJobs } from "./read-jobs/index.ts";
import { makeOfficeReviewRead } from "./review-read/index.ts";
import { makeOfficeTransitions } from "./transitions/index.ts";
import { makeOfficeOperations } from "./operation-methods.ts";
import { officeFailure } from "./failure.ts";

const Policy = Schema.Struct({
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  sdkVersion: Schema.Literal("1.0.3"),
  imageDigest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  limits: OfficeLimits,
});
/** Pure composition for a host sharing its already-scoped native runtime with protocol endpoints. */
export function composeOffice(
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
): OfficeService {
  const reads = makeOfficeReadJobs(deps, runtime);
  const transitions = makeOfficeTransitions(deps, runtime);
  return Object.freeze({
    ...makeOfficeReads(deps),
    ...makeOfficeFiles(deps),
    ...makeOfficeViews(deps),
    ...makeOfficeEditors(deps),
    ...makeOfficeCreation(deps, runtime),
    ...makeOfficeExecution(deps, runtime),
    ...makeOfficeImportInto(deps, runtime),
    ...makeOfficeReady(deps, runtime),
    ...makeOfficeApproval(deps),
    ...makeOfficeMerge(deps, runtime),
    ...makeOfficeReviewRead(deps, runtime),
    ...reads,
    ...transitions,
    ...makeOfficeOperations(deps, runtime, transitions),
  });
}
/** Caller owns all injected providers. Scope owns the constructed SDK services/guards, never document state. */
export const makeOffice = Effect.fn("Office.makeOffice")(function* (
  input: OfficeDependencies,
): Effect.fn.Return<OfficeService, OfficeError, Scope.Scope> {
  const policy = yield* decodeWire(Policy)(input.policy).pipe(
    Effect.mapError(() => officeFailure("EXECUTOR_UNCONFIGURED")),
  );
  const deps: OfficeDependencies = {
    ...input,
    policy: Object.freeze({ ...policy, limits: Object.freeze({ ...policy.limits }) }),
  };
  const runtime = yield* makeNativeRuntime(deps);
  return composeOffice(deps, runtime);
});
