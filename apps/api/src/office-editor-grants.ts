import { Effect } from "effect";
import type { NativeEditorLeaf, NativeEditorPermit } from "@starter/office-server/ports";
import type {
  NativeStorageHooks,
  NativePublicationPreparation,
} from "@starter/office-cloudflare/native";
import type { HostEditor } from "@starter/office-server/native-remote";
import type { OfficeEditorChannel } from "./office-editor-channel.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import { officeDeniedReason } from "./office-private-values.ts";

type NativeAdmission = NonNullable<NativeStorageHooks["admission"]>;
type Original = Awaited<ReturnType<OfficeEditorChannel["require"]>>;
export type OfficeEditorHeld = Original & {
  readonly kind: "editor";
  readonly permit: NativeEditorPermit;
  readonly admission: NativeAdmission;
  leaf: NativeEditorLeaf | null;
  releasing?: Promise<void>;
};
type EditorCall = (typeof HostEditor)[keyof typeof HostEditor]["request"]["Type"];
export function officeEditorGrants(channel: OfficeEditorChannel) {
  const subjects = new Map<
    string,
    {
      readonly memberId: string;
      readonly submissionId: string;
      readonly turnId: string;
      readonly sid: string;
      readonly reqId: number;
    }
  >();
  const grants = new Map<string, OfficeEditorHeld>();
  const attempted = new Set<string>();
  function release(held: OfficeEditorHeld): Promise<void> {
    held.releasing ??= Effect.runPromise(held.provider.release(held.permit));
    return held.releasing;
  }
  async function require(permit: NativeEditorPermit) {
    await channel.require(permit.memberId);
    const actual = grants.get(permit.submissionId);
    if (actual === undefined) throw officeDeniedReason("editor-grant-missing");
    if (actual.releasing !== undefined) throw officeDeniedReason("editor-grant-releasing");
    if (!officeSame(actual.permit, permit)) throw officeDeniedReason("editor-grant-permit");
    if (actual.admission.notAfter <= Date.now()) throw officeDeniedReason("editor-grant-expired");
    return actual;
  }
  return {
    require,
    async submission(memberId: string, sid: string, reqId: number) {
      await channel.require(memberId);
      const key = JSON.stringify([memberId, sid, reqId]);
      const known = subjects.get(key);
      if (known !== undefined)
        return { submissionId: known.submissionId, turnId: known.turnId, sid, reqId };
      if (subjects.size >= 1024) throw officeDenied();
      const original = {
        memberId,
        submissionId: crypto.randomUUID(),
        turnId: crypto.randomUUID(),
        sid,
        reqId,
      };
      subjects.set(key, original);
      return { submissionId: original.submissionId, turnId: original.turnId, sid, reqId };
    },
    async call(call: EditorCall): Promise<unknown> {
      switch (call.method) {
        case "editor.join": {
          const original = await channel.require();
          if (
            call.input.viewId !== channel.view.view.id ||
            call.input.until !== original.context.notAfter
          )
            throw officeDenied();
          return original.joined;
        }
        case "editor.revoke":
          return channel.revoke();
        case "editor.admit": {
          const subject = [...subjects.values()].find(
            (item) => item.submissionId === call.input.submissionId,
          );
          if (
            subject === undefined ||
            subject.turnId !== call.input.turnId ||
            subject.sid !== call.input.sid ||
            subject.reqId !== call.input.reqId ||
            attempted.has(subject.submissionId)
          )
            throw officeDenied();
          // Never manufacture/reissue a stored permit on a repeated/lost-ACK request.
          attempted.add(subject.submissionId);
          const original = await channel.require(subject.memberId);
          const result = await Effect.runPromise(
            original.provider.admit(call.input.submissionId, call.input.turnId, {
              sid: call.input.sid,
              reqId: call.input.reqId,
              client: call.input.client,
            }),
          );
          if (result.kind === "admitted") {
            if (grants.has(result.permit.submissionId)) throw officeDenied();
            grants.set(result.permit.submissionId, {
              ...original,
              kind: "editor",
              permit: result.permit,
              admission: result.admission,
              leaf: null,
            });
          }
          return result;
        }
        case "editor.stage": {
          const held = await require(call.input.permit);
          const leaf = await Effect.runPromise(held.provider.stage(held.permit, call.input.leaf));
          if (held.leaf !== null && !officeSame(held.leaf, leaf)) throw officeDenied();
          held.leaf = leaf;
          return leaf;
        }
        case "editor.prepare":
          // Only the actual strict-provider beforePublication hook may supply its fingerprint.
          throw officeDenied();
        case "editor.observe": {
          const held = await require(call.input.permit);
          return Effect.runPromise(held.provider.observe(held.permit));
        }
        case "editor.release": {
          const held = grants.get(call.input.permit.submissionId);
          if (held === undefined || !officeSame(held.permit, call.input.permit))
            throw officeDenied();
          await release(held);
          return null;
        }
      }
      throw officeDenied();
    },
    async drain() {
      const released = await Promise.allSettled([...grants.values()].map(release));
      const revoked = await Promise.allSettled([channel.revoke()]);
      if ([...released, ...revoked].some((item) => item.status === "rejected"))
        throw officeDenied();
    },
  };
}
export const officeEditorPreparation =
  (held: OfficeEditorHeld, live: () => Promise<void>): NativePublicationPreparation =>
  async (binding, fence) => {
    await live();
    const { permit, leaf } = held;
    const receipt = leaf?.receipt;
    const action =
      receipt?.kind === "main-change"
        ? `main-change:${receipt.revision}`
        : receipt === undefined
          ? null
          : `draft-change:${receipt.worktreeId}:${receipt.revision}`;
    if (
      leaf === null ||
      action !== binding.action ||
      fence.commandID !== permit.submissionId ||
      fence.stepID !== permit.stepId ||
      fence.epoch !== permit.authorityEpoch ||
      binding.authorityEpoch !== permit.authorityEpoch
    )
      throw officeDenied();
    const prepared = await Effect.runPromise(
      held.provider.prepare(permit, leaf.id, {
        fingerprint: binding.fingerprint,
        authorityEpoch: binding.authorityEpoch,
      }),
    );
    await live();
    return prepared;
  };
export type OfficeEditorGrants = ReturnType<typeof officeEditorGrants>;
export type OfficeEditorBinding = {
  readonly channel: OfficeEditorChannel;
  readonly grants: OfficeEditorGrants;
};
