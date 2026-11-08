/**
 * Fatal Skills failures for the real Node SDK host.
 *
 * A verified library that cannot be read, pinned or activated must stop the
 * accepted run. It never degrades into an empty library, a skipped file or a
 * fake success, and the parent gets an explicit class plus an optional hook.
 */
import { Option, Schema } from "effect";
import { SkillDocumentError } from "./chat-skills-document.ts";
import {
  SKILLS_BUDGET,
  SKILLS_INTEGRITY,
  SKILLS_UNAVAILABLE,
  SkillRuntimeError,
} from "./chat-skills-errors.ts";
import { SkillLibraryError, type SkillLibrarySource } from "./chat-skills-library.ts";
import type { ChatToolScope } from "./chat-sdk-tool.ts";

/** Fatal, non-recoverable skills failure: the parent must terminate this run. */
export class SkillRunFatalError extends SkillRuntimeError {
  constructor(code: "unavailable" | "integrity", message: string) {
    super(code, message);
    this.name = "SkillRunFatalError";
  }
}

export type ChatSdkSkillsDeps = {
  /** Exact owner-scoped catalog and private bucket; the stub id is the scope. */
  readonly source: (ownerId: string) => SkillLibrarySource | null;
  /** Parent termination hook; called before the fatal tool error is thrown. */
  readonly onFatal?: (error: SkillRunFatalError) => void;
};

export const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] | null => Option.getOrNull(Schema.decodeUnknownOption(schema)(input));

const fatalOf = (error: unknown): SkillRunFatalError => {
  if (error instanceof SkillRunFatalError) return error;
  if (error instanceof SkillLibraryError)
    return new SkillRunFatalError(
      error.kind,
      error.kind === "integrity" ? SKILLS_INTEGRITY : SKILLS_UNAVAILABLE,
    );
  if (error instanceof SkillDocumentError) {
    if (error.kind === "budget") return new SkillRunFatalError("unavailable", SKILLS_BUDGET);
    if (error.kind === "integrity") return new SkillRunFatalError("integrity", SKILLS_INTEGRITY);
    return new SkillRunFatalError("unavailable", SKILLS_UNAVAILABLE);
  }
  return new SkillRunFatalError("unavailable", SKILLS_UNAVAILABLE);
};

export const fatalError = (deps: ChatSdkSkillsDeps, error: unknown): SkillRunFatalError => {
  const fatal = fatalOf(error);
  try {
    deps.onFatal?.(fatal);
  } catch {
    // The fatal error still closes this run even if the parent hook fails.
  }
  return fatal;
};

export const abort = (scope: ChatToolScope): void => scope.signal.throwIfAborted();
