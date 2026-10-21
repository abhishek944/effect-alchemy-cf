import { Effect, Schema } from "effect";
import type { IChangeset } from "@univerjs/protocol";
import { decodeWire, type ArtifactRef } from "@starter/office-contract";
import { decodeNativeFrame } from "@starter/office-contract/native-wire";
import type {
  ProposalBinding,
  NativeProposalFrame,
  OfficeDependencies,
  OwnerScope,
} from "../ports/index.ts";
import { ProposalBindingSchema } from "../jobs/schemas.ts";
import { requireBinding } from "../jobs/frames.ts";
import { ChangesetEnvelope } from "../storage-remote/native-envelope.ts";
import { readArtifact } from "./bytes.ts";
import { nativeTypes } from "./target.ts";
import { officeFailure } from "./failure.ts";

const Proposal = Schema.Struct({ binding: ProposalBindingSchema, changeset: ChangesetEnvelope });
export const readProposal = Effect.fn("Office.readProposal")(function* (
  deps: OfficeDependencies,
  owner: OwnerScope,
  ref: ArtifactRef,
  expected: ProposalBinding,
) {
  if (ref.kind !== "native-proposal") return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  const bytes = yield* readArtifact(deps, owner, ref, deps.policy.limits.proposalBytes);
  const raw = yield* Effect.try({
    try: () => decodeNativeFrame(bytes, "proposal").payload,
    catch: () => officeFailure("CONTENT_REQUIRED"),
  });
  const proposal = yield* decodeWire(Proposal)(raw).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  yield* Effect.try({
    try: () => requireBinding(proposal.binding, expected),
    catch: () => officeFailure("IDEMPOTENCY_CONFLICT", expected.operationId),
  });
  const change: IChangeset = proposal.changeset;
  if (
    change.unitID !== expected.unitId ||
    change.type !== nativeTypes[expected.kind] ||
    change.baseRev !== expected.baseRevision ||
    change.revision !== expected.baseRevision + 1 ||
    !change.sid ||
    change.reqId === undefined ||
    change.reqId < 1 ||
    change.userID !== owner.ownerId ||
    change.mutations.length > deps.policy.limits.mutationCount
  )
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", expected.operationId));
  const result: NativeProposalFrame = { binding: proposal.binding, changeset: change };
  return result;
});
