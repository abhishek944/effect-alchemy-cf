import { Effect, Schema } from "effect";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import type { OfficeProtocolAuthority } from "@starter/office-server/native-protocol";
import type { CollabMemberContext } from "@univerjs-pro/collaboration-service";
import { NativeChannelMember } from "./native-private-wire.ts";
import type {
  NativePrivateInvocations,
  NativePrivateInvocation,
} from "./native-private-invocations.ts";

const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
/** SDK tickets retain the original HTTP customData. That HTTP signal/channels are NOT socket authority.
 * Bind each real SDK member to its actual current upgrade callback, then revalidate that original
 * association on join/presence/broadcast without borrowing another member's current work lease.
 */
export function nativePrivateMembers(
  invocations: NativePrivateInvocations,
  valid: (actual: NativePrivateInvocation) => NativePrivateInvocation,
  signal: AbortSignal,
) {
  const members = new Map<string, NativePrivateInvocation>();
  const session: OfficeProtocolAuthority["session"] = async (endpoint, worktreeId, unitId) => {
    const ticket = valid(invocations.original(endpoint.customData));
    if (
      ticket.value.channelId === null ||
      endpoint.userID !== ticket.value.actor.owner.ownerId ||
      worktreeId !== ticket.value.worktreeId ||
      (unitId !== null && unitId !== ticket.value.view?.target.unitId)
    )
      throw forbidden();
    const known = members.get(endpoint.memberID);
    if (known !== undefined) {
      const original = valid(known);
      if (original.value.channelId !== ticket.value.channelId) throw forbidden();
      // sendPresence may be in a DIFFERENT sender's callback. Verify the actual recipient instead.
      await invocations.connection.json(
        `/private/${original.value.invocationId}/member-check`,
        { memberId: endpoint.memberID, userId: endpoint.userID, worktreeId, unitId },
        Schema.Null,
        AbortSignal.any([signal, original.signal]),
        original.value.deadline,
      );
      return;
    }
    const reply = await Effect.runPromise(
      invocations.context.work.call(
        NativeChannelMember,
        {
          channelId: ticket.value.channelId,
          memberId: endpoint.memberID,
          userId: endpoint.userID,
          worktreeId,
          unitId,
        },
        true,
      ),
    );
    // Selector comes from the CURRENT genuine Worker-bound callback response, never SDK/user data.
    const callback = valid(invocations.callback(reply.invocationId));
    if (callback.value.channelId !== ticket.value.channelId) throw forbidden();
    members.set(endpoint.memberID, callback);
  };
  return {
    session,
    submission(context: CollabMemberContext) {
      if (context.customData === undefined) throw forbidden();
      const ticket = valid(invocations.original(context.customData));
      const callback = members.get(context.memberID);
      if (callback === undefined || callback.value.channelId !== ticket.value.channelId)
        throw forbidden();
      return valid(callback);
    },
    forget(invocationId: string) {
      for (const [member, callback] of members)
        if (callback.value.invocationId === invocationId) members.delete(member);
    },
  };
}
