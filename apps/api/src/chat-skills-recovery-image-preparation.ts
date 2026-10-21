import type { UserInput } from "@earendil-works/pi-durable";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import { installedChatModel } from "./chat-capability-catalog.ts";
import { chatFilesImageCompatibility } from "./chat-files-native.ts";
import { SkillRuntimeError, translateSkillError } from "./chat-skills-errors.ts";
import type { ChatSkillsRecoveryDeps } from "./chat-skills-recovery.ts";
import {
  freezeRecoveryImageInput,
  sameRecoveryContent,
  storeCompactRecoveryContent,
  verifiedRecoveryContent,
  type SkillRecoveryImageInput,
} from "./chat-skills-recovery-image-input.ts";

export function recoveryCaption(content: UserInput, textLength: number): string | null {
  if (typeof content === "string") return content.length === textLength ? content : null;
  const first = content[0];
  return first?.type === "text" && first.text.length === textLength ? first.text : null;
}
export function recoveryFilesCompatible(
  files: readonly FileDescriptor[],
  modelId: string,
): boolean {
  const model = installedChatModel(modelId);
  return model !== null && chatFilesImageCompatibility(files, model).ok;
}
export function sameRecoveryFiles(
  left: readonly FileDescriptor[],
  right: readonly FileDescriptor[],
): boolean {
  const keys = [
    "id",
    "chatId",
    "kind",
    "name",
    "mediaType",
    "byteSize",
    "state",
    "width",
    "height",
    "excerpt",
    "createdAt",
    "expiresAt",
  ] as const;
  return (
    left.length === right.length &&
    left.every((file, index) => {
      const other = right[index];
      return other !== undefined && keys.every((key) => file[key] === other[key]);
    })
  );
}
export async function prepareRecoveryImageContent(
  deps: ChatSkillsRecoveryDeps,
  input: SkillRecoveryImageInput,
): Promise<UserInput> {
  try {
    const frozen = freezeRecoveryImageInput(input);
    const result = await deps.prepareImages(frozen);
    const compact = verifiedRecoveryContent(await storeCompactRecoveryContent(result));
    if (frozen.reused && !sameRecoveryContent(frozen.content, compact))
      throw new SkillRuntimeError(
        "invalid",
        "This operation already has different frozen content.",
      );
    return compact;
  } catch (error) {
    throw translateSkillError(error);
  }
}
