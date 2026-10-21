import { isDeepStrictEqual } from "node:util";
import { Effect } from "effect";
import { UniverType } from "@univerjs/protocol";
import type { UnitRecord } from "@univerjs-pro/collaboration-service";
import type { NodeHttpTransportContext } from "@univerjs-pro/collaboration-transport-node";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import type { OfficeNativeRuntime } from "@starter/office-server";
import {
  evaluateViewPermissions,
  type OfficeViewProtocol,
} from "@starter/office-server/native-protocol";
import { decodeNativeViewSnapshot } from "@starter/office-server/native-codec";
import type { HumanActor, OfficeDependencies } from "@starter/office-server/ports";
import { resolveNativeView } from "./native-app-view.ts";
import { readBytes } from "./native-stream-io.ts";
import { readOfficeNodeJson } from "./native-office-http.ts";
import { serializeViewSnapshot } from "./native-view-serializer.ts";

export type OfficeViewInvocation = {
  readonly actor: HumanActor;
  readonly editorId: string | null;
  /** Actual persisted source metadata, proved by T47. Never guessed creator/timestamps for an artifact. */
  readonly unit: UnitRecord | null;
  readonly signal: AbortSignal;
  readonly deadline: number;
};
const denied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
/** Human View reads only. Auth/process/grant issuance belongs to the required genuine T47 resolver. */
export function createOfficeViewProtocol(options: {
  readonly dependencies: OfficeDependencies;
  readonly runtime: OfficeNativeRuntime;
  readonly viewId: string;
  readonly resolve: (
    context: NodeHttpTransportContext,
    viewId: string,
  ) => Promise<OfficeViewInvocation>;
  readonly onCleanupFailure: () => void;
}): OfficeViewProtocol {
  async function authorize(context: NodeHttpTransportContext) {
    const invocation = await options.resolve(context, options.viewId);
    let viewDeadline: number | undefined;
    const check = () => {
      if (
        invocation.actor.capability !== "human" ||
        !(invocation.signal instanceof AbortSignal) ||
        invocation.signal.aborted ||
        !Number.isSafeInteger(invocation.deadline) ||
        Date.now() >= invocation.deadline ||
        (viewDeadline !== undefined && Date.now() >= viewDeadline)
      )
        throw denied();
    };
    check();
    const record = await Effect.runPromise(
      resolveNativeView(
        options.dependencies,
        invocation.actor.owner,
        options.viewId,
        invocation.signal,
      ),
    );
    viewDeadline = record.view.expiresAt;
    await Effect.runPromise(
      options.dependencies.verifyActor({
        claims: invocation.actor,
        phase: "request",
        operationId: null,
        intentDigest: null,
        target: record.target,
      }),
    );
    check();
    return { invocation, record, check };
  }
  return {
    async permissions(context) {
      const { invocation, check } = await authorize(context);
      const body = await readOfficeNodeJson(
        context.incomingMessage,
        invocation.signal,
        invocation.deadline,
      );
      const value = await Effect.runPromise(
        evaluateViewPermissions(
          options.dependencies,
          options.runtime,
          invocation.actor,
          options.viewId,
          invocation.editorId,
          body,
        ),
      );
      check();
      context.response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "private, no-store",
      });
      context.response.end(JSON.stringify(value));
    },
    async snapshot(context) {
      const { invocation, record, check } = await authorize(context);
      // Live main/draft paths use the original SDK transport via17's exact ingress prefix mapping.
      if (
        record.source.kind !== "artifact" ||
        record.view.nativeTarget.kind !== "pinned-snapshot" ||
        invocation.unit === null
      )
        throw denied();
      const stored = await Effect.runPromise(
        options.dependencies.bytes.get(record.owner, record.source.artifact.id),
      );
      if (stored === null) throw denied();
      if (!isDeepStrictEqual(stored.ref, record.source.artifact)) {
        await stored.body.cancel();
        throw denied();
      }
      const readers = new Set<{ cancel(reason: unknown): Promise<void> }>();
      const bytes = await readBytes(
        stored.body,
        stored.ref.bytes,
        options.dependencies.policy.limits.nativeBytes,
        stored.ref.digest,
        readers,
        check,
      );
      const kind =
        record.view.kind === "sheet"
          ? UniverType.UNIVER_SHEET
          : record.view.kind === "doc"
            ? UniverType.UNIVER_DOC
            : UniverType.UNIVER_SLIDE;
      const native = decodeNativeViewSnapshot(
        bytes,
        { unitID: record.target.unitId, type: kind, revision: record.view.revision },
        options.dependencies.policy.limits.nativeBytes,
      );
      check();
      await serializeViewSnapshot({
        request: context.incomingMessage,
        response: context.response,
        viewId: options.viewId,
        native,
        unit: invocation.unit,
        userId: record.owner.ownerId,
        check,
        onCleanupFailure: options.onCleanupFailure,
      });
    },
    // No owner/document native-file association has been issued. Never invent signed URLs/upload success.
    imageSign: () => Promise.reject(denied()),
    imageUpload: () => Promise.reject(denied()),
  };
}
