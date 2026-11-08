import type { HostErrorCode } from "@highchat/chat-runtime";

/** A refusal the HTTP layer can report without inventing a status code. */
export class HostFailure extends Error {
  readonly code: HostErrorCode;

  constructor(code: HostErrorCode, message?: string) {
    super(message ?? code);
    this.name = "HostFailure";
    this.code = code;
  }
}

/** Message text is safe to send to the Worker: no tokens, bodies or stack traces. */
export const failureMessage = (error: unknown): string => {
  if (error instanceof HostFailure) return error.message;
  if (error instanceof Error) return error.message.slice(0, 2_000);
  return "run failed";
};
