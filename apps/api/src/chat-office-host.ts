import { Effect } from "effect";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { officeStagingFailure, type OfficePiHost } from "@starter/office-pi";
import { officeStageObserver } from "./chat-office-stage-observation.ts";
import type { AcceptedInputAccess } from "./chat-accepted-input.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import type { ChatOfficeTaskBroker } from "./chat-office-task-broker.ts";
import { officeTaskTransport, type OfficeTaskEnvironment } from "./chat-office-transport.ts";
import { officeTaskPort } from "./chat-office-client.ts";
import { officeTaskUpload } from "./chat-office-upload.ts";
import { readOfficeAcceptedFile } from "./chat-office-original.ts";
import { readOfficeAttachments } from "./chat-office-attachments.ts";
import { officeTaskFile } from "./office-task-file.ts";

/** Installed in the real native registry; Root alone issues Task actors after actual private proof. */
export function createOfficePiHost(
  env: ConversationFileEnv & OfficeTaskEnvironment,
  access: () => AcceptedInputAccess,
  broker: ChatOfficeTaskBroker,
): OfficePiHost {
  return {
    attachments: (input) => readOfficeAttachments(env, access(), input),
    async resolve(resolution) {
      const proof = await broker.capture(resolution);
      const transport = await officeTaskTransport(env, proof, resolution.context.abortSignal);
      const client = officeTaskPort(transport);
      resolution.context.abortSignal?.throwIfAborted();
      const original = officeTaskFile(transport.proof.association, resolution.intent.attachmentId);
      const reference = transport.proof.association.reference;
      if (!original && reference?.kind !== "native")
        throw new OfficeUnavailable(safeFailure("FORBIDDEN"));
      const observeStaged = officeStageObserver(resolution, broker, proof.lease, transport.proof);
      return {
        ...(original === undefined
          ? {}
          : {
              attachment: {
                id: original.fileId,
                name: original.name,
                mediaType: original.mediaType,
              },
            }),
        ...(reference?.kind === "native" ? { reference } : {}),
        ...(transport.referenceBasis === undefined
          ? {}
          : { referenceBasis: transport.referenceBasis }),
        attachmentReceipt: transport.attachmentReceipt,
        client,
        ...(observeStaged ? { observeStaged } : {}),
        upload: (input) =>
          officeTaskUpload(transport, broker, proof.lease, resolution.context.abortSignal, input),
        // Staging transport obtained real fresh51 Root admission BEFORE this accepted-original read.
        acceptedFile: (fileRef) =>
          Effect.tryPromise({
            try: (signal) =>
              readOfficeAcceptedFile(
                resolution,
                access(),
                env,
                fileRef,
                signal,
                proof.lease.notAfter,
              ),
            catch: (error) =>
              officeStagingFailure(resolution.intent.operationId, "accepted-proof", false, error),
          }).pipe(Effect.uninterruptible),
      };
    },
  };
}
