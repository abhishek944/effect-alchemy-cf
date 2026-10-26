import { Clock, Effect } from "effect";
import { reportFailureEffect } from "@starter/diagnostics";
import { OfficeInvalid, OfficeNotFound, safeFailure } from "@starter/office-contract";
import type { JobRecord, JobState, OfficeMetadata, OwnerScope } from "../ports/index.ts";
import { jobScopeKey, requireJobRecord, unknownJobState } from "./identity.ts";

export type JobMetadata = Pick<OfficeMetadata, "reserveJob" | "job" | "advanceJob">;
export type ActiveJob = { readonly controller: AbortController; readonly settled: Promise<void> };
export function jobObservers(metadata: JobMetadata, active: ReadonlyMap<string, ActiveJob>) {
  const load = Effect.fn("Office.jobs.load")(function* (owner: OwnerScope, id: string) {
    const record = yield* metadata.job(owner, id);
    if (!record) return yield* Effect.fail(new OfficeNotFound(safeFailure("NOT_FOUND")));
    yield* Effect.try({
      try: () => requireJobRecord(owner, record),
      catch: () => new OfficeInvalid(safeFailure("INVALID_INPUT")),
    });
    return record;
  });
  const winner = (owner: OwnerScope, id: string) =>
    load(owner, id).pipe(Effect.map((record) => record.state));
  const transition = (owner: OwnerScope, record: JobRecord, state: JobState, now: number) =>
    metadata
      .advanceJob({ ...record, state, version: record.version + 1, updatedAt: now }, record.version)
      .pipe(
        Effect.map((value) => value.state),
        Effect.catch((error) =>
          reportFailureEffect(error, {
            component: "office.job-supervisor",
            operation: "transition",
            operationId: record.job.binding.operationId,
            taskId: record.job.binding.jobId,
            event: "application.failure",
          }).pipe(Effect.andThen(winner(owner, record.job.binding.jobId))),
        ),
      );
  const observe = Effect.fn("Office.jobs.status")(function* (owner: OwnerScope, id: string) {
    let record = yield* load(owner, id);
    if (record.state.state !== "running") return record.state;
    const now = yield* Clock.currentTimeMillis;
    // A different process's empty map is never evidence of abandonment.
    if (record.dispatch && record.dispatch.deadlineAt > now) return record.state;
    const running = active.get(jobScopeKey(owner, id));
    if (running) {
      running.controller.abort();
      yield* Effect.promise(() => running.settled);
      record = yield* load(owner, id);
      if (record.state.state !== "running") return record.state;
    }
    return yield* transition(
      owner,
      record,
      unknownJobState(record.job),
      yield* Clock.currentTimeMillis,
    );
  });
  const cancel = Effect.fn("Office.jobs.cancel")(function* (owner: OwnerScope, id: string) {
    const record = yield* load(owner, id);
    // Unknown does not prove process quiescence: drain any actual local placement first.
    const running = active.get(jobScopeKey(owner, id));
    if (running) {
      running.controller.abort();
      yield* Effect.promise(() => running.settled);
      return yield* observe(owner, id);
    }
    if (record.state.state === "running") return yield* observe(owner, id);
    if (record.state.state !== "queued") return record.state;
    const state: JobState = {
      state: "failed",
      jobId: id,
      error: safeFailure("INVALID_INPUT", record.job.binding.operationId),
    };
    return yield* transition(owner, record, state, yield* Clock.currentTimeMillis);
  });
  return { observe, cancel, winner, load };
}
