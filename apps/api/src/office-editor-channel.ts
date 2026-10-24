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
import {
  officeDenied,
  officeSameView,
  type OfficePrivateRequest,
} from "./office-private-authority.ts";
import { officeDeniedReason } from "./office-private-values.ts";
import { officePrivatePlacement } from "./office-private-placement.ts";
type Member = typeof NativePrivateMember.Type;
type Actual = {
  readonly context: Extract<VerifiedCoordinatorContext, { kind: "editor" }>;
  readonly provider: NativeEditorAdmission;
  readonly joined: JoinedChannel;
};
type Membership = {
  readonly frameId: string;
  readonly joined: Promise<Actual | null>;
  provider?: NativeEditorAdmission;
  closing?: Promise<void>;
};
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
  const members = new Map<string, Membership>();
  let revoked = false;
  let revoking: Promise<null> | undefined;
  const deadline = Math.min(
    originalWorkDeadline,
    request.original.deadline,
    request.original.actor.expiresAt,
  );
  const placement = officePrivatePlacement(options, metadata, nodeId, request);
  const worktreeId = view.source.kind === "draft" ? view.source.worktreeId : null;
  const identity = (member: Member) => {
    if (
      member.userId !== view.owner.ownerId ||
      member.worktreeId !== worktreeId ||
      (member.unitId !== null && member.unitId !== view.target.unitId)
    )
      throw officeDenied();
  };
  const live = async () => {
    await request.live();
    if (revoked) throw officeDeniedReason("editor-revoked");
    if (Date.now() >= deadline) throw officeDeniedReason("editor-expired");
    if (request.viewId !== view.view.id) throw officeDeniedReason("editor-view");
    if (request.original.actor.capability !== "human")
      throw officeDeniedReason("editor-capability");
    const current = await Effect.runPromise(metadata.view(view.owner, view.view.id));
    if (current === null) throw officeDeniedReason("editor-view-missing");
    if (current.view.expiresAt <= Date.now()) throw officeDeniedReason("editor-view-expired");
    if (!officeSameView(current, view)) throw officeDeniedReason("editor-view-changed");
    if (view.view.mode !== "read-only") {
      const lease =
        editor === null ? null : await Effect.runPromise(metadata.editor(view.owner, editor.id));
      if (lease === null) throw officeDeniedReason("editor-lease-missing");
      if (lease.state !== "active") throw officeDeniedReason("editor-lease-state");
      if (lease.expiresAt <= Date.now()) throw officeDeniedReason("editor-lease-expired");
      if (lease.epoch !== editor?.epoch) throw officeDeniedReason("editor-lease-epoch");
      if (lease.view.id !== view.view.id) throw officeDeniedReason("editor-lease-view");
    }
  };
  const closeMember = (id: string, member: Membership) => {
    member.closing ??= Promise.resolve().then(async () => {
      await member.joined.catch(() => undefined);
      if (member.provider !== undefined) await Effect.runPromise(member.provider.revoke());
      if (members.get(id) === member) members.delete(id);
      return undefined;
    });
    return member.closing;
  };
  return {
    channelId,
    view,
    editor,
    deadline,
    async member(member: Member, frameId: string) {
      identity(member);
      await live();
      const known = members.get(member.memberId);
      if (known !== undefined) {
        if (known.frameId !== frameId || known.closing !== undefined) throw officeDenied();
        await known.joined;
        return null;
      }
      if (members.size >= 64) throw officeDenied();
      const joined = Promise.resolve().then(async (): Promise<Actual | null> => {
        if (view.view.mode === "read-only") return null;
        if (editor === null) throw officeDenied();
        const current = await placement(view.target.documentId);
        if (
          current.authorityEpoch !== view.authorityEpoch ||
          current.serviceEpoch !== view.serviceEpoch
        )
          throw officeDenied();
        const memberChannelId = crypto.randomUUID();
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify([
              "office-editor-channel",
              1,
              request.original.actor,
              channelId,
              memberChannelId,
              member.memberId,
              frameId,
            ]),
          ),
        );
        const context: Actual["context"] = {
          kind: "editor",
          document: {
            owner: view.owner,
            documentId: view.target.documentId,
            unitId: view.target.unitId,
          },
          target: view.target,
          channelId: memberChannelId,
          placementId: current.id,
          editorId: editor.id,
          editorEpoch: editor.epoch,
          principalId: request.original.actor.principalId,
          sessionEpoch: request.original.actor.sessionEpoch,
          memberId: member.memberId,
          notAfter: deadline,
          authorizationDigest: [...new Uint8Array(digest)]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join(""),
        };
        const provider = createNativeEditorAdmission(options, context);
        membership.provider = provider; // Retain cleanup ownership on lost join ACK.
        await live();
        const acknowledged = await Effect.runPromise(provider.join(view.view.id, context.notAfter));
        if (revoked || membership.closing !== undefined) throw officeDenied();
        return { context, provider, joined: acknowledged };
      });
      const membership: Membership = { frameId, joined };
      members.set(member.memberId, membership);
      await joined;
      return null;
    },
    async checkMember(member: Member) {
      identity(member);
      await live();
      const known = members.get(member.memberId);
      if (known === undefined || known.closing !== undefined) throw officeDenied();
      await known.joined;
    },
    async require(member = [...members.keys()].at(-1)) {
      await live();
      const known = member === undefined ? undefined : members.get(member);
      if (known === undefined) throw officeDeniedReason("editor-member-missing");
      if (known.closing !== undefined) throw officeDeniedReason("editor-member-closing");
      const actual = await known.joined;
      if (actual === null) throw officeDeniedReason("editor-member-read-only");
      if (Date.now() >= actual.context.notAfter) throw officeDeniedReason("editor-member-expiry");
      return actual;
    },
    async close(frameId: string) {
      const closed = await Promise.allSettled(
        [...members]
          .filter(([, member]) => member.frameId === frameId)
          .map(([id, member]) => closeMember(id, member)),
      );
      if (closed.some((result) => result.status === "rejected")) throw officeDenied();
    },
    revoke() {
      if (revoking !== undefined) return revoking;
      revoked = true;
      revoking = Promise.resolve().then(async () => {
        const closed = await Promise.allSettled(
          [...members].map(([id, member]) => closeMember(id, member)),
        );
        if (closed.some((result) => result.status === "rejected")) throw officeDenied();
        return null;
      });
      return revoking;
    },
  };
}
export type OfficeEditorChannel = ReturnType<typeof officeEditorChannel>;
