import { makeOfficeExtension } from "@starter/office-pi";
import type {
  OfficePiHost,
  OfficeResolution,
  OfficeTaskAccess,
  OfficeTaskPort,
} from "@starter/office-pi";
import { uploadOfficeBytes } from "@starter/office-contract/client";
import type { Registry } from "@earendil-works/pi-durable";

/** T11 must supply real verified private host resources; this example constructs no actor. */
type PrivateAccess = {
  readonly origin: URL;
  readonly client: OfficeTaskPort;
  readonly request: (url: URL, init: RequestInit) => Promise<Response>;
  readonly acceptedFile: OfficeTaskAccess["acceptedFile"];
};
type ProveAndBind = (input: OfficeResolution) => Promise<PrivateAccess>;
type ListAttachments = OfficePiHost["attachments"];

export const installOfficeForHost = (
  registry: Registry,
  proveAndBind: ProveAndBind,
  attachments: ListAttachments,
): void => {
  const host: OfficePiHost = {
    resolve: async (input) => {
      // The host joins this exact tool lineage to its immutable accepted input and principal.
      const verified = await proveAndBind(input);
      input.context.abortSignal?.throwIfAborted();
      return {
        client: verified.client,
        acceptedFile: verified.acceptedFile,
        upload: (upload) => uploadOfficeBytes(verified.origin, upload, verified.request),
      };
    },
    // The real host proves its own get_attachments lineage and lists only the bound chat.
    attachments,
  };
  registry.install(makeOfficeExtension(host));
};
