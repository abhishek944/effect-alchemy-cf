import { Effect } from "effect";
import { createNativeEditorAdmission } from "@starter/office-cloudflare/coordinator-control";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type {
  VerifiedCoordinatorContext,
  NativeEditorAdmission,
  JoinedChannel,
} from "@starter/office-cloudflare/coordinator-control";
import type { Editor } from "@starter/office-contract";
import type { OfficeMetadata, ViewRecord } from "@starter/office-server/ports";
import type { NativePrivateMember } from "../../office/src/native-private-wire.ts";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { officePrivatePlacement } from "./office-private-placement.ts";

export function officeEditorChannel(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  nodeId: string,
  channelId: string,
  view: ViewRecord,
  editor: Editor | null,
  originalWorkDeadline: number,
) {
  let memberId: string | null = null;
  let cleanupProvider: NativeEditorAdmission | undefined;
  let revoked = false;
  let joined: Promise<void> | undefined;
  let revoking: Promise<null> | undefined;
  let actual:
    | {
        readonly context: Extract<VerifiedCoordinatorContext, { kind: "editor" }>;
        readonly provider: NativeEditorAdmission;
        readonly joined: JoinedChannel;
      }
    | undefined;
  const deadline = Math.min(
    originalWorkDeadline,
    request.original.deadline,
    request.original.actor.expiresAt,
    view.view.expiresAt,
  );
  const placement = officePrivatePlacement(options, metadata, nodeId, request);
  const worktreeId = view.source.kind === "draft" ? view.source.worktreeId : null;
  return {
    channelId,
    view,
    editor,
    deadline,
    async member(member: typeof NativePrivateMember.Type) {
      const identity = {
        memberId: member.memberId,
        userId: member.userId,
        worktreeId: member.worktreeId,
        unitId: member.unitId,
      };
      await request.live();
      if (
        revoked ||
        Date.now() >= deadline ||
        request.viewId !== view.view.id ||
        request.original.actor.capability !== "human" ||
        member.userId !== view.owner.ownerId ||
        member.worktreeId !== worktreeId ||
        (member.unitId !== null && member.unitId !== view.target.unitId) ||
        (memberId !== null && member.memberId !== memberId)
      )
        throw officeDenied();
      memberId = member.memberId;
      // A genuine read-only SDK session is NOT an editor admission.
      if (view.view.mode === "read-only") return null;
      if (
        editor === null ||
        editor.view.id !== view.view.id ||
        editor.state !== "active" ||
        editor.expiresAt <= Date.now()
      )
        throw officeDenied();
      if (joined !== undefined) {
        await joined;
        return null;
      }
      joined = Promise.resolve().then(async () => {
        const current = await placement(view.target.documentId);
        if (
          current.authorityEpoch !== view.authorityEpoch ||
          current.serviceEpoch !== view.serviceEpoch
        )
          throw officeDenied();
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify([
              "office-editor-channel",
              1,
              request.original.actor,
              channelId,
              identity,
            ]),
          ),
        );
        const context: Extract<VerifiedCoordinatorContext, { kind: "editor" }> = {
          kind: "editor",
          document: {
            owner: view.owner,
            documentId: view.target.documentId,
            unitId: view.target.unitId,
          },
          target: view.target,
          channelId,
          placementId: current.id,
          editorId: editor.id,
          editorEpoch: editor.epoch,
          principalId: request.original.actor.principalId,
          sessionEpoch: request.original.actor.sessionEpoch,
          memberId: member.memberId,
          notAfter: Math.min(deadline, editor.expiresAt, current.until),
          authorizationDigest: [...new Uint8Array(digest)]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join(""),
        };
        const provider = createNativeEditorAdmission(options, context);
        cleanupProvider = provider; // Retain cleanup authority even if the join ACK is lost.
        await request.live();
        const acknowledged = await Effect.runPromise(provider.join(view.view.id, context.notAfter));
        if (revoked) throw officeDenied();
        actual = { context, provider, joined: acknowledged };
        return undefined;
      });
      await joined;
      return null;
    },
    async checkMember(member: typeof NativePrivateMember.Type) {
      await request.live();
      if (
        revoked ||
        memberId !== member.memberId ||
        member.userId !== view.owner.ownerId ||
        member.worktreeId !== worktreeId ||
        (member.unitId !== null && member.unitId !== view.target.unitId) ||
        Date.now() >= deadline
      )
        throw officeDenied();
      const current = await Effect.runPromise(metadata.view(view.owner, view.view.id));
      if (current === null || !officeSame(current, view)) throw officeDenied();
      return null;
    },
    async require(member?: string) {
      await request.live();
      await joined;
      if (
        revoked ||
        actual === undefined ||
        Date.now() >= actual.context.notAfter ||
        (member !== undefined && member !== memberId)
      )
        throw officeDenied();
      const current = await Effect.runPromise(metadata.view(view.owner, view.view.id));
      if (current === null || !officeSame(current, view)) throw officeDenied();
      return actual;
    },
    revoke() {
      if (revoking !== undefined) return revoking;
      revoked = true;
      revoking = Promise.resolve().then(async () => {
        await joined?.catch(() => undefined);
        if (cleanupProvider !== undefined) await Effect.runPromise(cleanupProvider.revoke());
        return null;
      });
      return revoking;
    },
  };
}
export type OfficeEditorChannel = ReturnType<typeof officeEditorChannel>;
