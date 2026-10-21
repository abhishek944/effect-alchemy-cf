import { Effect, Schema } from "effect";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import type { NativeApplicationOptions } from "./native-app.ts";
import { createOfficeProtocolAuthority } from "./native-protocol-authority.ts";
import { createOfficeViewProtocol } from "./native-view-protocol.ts";
import { createOfficeSubmissionAuthority } from "./native-editor-submission.ts";
import { createOfficeEditorClient } from "./native-editor-client.ts";
import { NativeChannelSubmission } from "./native-private-wire.ts";
import type {
  NativePrivateInvocations,
  NativePrivateInvocation,
} from "./native-private-invocations.ts";
import type { OfficeDependencies } from "@starter/office-server/ports";
import { nativePrivateMembers } from "./native-private-members.ts";

const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
/** Consumes only real private Worker resolutions and opaque SDK-owned original context. */
export function nativePrivateAuthority(
  invocations: NativePrivateInvocations,
  dependencies: OfficeDependencies,
): NativeApplicationOptions["bindAuthority"] {
  return ({ runtime, view, signal, joinedSession }) => {
    const editor = createOfficeEditorClient(invocations.context.work, invocations.context.cleanup);
    const connections = new Map<object, NativePrivateInvocation>();
    // SDK logical close may arrive while a socket resolution is still in flight. Remember it so a
    // late resolution can never re-register an already-closed connection or borrow a dead signal.
    const ended = new WeakSet<object>();
    const valid = (actual: NativePrivateInvocation) => {
      if (
        actual.value.kind !== "protocol" ||
        actual.value.view?.view.id !== view.view.id ||
        actual.value.actor.capability !== "human" ||
        signal.aborted ||
        Date.now() >= actual.value.deadline
      )
        throw forbidden();
      return actual;
    };
    const protocolValue = (actual: NativePrivateInvocation) => {
      valid(actual);
      const access = actual.value.access;
      if (access !== null && access.kind !== "read") throw forbidden();
      return {
        channels: actual.channels,
        access,
        worktreeId: actual.value.worktreeId,
        userId: actual.value.actor.owner.ownerId,
        deadline: actual.value.deadline,
        signal: AbortSignal.any([signal, actual.signal]),
      };
    };
    const members = nativePrivateMembers(invocations, valid, signal);
    const authority = createOfficeProtocolAuthority({
      context: invocations.context,
      runtime,
      issuer: {
        async http(context) {
          const actual = valid(invocations.from(context.incomingMessage));
          invocations.capture(context.customData, actual);
          return protocolValue(actual);
        },
        async upgrade(context) {
          const actual = valid(invocations.from(context.incomingMessage));
          invocations.capture(context.customData, actual);
          return protocolValue(actual);
        },
        async socket(connection) {
          const original = valid(invocations.original(connection.customData));
          if (ended.has(connection)) throw forbidden();
          const reused = invocations.reuse(original.value.invocationId);
          const actual =
            reused ??
            (await invocations.resolve(
              original.value.invocationId,
              AbortSignal.any([signal, original.signal]),
              original.value.deadline,
            ));
          try {
            valid(actual);
            // A logical close, physical socket close or expired original during resolution is final.
            if (ended.has(connection) || actual.signal.aborted) throw forbidden();
          } catch (error) {
            // Only a transport this late resolution CREATED may be closed here; a reused scope owns its own.
            if (reused === undefined) invocations.discard(actual);
            throw error;
          }
          connections.set(connection, actual);
          return protocolValue(actual);
        },
        session: members.session,
        closed(connection) {
          ended.add(connection);
          const actual = connections.get(connection);
          connections.delete(connection);
          if (actual === undefined) return;
          members.forget(actual.value.invocationId);
          invocations.forget(actual.value.invocationId);
          invocations.own(
            invocations.connection.json(
              `/private/${actual.value.invocationId}/closed`,
              {},
              Schema.Null,
              new AbortController().signal,
              actual.value.cleanupDeadline,
            ),
          );
        },
      },
    });
    return {
      authority,
      views: createOfficeViewProtocol({
        dependencies,
        runtime,
        viewId: view.view.id,
        onCleanupFailure: () => invocations.context.failCleanup(),
        async resolve(context) {
          const actual = valid(invocations.from(context.incomingMessage));
          if (actual.value.actor.capability !== "human") throw forbidden();
          return {
            actor: actual.value.actor,
            editorId: actual.value.editorId,
            unit: actual.value.unit,
            signal: AbortSignal.any([signal, actual.signal]),
            deadline: actual.value.deadline,
          };
        },
      }),
      submissions: createOfficeSubmissionAuthority({
        runtime,
        bytes: dependencies.bytes,
        policy: dependencies.policy,
        editor,
        publication: invocations.context.publication,
        joinedSession,
        async resolve({ changeset, context, worktreeId }) {
          const actual = members.submission(context);
          if (
            actual.value.channelId === null ||
            context.userID !== actual.value.actor.owner.ownerId ||
            worktreeId !== actual.value.worktreeId ||
            typeof changeset.sid !== "string" ||
            typeof changeset.reqId !== "number"
          )
            throw forbidden();
          const original = await Effect.runPromise(
            invocations.context.work.call(
              NativeChannelSubmission,
              {
                channelId: actual.value.channelId,
                memberId: context.memberID,
                sid: changeset.sid,
                reqId: changeset.reqId,
              },
              true,
            ),
          );
          return {
            target: view.target,
            submissionId: original.submissionId,
            turnId: original.turnId,
            memberId: context.memberID,
            worktreeId,
            signal: AbortSignal.any([signal, actual.signal]),
            deadline: actual.value.deadline,
          };
        },
      }),
    };
  };
}
