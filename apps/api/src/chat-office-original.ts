import {
  officeStagingFailure,
  type AcceptedOfficeFile,
  type OfficeResolution,
  type OfficeStagingPhase,
} from "@starter/office-pi";
import { officeImportOptions } from "@starter/office-contract";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import { holdFileBody } from "./chat-file-io-body.ts";
import { ChatFileIOUnavailable } from "./chat-file-io-limits.ts";
import { openFileObject, statFileObject } from "./chat-file-io-objects.ts";
import { createChatFilesCatalogClient } from "./chat-files-client.ts";
import { retainedObjectKey } from "./chat-files-store.ts";
import { createChatLibraryClient } from "./chat-library-client.ts";
import { readOfficeRetainedOriginal } from "./chat-office-retained.ts";
import type { AcceptedInputAccess } from "./chat-accepted-input.ts";
import { retainAcceptedOriginals } from "./chat-accepted-input-retention.ts";
import { resolveOfficeCall } from "./chat-office-native-proof.ts";

const unavailable = (): never => {
  throw new ChatFileIOUnavailable();
};

/** Private lineage/bytes only; the real host still owns principal/session/final authority. */
export async function readOfficeAcceptedFile(
  resolution: OfficeResolution,
  access: AcceptedInputAccess,
  env: ConversationFileEnv,
  fileRef: string,
  cancellation: AbortSignal,
  deadline: number,
): Promise<AcceptedOfficeFile> {
  const expiry = new AbortController();
  const signals = [cancellation, expiry.signal];
  if (resolution.context.abortSignal !== undefined) signals.push(resolution.context.abortSignal);
  const signal = AbortSignal.any(signals);
  const timer = setTimeout(() => expiry.abort(), Math.max(0, deadline - Date.now()));
  let heldOwnsTimer = false;
  let phase: OfficeStagingPhase = "accepted-proof";
  try {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) return unavailable();
    const { api, context, intent } = resolution;
    if (intent.command.command !== "stage-file" || intent.command.input.fileRef !== fileRef)
      return unavailable();
    const proof = await resolveOfficeCall(api, context, intent, access);
    signal.throwIfAborted();
    if (proof === null) return unavailable();
    if (env.ChatCatalog === undefined || env.CHAT_FILES === undefined) return unavailable();
    const fromSend = proof.current.candidate.originals.find((file) => file.fileId === fileRef);
    // Earlier saved files are already accepted; only this Send's actual creator repairs uploads.
    const original =
      fromSend ?? (await readOfficeRetainedOriginal(env, access.ownerId, access.chatId, fileRef));
    signal.throwIfAborted();
    if (original === null || !officeImportOptions(original.mediaType, original.name))
      return unavailable();
    if (fromSend !== undefined) {
      await retainAcceptedOriginals(access, env, proof.current, context);
      signal.throwIfAborted();
    }
    phase = "accepted-catalog";
    const stub = env.ChatCatalog.getByName(`owner:${access.ownerId}`);
    const catalog = createChatFilesCatalogClient(stub);
    const metadata = await createChatLibraryClient(stub).original(access.chatId, original.fileId);
    signal.throwIfAborted();
    if (metadata === null) return unavailable();
    const file = metadata.file;
    if (
      metadata.digest !== original.digest ||
      metadata.originOperationId !== original.originOperationId ||
      file.chatId !== access.chatId ||
      file.id !== original.fileId ||
      file.state !== "ready" ||
      file.expiresAt !== null ||
      file.kind !== original.kind ||
      file.name !== original.name ||
      file.byteSize !== original.byteSize ||
      file.mediaType !== original.mediaType ||
      file.width !== original.width ||
      file.height !== original.height
    )
      return unavailable();
    const key = retainedObjectKey(catalog.scope, file.chatId, file.id);
    const bucket = env.CHAT_FILES;
    phase = "accepted-storage";
    const head = await statFileObject(bucket, key, file);
    signal.throwIfAborted();
    if (head === null) return unavailable();
    const object = await openFileObject(bucket, key, head, file);
    if (object === null) return unavailable();
    const held = await holdFileBody(object.body, file.byteSize, signal);
    heldOwnsTimer = true;
    void held.done.then(() => clearTimeout(timer));
    try {
      if (
        object.key !== key ||
        (object.httpMetadata?.contentEncoding !== undefined &&
          object.httpMetadata.contentEncoding !== "identity") ||
        (object.customMetadata?.digest !== undefined &&
          object.customMetadata.digest !== original.digest)
      )
        return unavailable();
      phase = "accepted-revalidation";
      const current = await resolveOfficeCall(api, context, intent, access);
      signal.throwIfAborted();
      const next =
        current?.current.candidate.originals.find((entry) => entry.fileId === fileRef) ??
        (current === null
          ? null
          : await readOfficeRetainedOriginal(env, access.ownerId, access.chatId, fileRef));
      if (
        current === null ||
        current.submissionId !== proof.submissionId ||
        current.generationTaskId !== proof.generationTaskId ||
        next === null ||
        Object.entries(original).some(([name, value]) => Reflect.get(next, name) !== value)
      )
        return unavailable();
      // Expected digest is accepted metadata, not a claim this counted stream hashes content.
      // The existing staging uploader must verify actual bytes before acknowledging that digest.
      return {
        filename: file.name,
        bytes: file.byteSize,
        digest: original.digest,
        body: held.body,
      };
    } catch (error) {
      await held.cancel();
      throw error;
    }
  } catch (error) {
    resolution.context.abortSignal?.throwIfAborted();
    throw officeStagingFailure(resolution.intent.operationId, phase, false, error);
  } finally {
    if (!heldOwnsTimer) clearTimeout(timer);
  }
}
