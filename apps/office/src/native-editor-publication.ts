import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { Effect } from "effect";
import {
  OfficeForbidden,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import { HostEditorLeaf, HostNativeWrites } from "@starter/office-server/native-remote";
import type { prepareSdkEditorCommit } from "@starter/office-server/native-codec";
import type { NativeEditorPermit, NativeEditorLeaf } from "@starter/office-server/ports";
import type { OfficeEditorClient } from "./native-editor-client.ts";

export type EditorPublication = {
  readonly permit: NativeEditorPermit;
  readonly prepared: ReturnType<typeof prepareSdkEditorCommit>;
  readonly worktreeId: string | null;
  readonly leaf: Omit<NativeEditorLeaf, "committed">;
  readonly editor: OfficeEditorClient;
  readonly signal: AbortSignal;
  readonly deadline: number;
  active: boolean;
  used: boolean;
  staged: NativeEditorLeaf | null;
};
const denied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
const unknown = () => new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
/** Local journal/ref rendezvous ONLY. T47 still attests the process and prepares/fences publication. */
export class OfficeEditorPublication {
  private readonly local = new AsyncLocalStorage<EditorPublication>();
  async run<A>(publication: EditorPublication, body: () => Promise<A>): Promise<A> {
    if (this.local.getStore() !== undefined) throw denied();
    try {
      return await this.local.run(publication, body);
    } finally {
      publication.active = false;
    }
  }
  /** Exactly two known finite sends, after actual refs exist and BEFORE native commit dispatch. */
  before(method: string, input: unknown): Effect.Effect<void, OfficeForbidden | OfficeUnavailable> {
    if (method !== HostNativeWrites.commit.method && method !== HostNativeWrites.commitDraft.method)
      return Effect.void;
    return Effect.gen({ self: this }, function* () {
      const request = yield* Effect.try({
        try: () =>
          method === HostNativeWrites.commit.method
            ? decodeWireSync(HostNativeWrites.commit.request)({ method, input }).input
            : decodeWireSync(HostNativeWrites.commitDraft.request)({ method, input }).input,
        catch: denied,
      });
      const state = this.local.getStore();
      if (!("kind" in request.producer)) {
        if (state !== undefined) return yield* Effect.fail(denied());
        return undefined;
      }
      if (
        state === undefined ||
        !state.active ||
        state.used ||
        state.signal.aborted ||
        Date.now() >= state.deadline
      )
        return yield* Effect.fail(denied());
      const change = request.changeset,
        header = state.prepared.header;
      if (
        !isDeepStrictEqual(request.producer, state.prepared.producer) ||
        change.unitID !== header.unitID ||
        change.type !== header.type ||
        change.baseRev !== header.baseRev ||
        change.revision !== header.revision ||
        change.sid !== header.sid ||
        change.reqId !== header.reqId ||
        change.value.kind !== "changeset" ||
        (state.worktreeId === null
          ? method !== HostNativeWrites.commit.method
          : method !== HostNativeWrites.commitDraft.method ||
            !("worktreeID" in request) ||
            request.worktreeID !== state.worktreeId)
      )
        return yield* Effect.fail(denied());
      state.used = true; // Lost stage ACK does NOT authorize another stage/commit attempt.
      const leaf = yield* Effect.try({
        try: () => decodeWireSync(HostEditorLeaf)({ ...state.leaf, committed: change }),
        catch: denied,
      });
      const stored = yield* state.editor
        .stage(state.permit, leaf)
        .pipe(Effect.mapError(() => unknown()));
      if (!isDeepStrictEqual(stored, leaf) || state.signal.aborted || Date.now() >= state.deadline)
        return yield* Effect.fail(unknown());
      state.staged = stored;
      return undefined;
    });
  }
}
