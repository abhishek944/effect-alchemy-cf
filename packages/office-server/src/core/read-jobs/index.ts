import { Effect } from "effect";
import { ExportRequest, RenderRequest, decodeWire } from "@starter/office-contract";
import type { OfficeDependencies, OfficeService } from "../../ports/index.ts";
import { officeFailure } from "../failure.ts";
import type { OfficeNativeRuntime } from "../native-runtime.ts";
import { inspectView } from "./inspect.ts";
import { outputOperation } from "./operation.ts";

/** Reuses the owner's scoped native runtime; this factory creates no resources or hidden queue. */
export function makeOfficeReadJobs(
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
): Pick<OfficeService, "inspect" | "render" | "export"> {
  return {
    inspect: (actor, input) => inspectView(deps, runtime, actor, input),
    render: (actor, input) =>
      decodeWire(RenderRequest)(input).pipe(
        Effect.mapError(() => officeFailure("INVALID_INPUT")),
        Effect.flatMap((value) =>
          outputOperation(deps, runtime, actor, { kind: "render", input: value }),
        ),
      ),
    export: (actor, input) =>
      decodeWire(ExportRequest)(input).pipe(
        Effect.mapError(() => officeFailure("INVALID_INPUT")),
        Effect.flatMap((value) =>
          outputOperation(deps, runtime, actor, { kind: "export", input: value }),
        ),
      ),
  };
}
