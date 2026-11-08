/**
 * The operation-scoped `skill` tool for the real Node SDK host.
 *
 * Activation reads only the prepared immutable snapshot; an unknown name stays
 * an ordinary recoverable tool error, while a known document that cannot fit or
 * an already released operation fails the accepted run closed. The tool result
 * is the complete original instruction text, never a truncated or synthesized one.
 */
import { Type } from "@earendil-works/pi-ai";
import { Schema } from "effect";
import { renderActiveEntries, type SkillDocument } from "./chat-skills-document.ts";
import { SKILLS_BUDGET, SKILLS_PINNED_UNAVAILABLE } from "./chat-skills-errors.ts";
import { sdkToolText, type ChatSdkTool, type ChatToolResult } from "./chat-sdk-tool.ts";
import {
  abort,
  decode,
  fatalError,
  SkillRunFatalError,
  type ChatSdkSkillsDeps,
} from "./chat-sdk-skills-fatal.ts";

export type ActiveSkill = {
  readonly name: string;
  readonly version: string;
  readonly text: string;
};

const SkillArgs = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(180)),
});

const skillParameters = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 180 }),
});

export const createSkillSdkTool = (input: {
  readonly deps: ChatSdkSkillsDeps;
  readonly ownerId: string;
  readonly operationId: string;
  readonly documents: readonly SkillDocument[];
  readonly active: ActiveSkill[];
  readonly released: () => boolean;
}): ChatSdkTool => ({
  name: "skill",
  description:
    "Activate a skill by name. Use this when the user's task matches one of the available skills. " +
    "The returned text is the skill's complete instructions for this attempt; follow them. " +
    "Never activate a skill the user did not ask for or that does not match the task.",
  parameters: skillParameters,
  execute: async (args, scope): Promise<ChatToolResult> => {
    const fatal = (error: unknown): never => {
      throw fatalError(input.deps, error);
    };
    abort(scope);
    if (input.released()) fatal(new SkillRunFatalError("unavailable", SKILLS_PINNED_UNAVAILABLE));
    if (scope.ownerId !== input.ownerId || scope.operationId !== input.operationId)
      fatal(new SkillRunFatalError("unavailable", SKILLS_PINNED_UNAVAILABLE));
    const decoded = decode(SkillArgs, args);
    if (decoded === null)
      return sdkToolText(
        { ok: false, code: "invalid_input", message: "The skill name is not valid." },
        true,
      );
    const document = input.documents.find((item) => item.name === decoded.name);
    if (document === undefined)
      return sdkToolText(
        { ok: false, code: "not_found", message: `Skill not found: ${decoded.name}` },
        true,
      );
    if (input.active.some((item) => item.name === document.name))
      return sdkToolText({
        ok: true,
        code: "already_active",
        name: document.name,
        version: document.version,
        message: `Skill ${document.name} (version ${document.version}) is already active for this attempt; its instructions are in the earlier skill result.`,
      });
    try {
      renderActiveEntries([
        ...input.active,
        { name: document.name, version: document.version, text: document.text },
      ]);
    } catch {
      fatal(new SkillRunFatalError("unavailable", SKILLS_BUDGET));
    }
    input.active.push({
      name: document.name,
      version: document.version,
      text: document.text,
    });
    abort(scope);
    return {
      content: [{ type: "text", text: document.text }],
      details: {
        skill: document.name,
        version: document.version,
        digest: document.digest,
      },
    };
  },
});
