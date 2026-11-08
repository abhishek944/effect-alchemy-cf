/**
 * Prepared private Skills for the real Node SDK host.
 *
 * Each new Send verifies one fresh owner-library snapshot and freezes it in this
 * operation handle; there is no latest-library fallback and no recovery pin.
 * The bounded catalog becomes the parent's system section and the `skill` tool
 * returns the activated document's complete immutable instructions. A load or
 * activation failure is fatal for the accepted run: it never becomes an empty
 * library or a fake success.
 */
import { renderSkillCatalog, type SkillDocument } from "./chat-skills-document.ts";
import { SKILLS_UNAVAILABLE } from "./chat-skills-errors.ts";
import {
  loadSkillLibrary,
  SkillLibraryError,
  type SkillLibrary,
  type SkillLibrarySource,
} from "./chat-skills-library.ts";
import { readSkillReadiness, type SkillReadiness } from "./chat-skills-readiness.ts";
import type { ChatSdkTool } from "./chat-sdk-tool.ts";
import { fatalError, type ChatSdkSkillsDeps } from "./chat-sdk-skills-fatal.ts";
import { createSkillSdkTool, type ActiveSkill } from "./chat-sdk-skills-tool.ts";

export { SkillRunFatalError, type ChatSdkSkillsDeps } from "./chat-sdk-skills-fatal.ts";

export type PreparedSkills = {
  readonly ownerId: string;
  readonly operationId: string;
  readonly manifest: SkillLibrary["manifest"];
  readonly documents: readonly SkillDocument[];
  /** Bounded catalog for the parent's system prompt. */
  readonly systemPrompt: string;
  readonly catalog: string;
  readonly tool: ChatSdkTool;
  readonly tools: readonly ChatSdkTool[];
  /** End this operation; any later tool call fails closed. */
  readonly release: () => void;
};

export const prepareSkills = async (
  deps: ChatSdkSkillsDeps,
  ownerId: string,
  operationId: string,
): Promise<PreparedSkills> => {
  if (ownerId.length === 0 || operationId.length === 0)
    throw fatalError(deps, new SkillLibraryError("unavailable", SKILLS_UNAVAILABLE));
  let source: SkillLibrarySource | null;
  try {
    source = deps.source(ownerId);
  } catch (error) {
    throw fatalError(deps, error);
  }
  if (source === null)
    throw fatalError(deps, new SkillLibraryError("unavailable", SKILLS_UNAVAILABLE));
  let library: SkillLibrary;
  try {
    library = await loadSkillLibrary(source, ownerId);
  } catch (error) {
    throw fatalError(deps, error);
  }
  let systemPrompt: string;
  try {
    systemPrompt = renderSkillCatalog(library.documents);
  } catch (error) {
    throw fatalError(deps, error);
  }
  let released = false;
  const active: ActiveSkill[] = [];
  const tool = createSkillSdkTool({
    deps,
    ownerId,
    operationId,
    documents: library.documents,
    active,
    released: () => released,
  });
  return {
    ownerId,
    operationId,
    manifest: library.manifest,
    documents: library.documents,
    systemPrompt,
    catalog: systemPrompt,
    tool,
    tools: [tool],
    release: () => {
      released = true;
      active.length = 0;
    },
  };
};

const unready = (): SkillReadiness => ({
  ready: false,
  message: SKILLS_UNAVAILABLE,
  revision: null,
  files: 0,
});

/** Same readiness contract the existing UI uses before admission. */
export const checkSkillsReadiness = async (
  deps: ChatSdkSkillsDeps,
  ownerId: string | null,
): Promise<SkillReadiness> => {
  if (ownerId === null || ownerId.length === 0) return unready();
  let source: SkillLibrarySource | null;
  try {
    source = deps.source(ownerId);
  } catch {
    return unready();
  }
  return readSkillReadiness(source, ownerId);
};

/** One owner-scoped Skills adapter; `prepare` is bound to a single operation. */
export class ChatSdkSkills {
  private readonly deps: ChatSdkSkillsDeps;
  constructor(deps: ChatSdkSkillsDeps) {
    this.deps = deps;
  }
  prepare(ownerId: string, operationId: string): Promise<PreparedSkills> {
    return prepareSkills(this.deps, ownerId, operationId);
  }
  readiness(ownerId: string | null): Promise<SkillReadiness> {
    return checkSkillsReadiness(this.deps, ownerId);
  }
}

export const createChatSdkSkills = (deps: ChatSdkSkillsDeps): ChatSdkSkills =>
  new ChatSdkSkills(deps);
