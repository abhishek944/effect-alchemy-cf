import { decodeWireSync } from "@starter/office-contract";
import type {
  MutationCandidateFrame,
  NativeInputFrame,
  NativeProposalFrame,
} from "../ports/jobs.ts";
import { requireBinding } from "./frames.ts";
import { MutationCandidateSchema } from "./schemas.ts";
import { validateContentMutation } from "./mutation-policy.ts";
import { replayMutationCandidate, type NativeSubmissionIdentity } from "./replay.ts";
export type { NativeSubmissionIdentity } from "./replay.ts";

/** Generic execute retains its original finite content policy before clean SDK replay. */
export async function validateMutationCandidate(
  input: NativeInputFrame,
  candidate: MutationCandidateFrame,
  submission: NativeSubmissionIdentity,
): Promise<NativeProposalFrame> {
  const output = decodeWireSync(MutationCandidateSchema)(candidate);
  requireBinding(output.binding, input.binding);
  for (const mutation of output.mutations) validateContentMutation(input, mutation);
  return replayMutationCandidate(input, output.mutations, submission);
}
