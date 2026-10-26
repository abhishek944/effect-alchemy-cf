import { toRpcAsync } from "alchemy/Cloudflare/Bridge";
import type { OfficeSessionBinding } from "@starter/auth/office-session";
import type { ChatReferenceInputs } from "@starter/office-contract";
import { Schema } from "effect";
import { decodeWireSync, OfficeForbidden } from "@starter/office-contract";
import type { OfficeTaskEnvironment } from "./chat-office-transport.ts";
import { type OfficeHost, officeHostName } from "./office-host-object.ts";
import { ImageInputError } from "./chat-image-input-types.ts";

/** Caller already proved owner/chat and original authenticated Send session; never model metadata. */
export async function admitNativeReferences(
  env: OfficeTaskEnvironment,
  ownerId: string,
  session: OfficeSessionBinding | undefined,
  references: ChatReferenceInputs | undefined,
): Promise<void> {
  if (!(references ?? []).some((input) => input.kind === "native")) return;
  if (session === undefined || session.ownerId !== ownerId || env.OfficeHost === undefined)
    throw new ImageInputError("invalid_input");
  const host = env.OfficeHost.getByName(
    officeHostName({ stage: session.stage, ownerId: session.ownerId }),
  );
  try {
    decodeWireSync(Schema.Literal(true))(
      await toRpcAsync<OfficeHost>(host).validateReferences(session, references ?? []),
    );
  } catch (error) {
    if (error instanceof ImageInputError) throw error;
    throw new ImageInputError(error instanceof OfficeForbidden ? "invalid_input" : "unavailable");
  }
}
