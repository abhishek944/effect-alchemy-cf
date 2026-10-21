import { Clock, Effect } from "effect";
import {
  decodeWireSync,
  OfficeInvalid,
  OfficeUnavailable,
  safeFailure,
} from "@starter/office-contract";
import type {
  IsolatedJob,
  IsolatedJobs,
  JobRecord,
  OfficeBytes,
  OwnerScope,
} from "../ports/index.ts";
import { IsolatedJobSchema } from "./schemas.ts";
import {
  jobScopeKey,
  requireJobIdentity,
  requireJobRecord,
  unknownJobState as unknownState,
} from "./identity.ts";
import { computeJobState } from "./run.ts";
import type { FreshJobPlacement } from "./placement.ts";
import { jobObservers, type ActiveJob, type JobMetadata } from "./lifecycle.ts";

const idleSettle = () => undefined;
export type IsolatedJobsOptions = {
  readonly metadata: JobMetadata;
  readonly bytes: OfficeBytes;
  readonly placement: FreshJobPlacement;
  readonly policyVersion: string;
  readonly workerId: string;
  readonly jobSeconds: number;
  readonly maxActive: number;
};

/** Durable metadata is truth. This map is solely an active cancellation/liveness hint. */
export function makeIsolatedJobs(options: IsolatedJobsOptions): IsolatedJobs {
  const { metadata } = options;
  if (
    !Number.isSafeInteger(options.jobSeconds) ||
    options.jobSeconds < 1 ||
    options.jobSeconds > 120 ||
    !Number.isSafeInteger(options.maxActive) ||
    options.maxActive < 1 ||
    options.maxActive > 4 ||
    options.workerId.length < 1 ||
    options.workerId.length > 256
  )
    throw new RangeError("Invalid native job supervisor profile.");
  const active = new Map<string, ActiveJob>();
  const { observe, cancel, winner, load } = jobObservers(metadata, active);
  // Submit cannot present unclaimed work as accepted eventual execution: there is no queue driver.
  const submitObservation = Effect.fn("Office.jobs.submitObservation")(function* (
    owner: OwnerScope,
    id: string,
  ) {
    const record = yield* load(owner, id);
    if (record.state.state === "queued" && record.version === 0 && record.dispatch === null)
      return yield* Effect.fail(
        new OfficeUnavailable(safeFailure("BUSY", record.job.binding.operationId)),
      );
    return record.state;
  });
  const submit = Effect.fn("Office.jobs.submit")(function* (owner: OwnerScope, input: IsolatedJob) {
    const job = yield* Effect.try({
      try: () => {
        const parsed = decodeWireSync(IsolatedJobSchema)(input);
        requireJobIdentity(owner, parsed, options.placement.imageDigest, options.policyVersion);
        return parsed;
      },
      catch: () => new OfficeInvalid(safeFailure("INVALID_INPUT")),
    });
    const now = yield* Clock.currentTimeMillis;
    const reserved = yield* metadata.reserveJob({
      owner,
      job,
      state: { state: "queued", jobId: job.binding.jobId },
      version: 0,
      dispatch: null,
      createdAt: now,
      updatedAt: now,
    });
    yield* Effect.try({
      try: () => requireJobRecord(owner, reserved, job),
      catch: () => new OfficeInvalid(safeFailure("IDEMPOTENCY_CONFLICT")),
    });
    if (reserved.state.state !== "queued") return yield* observe(owner, job.binding.jobId);
    if (active.has(jobScopeKey(owner, job.binding.jobId)))
      return yield* submitObservation(owner, job.binding.jobId);
    if (active.size >= options.maxActive)
      return yield* Effect.fail(
        new OfficeUnavailable(safeFailure("BUSY", job.binding.operationId)),
      );
    if (reserved.version !== 0 || reserved.dispatch !== null) return unknownState(job);
    const key = jobScopeKey(owner, job.binding.jobId),
      controller = new AbortController();
    let settle: () => void = idleSettle;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    active.set(key, { controller, settled });
    const claimAndRun = Effect.gen(function* () {
      const claimedAt = yield* Clock.currentTimeMillis;
      const claimed: JobRecord = {
        ...reserved,
        state: { state: "running", jobId: job.binding.jobId },
        version: 1,
        dispatch: {
          workerId: options.workerId,
          claimedAt,
          deadlineAt: claimedAt + options.jobSeconds * 1000,
        },
        updatedAt: claimedAt,
      };
      // A failed/lost claim acknowledgement NEVER authorizes dispatch, even if a later read sees it.
      const ack = yield* metadata
        .advanceJob(claimed, reserved.version)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (
        !ack ||
        ack.version !== 1 ||
        ack.state.state !== "running" ||
        ack.dispatch?.workerId !== options.workerId ||
        ack.dispatch.deadlineAt !== claimed.dispatch?.deadlineAt
      )
        return yield* submitObservation(owner, job.binding.jobId);
      yield* Effect.try({
        try: () => requireJobRecord(owner, ack, job),
        catch: () => new OfficeInvalid(safeFailure("INVALID_INPUT")),
      });
      const deadlineAt = ack.dispatch.deadlineAt;
      const compute = Effect.gen(function* () {
        const state = yield* computeJobState(
          options.bytes,
          options.placement,
          owner,
          job,
          controller,
          deadlineAt,
        );
        const finished = yield* Clock.currentTimeMillis;
        return yield* metadata
          .advanceJob({ ...ack, state, version: ack.version + 1, updatedAt: finished }, ack.version)
          .pipe(
            Effect.map((record) => record.state),
            Effect.catch(() => winner(owner, job.binding.jobId)),
          );
      });
      return yield* compute;
    });
    return yield* claimAndRun.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          active.delete(key);
          settle();
        }),
      ),
    );
  });
  return { submit, status: observe, cancel };
}
