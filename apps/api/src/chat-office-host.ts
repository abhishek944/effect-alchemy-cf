import { Effect } from "effect";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { OfficePiHost } from "@starter/office-pi";
import type { ImageNativeAccess } from "./chat-image-request-types.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import type { ChatOfficeTaskBroker } from "./chat-office-task-broker.ts";
import { officeTaskTransport, type OfficeTaskEnvironment } from "./chat-office-transport.ts";
import { officeTaskClient } from "./chat-office-client.ts";
import { officeTaskUpload } from "./chat-office-upload.ts";
import { readOfficeAcceptedFile } from "./chat-office-original.ts";

/** Installed in the real native registry; Root alone issues Task actors after actual private proof. */
export function createOfficePiHost(
  env: ConversationFileEnv & OfficeTaskEnvironment,
  access: () => ImageNativeAccess,
  broker: ChatOfficeTaskBroker,
): OfficePiHost {
  return {
    async resolve(resolution) {
      const lease = await broker.capture(resolution);
      const transport = await officeTaskTransport(
        env,
        broker,
        lease,
        resolution.context.abortSignal,
      );
      const client = await officeTaskClient(transport);
      resolution.context.abortSignal?.throwIfAborted();
      return {
        client,
        upload: (input) =>
          officeTaskUpload(transport, broker, lease, resolution.context.abortSignal, input),
        // Staging transport obtained real fresh51 Root admission BEFORE this accepted-original read.
        acceptedFile: (fileRef) =>
          Effect.tryPromise({
            try: (signal) =>
              readOfficeAcceptedFile(resolution, access(), env, fileRef, signal, lease.notAfter),
            catch: () =>
              new OfficeUnavailable(safeFailure("UNAVAILABLE", resolution.intent.operationId)),
          }).pipe(Effect.uninterruptible),
      };
    },
  };
}
