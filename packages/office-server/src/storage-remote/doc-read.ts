import { Effect, Result } from "effect";
import { UniverType, type IChangeset } from "@univerjs/protocol";
import type { IDatabaseAdapter } from "@univerjs-pro/collaboration-service";
import { isOfficeError, officeFailure } from "../core/failure.ts";
import { byteStream } from "../core/bytes.ts";
import { decodeChangeset, decodeSnapshot } from "./native-envelope.ts";
import { loadPublishedValue, type PublishedNativeReader } from "./values.ts";
import { validateNativeValueRef, type NativeValue, type PublishedOrigin } from "./wire.ts";
import { createDocReadClient, type DocReadOptions } from "./doc-read-client.ts";
export type { DocReadOptions };
const docType: number = UniverType.UNIVER_DOC;

const deny = async (): Promise<never> => {
  throw officeFailure("FORBIDDEN");
};
/** Actual SDK adapter, deliberately only the readonly MAIN Doc policy. No Worktree/producer stand-in. */
export function createReadonlyDocDatabase(options: DocReadOptions): IDatabaseAdapter {
  const client = createDocReadClient(options);
  const owner = client.access.target.owner.ownerId,
    unitID = client.access.target.unitId;
  const check = (user: string, id: string) => {
    client.check();
    if (user !== owner || id !== unitID) throw officeFailure("FORBIDDEN");
  };
  const revision = (value: number) => {
    client.check();
    if (!Number.isSafeInteger(value) || value < 1) throw officeFailure("INVALID_INPUT");
    if (value > client.revision) throw officeFailure("FORBIDDEN");
    return value;
  };
  const pending = new Set<Promise<unknown>>();
  const run = async <A>(user: string, id: string, body: () => Promise<A>): Promise<A> => {
    check(user, id);
    try {
      const result = await body();
      check(user, id);
      return result;
    } catch (cause) {
      throw isOfficeError(cause) ? cause : officeFailure("CONTENT_REQUIRED");
    }
  };
  const invoke = <A>(user: string, id: string, body: () => Promise<A>) => {
    const task = run(user, id, body);
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };
  const unit = async () => {
    const result = await client.control({ method: "unit" });
    if (result.method !== "unit") throw officeFailure("CONTENT_REQUIRED");
    if (
      result.unit !== null &&
      (result.unit.unitID !== unitID || result.unit.type !== UniverType.UNIVER_DOC)
    )
      throw officeFailure("CONTENT_REQUIRED");
    return result.unit;
  };
  const snapshot = async (requested?: number) => {
    let target = requested;
    if (target === undefined || target === 0) {
      const actual = await unit();
      if (actual === null) return null;
      target = actual.headRevision;
    }
    target = revision(target);
    const result = await client.control({ method: "snapshot", revision: target });
    if (result.method !== "snapshot") throw officeFailure("CONTENT_REQUIRED");
    const manifest = result.manifest;
    if (manifest === null) return null;
    if (
      manifest.unitID !== unitID ||
      manifest.type !== docType ||
      manifest.revision > target ||
      manifest.blocks.length !== 0 ||
      manifest.snapshot.kind !== "snapshot"
    )
      throw officeFailure("CONTENT_REQUIRED");
    validateNativeValueRef(manifest.snapshot);
    return manifest;
  };
  const load = async (origin: PublishedOrigin, input: NativeValue) => {
    const value = validateNativeValueRef(input);
    await client.reserveValue(origin, value); // Admit value + exact part calls/bytes BEFORE allocation.
    const reader: PublishedNativeReader = {
      access: client.access,
      worktreeId: null,
      baselineRevision: null,
      readPart: (request) =>
        Effect.tryPromise({
          try: async () => {
            const part = value.parts[request.part];
            if (part === undefined) throw officeFailure("CONTENT_REQUIRED");
            return byteStream(await client.part(request, part.bytes));
          },
          catch: (cause) => (isOfficeError(cause) ? cause : officeFailure("UNAVAILABLE")),
        }),
    };
    const result = await Effect.runPromise(
      Effect.result(loadPublishedValue(reader, origin, value)),
    );
    if (Result.isFailure(result)) throw result.failure;
    client.check();
    return result.success;
  };
  return {
    getUnit: (ctx, id) => invoke(ctx.userID, id, unit),
    getSnapshotInfo: (ctx, id, select) =>
      invoke(ctx.userID, id, async () => {
        const manifest = await snapshot(select?.revision);
        if (manifest === null || (await unit()) === null) return null;
        return { unitID, type: UniverType.UNIVER_DOC, rev: manifest.revision };
      }),
    getSnapshot: (ctx, id, select) =>
      invoke(ctx.userID, id, async () => {
        const manifest = await snapshot(select?.revision);
        if (manifest === null) return null;
        const bytes = await load(
          { kind: "snapshot", revision: manifest.revision },
          manifest.snapshot,
        );
        const value = decodeSnapshot(bytes, {
          unitID,
          type: UniverType.UNIVER_DOC,
          revision: manifest.revision,
        });
        return (await unit()) === null ? null : value;
      }),
    getSheetBlock: (ctx, id) => invoke(ctx.userID, id, deny),
    getChangesets: (ctx, id, range) =>
      invoke(ctx.userID, id, async () => {
        const from = revision(range.from); // Native history rejects from0: never invent a rev1 change.
        if (range.to !== undefined) revision(range.to);
        const actual = await unit();
        if (actual === null) return null;
        const to = revision(range.to ?? actual.headRevision);
        if (to > actual.headRevision) throw officeFailure("CONTENT_REQUIRED");
        client.reserveHistory(Math.max(0, to - from));
        const changes: IChangeset[] = [];
        let after = from;
        while (after < to) {
          const page = await client.control({ method: "history", after, to });
          if (page.method !== "history") throw officeFailure("CONTENT_REQUIRED");
          if (page.unit === null) return null;
          if (
            page.unit.unitID !== unitID ||
            page.unit.type !== UniverType.UNIVER_DOC ||
            page.unit.headRevision < to ||
            page.rows.length === 0
          )
            throw officeFailure("CONTENT_REQUIRED");
          for (const row of page.rows) {
            if (row.revision !== after + 1 || row.revision > to || row.value.kind !== "changeset")
              throw officeFailure("CONTENT_REQUIRED");
            const bytes = await load(
              { kind: "changeset", branch: "", revision: row.revision },
              row.value,
            );
            changes.push(
              decodeChangeset(bytes, {
                unitID,
                type: UniverType.UNIVER_DOC,
                baseRev: row.revision - 1,
                revision: row.revision,
                sid: row.sid,
                reqId: row.reqId,
              }),
            );
            after = row.revision;
          }
        }
        return (await unit()) === null ? null : changes;
      }),
    createUnit: deny,
    saveSnapshot: deny,
    commitChangeset: deny,
    deleteUnits: deny,
    recoverUnits: deny,
    async dispose() {
      const closing = client.dispose().then(
        (value): PromiseSettledResult<void> => ({ status: "fulfilled", value }),
        (reason: unknown): PromiseSettledResult<void> => ({ status: "rejected", reason }),
      ); // Revoke immediately and observe cleanup before joining outward SDK reads.
      await Promise.allSettled(pending);
      const outcome = await closing;
      if (outcome.status === "rejected") throw outcome.reason;
    },
  };
}
