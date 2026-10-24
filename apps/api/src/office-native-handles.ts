import { Effect } from "effect";
import { createNativeStorage } from "@starter/office-cloudflare/native";
import type { NativeInvocation, NativeReadInvocation } from "@starter/office-cloudflare/native";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { NativeAccess, OfficeMetadata } from "@starter/office-server/ports";
import type { OfficePrivateTurns } from "./office-private-turns.ts";
import type { OfficeEditorGrants } from "./office-editor-grants.ts";
import { officeNativeWriter } from "./office-native-writer.ts";
import { assertOfficeTaskRead } from "./office-task-read-policy.ts";
import { officeTaskDescriptorRequest } from "./office-task-descriptor.ts";
import type { HostNativeReads } from "@starter/office-server/native-remote";
import { retireOfficeNativeHandle, type OfficeNativeHandle } from "./office-native-handle.ts";
import {
  officePrivateAuthority,
  officeDenied,
  officeSame,
  officeNativeContext,
  type OfficePrivateRequest,
} from "./office-private-authority.ts";
import { officeDeniedReason } from "./office-private-values.ts";
import { officePrivatePlacement } from "./office-private-placement.ts";
export type { OfficeNativeHandle } from "./office-native-handle.ts";

export function officeNativeHandles(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  turns: OfficePrivateTurns,
  cohort: { readonly nodeId: string; readonly imageDigest: string; readonly policyVersion: string },
  editor: OfficeEditorGrants | null,
) {
  const handles = new Map<string, OfficeNativeHandle>();
  const closed = new Set<string>();
  const writerAttempts = new Set<string>();
  const authority = officePrivateAuthority(metadata, request);
  return {
    async open(access: NativeAccess) {
      await request.live();
      await assertOfficeTaskRead(metadata, request, access);
      if (handles.size >= 64) throw officeDeniedReason("open-handle-limit");
      const target = access.kind === "read" ? access.target : access.permit.target;
      await Effect.runPromise(authority.target(target));
      if (request.command === null) {
        if (request.viewId === null) throw officeDeniedReason("open-view-unspecified");
        const view = await Effect.runPromise(metadata.view(target.owner, request.viewId));
        if (view === null) throw officeDeniedReason("open-view-missing");
        if (view.view.expiresAt <= Date.now()) throw officeDeniedReason("open-view-expired");
        if (!officeSame(view.target, target)) throw officeDeniedReason("open-view-target");
      }
      const placement = await officePrivatePlacement(
        options,
        metadata,
        cohort.nodeId,
        request,
      )(target.documentId);
      const epochs = access.kind === "read" ? access : access.permit;
      if (placement.authorityEpoch !== epochs.authorityEpoch)
        throw officeDeniedReason("open-authority-epoch");
      if (placement.serviceEpoch !== epochs.serviceEpoch)
        throw officeDeniedReason("open-service-epoch");
      const held =
        access.kind === "write"
          ? turns.require(access.permit)
          : access.kind === "editor" && editor !== null
            ? await editor.require(access.permit)
            : null;
      if (access.kind !== "read" && held === null) throw officeDeniedReason("open-grant-missing");
      if (held !== null) {
        const identity = JSON.stringify([held.kind, held.permit.stepId]);
        if (writerAttempts.has(identity)) throw officeDeniedReason("open-writer-replay");
        writerAttempts.add(identity); // Lost native.open ACK cannot create a second original writer pair.
      }
      const draft =
        target.scope.kind === "draft"
          ? await Effect.runPromise(metadata.draft(target.owner, target.scope.draftId))
          : null;
      const storage = createNativeStorage(options, {
        stage: target.owner.stage,
        ownerID: target.owner.ownerId,
        documentID: target.documentId,
        unitID: target.unitId,
      });
      // Core writers may inspect advanced main; editor/read grants retain their original baseline ceiling.
      const grant = {
        epoch: epochs.authorityEpoch,
        ...(draft === null || access.kind === "write"
          ? {}
          : {
              draft: { worktreeID: draft.worktreeId, generation: draft.generation },
            }),
      };
      const reader = access.kind === "write" ? null : await storage.readReferences(grant);
      let pair: NativeInvocation | NativeReadInvocation;
      let writer: Awaited<ReturnType<typeof officeNativeWriter>> | null = null;
      try {
        if (held === null) pair = await storage.readInvocation(grant);
        else {
          writer = await officeNativeWriter(
            options,
            metadata,
            held,
            request,
            cohort.imageDigest,
            cohort.policyVersion,
          );
          pair = writer.writer;
        }
      } catch (error) {
        await reader?.dispose();
        throw error;
      }
      try {
        const unit =
          draft === null
            ? null
            : await pair.worktrees.getWorktreeUnit(
                officeNativeContext(request, access),
                draft.worktreeId,
                target.unitId,
              );
        const id = crypto.randomUUID();
        const notAfter =
          held === null
            ? request.original.deadline
            : held.kind === "core"
              ? held.turn.deadline
              : held.admission.notAfter;
        const reads = writer?.kind === "core" ? writer.writer.references.reads : reader?.reads;
        if (reads === undefined) throw officeDeniedReason("open-reads-missing");
        const handle: OfficeNativeHandle = {
          id,
          request,
          target,
          descriptor: officeTaskDescriptorRequest(request),
          pair,
          reader,
          writer,
          reads,
          worktreeId: draft?.worktreeId ?? null,
          baselineRevision: unit?.baselineTrunkRevision ?? null,
          deadline: Math.min(request.original.deadline, placement.until, notAfter),
          active: true,
          failed: false,
          io: new Set(),
          pending: new Set(),
        };
        handles.set(id, handle);
        return {
          handleId: id,
          worktreeId: handle.worktreeId,
          baselineRevision: handle.baselineRevision,
          deadline: handle.deadline,
        };
      } catch (error) {
        const cleanup = await Promise.allSettled([pair.dispose(), reader?.dispose()]);
        if (cleanup.some((item) => item.status === "rejected"))
          throw officeDeniedReason("open-cleanup-failed");
        throw error;
      }
    },
    async use<A>(
      id: string,
      body: (handle: OfficeNativeHandle) => Promise<A>,
      method?: (typeof HostNativeReads)[keyof typeof HostNativeReads]["method"],
    ): Promise<A> {
      const handle = handles.get(id);
      if (handle === undefined) throw officeDenied();
      if (handle.descriptor && !["core.unit", "draft.record", "draft.unit"].includes(method ?? ""))
        throw officeDenied();
      // Ingress owns authorization; this handle owns lifetime, and the provider fences publication.
      const actual = Promise.resolve().then(() => {
        request.signal.throwIfAborted();
        if (!handle.active || Date.now() >= handle.deadline) throw officeDenied();
        return body(handle);
      });
      const observed = actual.then(
        () => undefined,
        () => undefined,
      );
      handle.pending.add(observed);
      try {
        const value = await actual;
        if (!handle.active || Date.now() >= handle.deadline) throw officeDenied();
        return value;
      } finally {
        handle.pending.delete(observed);
      }
    },
    close(id: string) {
      return retireOfficeNativeHandle(handles, closed, id);
    },
    async drain() {
      const result = await Promise.allSettled(
        [...handles.keys()].map((id) => retireOfficeNativeHandle(handles, closed, id)),
      );
      if (result.some((item) => item.status === "rejected")) throw officeDenied();
    },
  };
}
export type OfficeNativeHandles = ReturnType<typeof officeNativeHandles>;
