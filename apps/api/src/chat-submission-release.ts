import { withCause, withDiagnostic } from "@starter/diagnostics";
import type { SendMessage } from "./chat-model.ts";
import type { ChatSendScope, ChatSubmissionOptions } from "./chat-submission-types.ts";

/** Only after definite non-admission. Preserve the primary and existing cleanup order. */
export async function releaseUnsubmittedSend(
  options: Pick<ChatSubmissionOptions, "release" | "skills">,
  input: typeof SendMessage.Type,
  scope: ChatSendScope,
  primary: unknown,
  releaseCandidate = false,
): Promise<void> {
  try {
    if (releaseCandidate) options.skills.release(input.operationId);
    await options.release(input, scope);
  } catch (cleanup) {
    const secondary = withCause(
      withDiagnostic(new Error("Submission cleanup failed"), "submission_release_failed"),
      cleanup,
    );
    const failure = new AggregateError([primary, secondary], "Submission and cleanup failed", {
      cause: primary,
    });
    throw failure;
  }
}
