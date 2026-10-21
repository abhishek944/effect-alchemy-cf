/**
 * The conversation-owned skill extension, built by adapting the installed
 * `agents/harness/pi` skills behavior at one boundary.
 *
 * The verified immutable documents become a real SDK `SkillSource`; the SDK
 * extension is then installed with `activate_skill` renamed to `skill`, the
 * `read_skill_resource` registration removed, and its complete formatted
 * activation result intercepted into durable active state before only a small
 * acknowledgement reaches native history. The catalog section keeps the SDK
 * instruction, patched to the renamed tool, and is bounded with an explicit
 * fallback. Raw bodies, details and progress are never tool output.
 */
import type {
  Extension,
  PromptSection,
  TaskId,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { defineExtension } from "@earendil-works/pi-durable";
import { skills as sdkSkills } from "agents/harness/pi";
import { fromManifest } from "agents/skills";
import {
  MAX_SKILL_CATALOG_BYTES,
  SKILL_AUTHORITY_RULE,
  type SkillDocument,
} from "./chat-skills-document.ts";

/** Same installed name, so a prepared attempt replaces rather than duplicates. */
export const SKILL_EXTENSION_NAME = "agents.skills";

export type SkillActivationResult = { readonly ok: boolean; readonly message: string };

export type SkillExtensionOptions = {
  readonly documents: readonly SkillDocument[];
  /** Immutable library identity, so the SDK source fingerprint is exact. */
  readonly fingerprint: string;
  /** Bounded fallback catalog when the SDK rendering is too large. */
  readonly catalog: string;
  readonly activeText: () => string;
  readonly activate: (
    name: string,
    formatted: string,
    taskId: TaskId | undefined,
  ) => Promise<SkillActivationResult>;
};

const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

const textOfResult = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  const texts = content.flatMap((part) => {
    if (typeof part !== "object" || part === null) return [];
    const text: unknown = Reflect.get(part, "text");
    return typeof text === "string" ? [text] : [];
  });
  return texts.join("\n");
};

const nameOfArgs = (args: unknown): string | null => {
  if (typeof args !== "object" || args === null) return null;
  const name: unknown = Reflect.get(args, "name");
  return typeof name === "string" ? name : null;
};

/** Drop the SDK's empty resource note: this scope registers no resources. */
const withoutResourceNote = (formatted: string): string =>
  formatted.replace(/\n?No bundled resources\.\n?$/u, "").trim();

const skillSource = (documents: readonly SkillDocument[], fingerprint: string) =>
  fromManifest({
    id: "owner-library",
    fingerprint,
    skills: documents.map((document) => ({
      name: document.name,
      description: document.description,
      body: document.text,
      rawContent: document.text,
      version: document.version,
    })),
  });

/**
 * The exact installed SDK-formatted activation text for each document, using
 * the same source, formatter and resource-note normalization as installation.
 * Used only to bind persisted active text to the verified original bytes; it is
 * not a second formatter and reads no storage.
 */
export const sdkActivationTexts = async (
  documents: readonly SkillDocument[],
  fingerprint: string,
): Promise<ReadonlyMap<string, string>> => {
  const formatted = new Map<string, string>();
  const sdk = await sdkSkills([skillSource(documents, fingerprint)]);
  const activate = sdk.tools?.find((tool) => tool.name === "activate_skill");
  if (activate === undefined) return formatted;
  const execute = activate.execute.bind(activate);
  for (const document of documents) {
    const invocation: unknown = Reflect.apply(execute, activate, [
      { name: document.name },
      undefined,
      undefined,
    ]);
    const result: unknown = await invocation;
    const content: unknown =
      result !== null && typeof result === "object" ? Reflect.get(result, "content") : undefined;
    formatted.set(document.name, withoutResourceNote(textOfResult(content)));
  }
  return formatted;
};

export const buildSkillExtension = async (options: SkillExtensionOptions): Promise<Extension> => {
  const source = skillSource(options.documents, options.fingerprint);
  const sdk = await sdkSkills([source]);
  const tools: ToolRegistration[] = [];
  for (const tool of sdk.tools ?? []) {
    if (tool.name === "read_skill_resource") continue;
    if (tool.name !== "activate_skill") {
      tools.push(tool);
      continue;
    }
    const original = tool.execute.bind(tool);
    const adapted: ToolRegistration = {
      ...tool,
      name: "skill",
      description:
        "Activate a skill by name. Use this when the user's task matches one of the available skills; the current skill instructions are supplied by the host for this attempt.",
      execute: async (args, api, context) => {
        const name = nameOfArgs(args) ?? "";
        const known = options.documents.some((item) => item.name === name);
        let formatted: string;
        try {
          formatted = withoutResourceNote(
            textOfResult((await original(args, api, context)).content),
          );
        } catch {
          // Unknown/invalid names stay ordinary recoverable tool errors; a known
          // approved document whose SDK activation fails must latch and abort.
          if (!known)
            return {
              content: [{ type: "text" as const, text: `Skill not found: ${name}` }],
              isError: true,
            };
          const failed = await options.activate(name, "", api.taskId);
          return {
            content: [{ type: "text" as const, text: failed.message }],
            isError: !failed.ok,
          };
        }
        const result = await options.activate(name, formatted, api.taskId);
        return {
          content: [{ type: "text" as const, text: result.message }],
          isError: !result.ok,
        };
      },
    };
    tools.push(adapted);
  }
  const sdkCatalog = sdk.sections?.find((section) => section.key === "skills");
  const skillsSection: PromptSection = {
    key: "skills",
    render: async (input, context) => {
      const raw = sdkCatalog === undefined ? undefined : await sdkCatalog.render(input, context);
      if (raw === undefined) return options.catalog;
      const patched = (
        raw.includes("activate_skill") ? raw.split("activate_skill").join("skill") : raw
      ).trim();
      const withRule = patched.includes(SKILL_AUTHORITY_RULE)
        ? patched
        : `${patched}\n\n${SKILL_AUTHORITY_RULE}`;
      return bytes(withRule) > MAX_SKILL_CATALOG_BYTES ? options.catalog : withRule;
    },
  };
  const contextSection: PromptSection = {
    key: "skill_context",
    render: () => options.activeText(),
  };
  return defineExtension({
    name: SKILL_EXTENSION_NAME,
    tools,
    sections: [skillsSection, contextSection],
  });
};
