import { Effect, Schema } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import { HostNativePieces, HostBytes } from "@starter/office-server/native-remote";
import {
  metadataRequest,
  readRequest,
  writeRequest,
  editorRequest,
  controlRequest,
  OfficePrivateCall,
  OfficePrivateReply,
  cleanupMethods,
} from "./office-private-methods.ts";
import type { OfficeMetadata } from "@starter/office-server/ports";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import { createOfficeBytes } from "@starter/office-cloudflare/bytes";
import type { OfficeNamespace } from "./office-private-bindings.ts";
import {
  NativeChannelMember,
  NativeChannelSubmission,
} from "../../office/src/native-private-wire.ts";
import {
  officePrivateAuthority,
  officeDenied,
  officeSame,
  type OfficePrivateRequest,
} from "./office-private-authority.ts";
import { officePrivatePlacement } from "./office-private-placement.ts";
import { verifyOfficeActorPhase } from "./office-core-origin.ts";
import { officePrivateTurns } from "./office-private-turns.ts";
import { officePrivateReceipt } from "./office-private-receipt.ts";
import type { OfficeEditorBinding } from "./office-editor-grants.ts";
import { officeNativeHandles } from "./office-native-handles.ts";
import { officeNativeRead } from "./office-native-read.ts";
import { officeNativeWrite } from "./office-native-write.ts";
import { dispatchOfficeMetadata } from "./office-metadata-dispatch.ts";
import { officeJobClaims } from "./office-job-claims.ts";
import { officePrivateJobs } from "./office-private-jobs.ts";
import { officeTaskStorage } from "./office-task-storage.ts";

export { OfficePrivateCall, OfficePrivateReply };

/** Concrete finite backend after genuine original process/session/View proof; no generic property/SQL RPC. */
export function officePrivateBackend(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  namespace: OfficeNamespace,
  cohort: {
    readonly nodeId: string;
    readonly imageDigest: string;
    readonly policyVersion: string;
    readonly nativeAttempts: Map<string, number>;
  },
  binding: OfficeEditorBinding | null,
) {
  const authority = officePrivateAuthority(metadata, request);
  const storage = officeTaskStorage(metadata, request, createOfficeBytes(options));
  const bytes = storage.bytes;
  const turns = officePrivateTurns(
    options,
    metadata,
    cohort.nodeId,
    request,
    cohort.nativeAttempts,
  );
  const channel = binding?.channel ?? null;
  const editor = binding?.grants ?? null;
  const handles = officeNativeHandles(options, metadata, request, turns, cohort, editor);
  const placement = officePrivatePlacement(options, metadata, cohort.nodeId, request);
  const claims = officeJobClaims(metadata, request, cohort);
  const jobs = officePrivateJobs(namespace, request, claims, cohort.nodeId);
  return {
    handles,
    jobs,
    channel,
    editor,
    bytes,
    async call(payload: unknown, cleanup: boolean) {
      const call = decodeWireSync(OfficePrivateCall)(payload);
      if (cleanup && !cleanupMethods.has(call.method)) throw officeDenied();
      if (!cleanup) await request.live();
      if (Schema.is(metadataRequest)(call)) {
        const response = await Effect.runPromise(
          dispatchOfficeMetadata(
            metadata,
            (candidate) =>
              authority.authorize(candidate).pipe(
                Effect.andThen(storage.authorize(candidate)),
                Effect.andThen(
                  Effect.tryPromise({
                    try: async () => {
                      if ("permit" in candidate.input) turns.verifyPermit(candidate.input.permit);
                      await claims.before(candidate);
                    },
                    catch: officeDenied,
                  }),
                ),
              ),
            call,
          ),
        );
        claims.after(response);
        await storage.after(response);
        await request.live();
        return response;
      }
      let value: unknown;
      if (Schema.is(readRequest)(call))
        value = await handles.use(
          call.input.handleId,
          (handle) => officeNativeRead(handle, call),
          call.method,
        );
      else if (Schema.is(writeRequest)(call))
        value = await handles.use(call.input.handleId, (handle) => officeNativeWrite(handle, call));
      else if (Schema.is(HostNativePieces.register.request)(call))
        value = await handles.use(call.input.handleId, async (handle) => {
          if (handle.writer === null) throw officeDenied();
          return handle.writer.register(call.input.value, call.input.header, call.input.producer);
        });
      else if (Schema.is(HostBytes.removeUnreachable.request)(call)) {
        if (request.viewId !== null || !officeSame(call.input.owner, request.original.actor.owner))
          throw officeDenied();
        await Effect.runPromise(
          bytes.removeUnreachable(call.input.owner, call.input.id, call.input.notBefore),
        );
        value = null;
      } else if (Schema.is(NativeChannelMember.request)(call)) {
        if (channel === null || call.input.channelId !== channel.channelId) throw officeDenied();
        await channel.member(call.input);
        value = { invocationId: request.id };
      } else if (Schema.is(NativeChannelSubmission.request)(call)) {
        if (channel === null || editor === null || call.input.channelId !== channel.channelId)
          throw officeDenied();
        value = await editor.submission(call.input.memberId, call.input.sid, call.input.reqId);
      } else if (Schema.is(editorRequest)(call)) {
        if (editor === null) throw officeDenied();
        value = await editor.call(call);
      } else if (Schema.is(controlRequest)(call)) {
        switch (call.method) {
          case "actor.verify":
            await verifyOfficeActorPhase(
              metadata,
              request,
              turns,
              call.input,
              cohort.policyVersion,
            );
            value = null;
            break;
          case "authority.current": {
            if (!officeSame(call.input.owner, request.original.actor.owner)) throw officeDenied();
            const current = await placement(call.input.documentId);
            value = { authorityEpoch: current.authorityEpoch, serviceEpoch: current.serviceEpoch };
            break;
          }
          case "receipt.observe":
            value = await officePrivateReceipt(
              options,
              metadata,
              request,
              cohort.nodeId,
              call.input,
            );
            break;
          case "turn.acquire":
            value = await turns.acquire(
              call.input.attemptId,
              call.input.target,
              call.input.admission,
            );
            break;
          case "turn.renew":
            throw officeDenied(); // No renewal permission: retain original absolute admission.
          case "turn.release":
            value = await turns.release(call.input.turnId, call.input.expectedVersion);
            break;
          case "native.open":
            value = await handles.open(call.input.access);
            break;
          case "native.close":
            await handles.close(call.input.handleId);
            value = null;
            break;
        }
      } else throw officeDenied();
      if (!cleanup) await request.live();
      return decodeWireSync(OfficePrivateReply)({ method: call.method, value });
    },
    /** Caller first revokes ingress and joins actual callbacks (including pending native.open). */
    async drain() {
      const native = await Promise.allSettled([handles.drain()]);
      const resources = await Promise.allSettled([turns.drain(), jobs.close()]);
      if ([...native, ...resources].some((item) => item.status === "rejected"))
        throw officeDenied();
    },
  };
}
export type OfficePrivateBackend = ReturnType<typeof officePrivateBackend>;
