import { withCause, reportFailure } from "@starter/diagnostics";
import {
  ArtifactRef,
  OfficeCommand,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
  type DraftTarget,
  type Receipt,
} from "@starter/office-contract";
import { OfficeStagingFailure, officeStagingFailure } from "./staging-failure.ts";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { dispatch, checkReceipt, receiptKind, type OfficeOutput } from "./dispatch.ts";
import { bindIntent, claimDispatch, digestBytes, hasOperation, type OfficeStep } from "./intent.ts";
import type { OfficeToolSource } from "./parameters.ts";
import type {
  OfficeTaskAccess,
  OfficeAttachment,
  OfficePiHost,
  OfficeToolContext,
} from "./types.ts";

export type OfficeWorkflow = ReturnType<typeof officeWorkflow>;
/** Internal orchestration; private step attestations bind every operation to the real tool call. */
export function officeWorkflow(
  request: unknown,
  source: string | OfficeToolSource,
  api: ToolExecutionApi,
  context: OfficeToolContext,
  host: OfficePiHost,
) {
  const selector = typeof source === "string" ? { attachmentId: source } : source;
  const attachmentId = "attachmentId" in selector ? selector.attachmentId : undefined;
  let reference: OfficeTaskAccess["reference"];
  let referenceBasis: DraftTarget | undefined;
  let attachment: OfficeAttachment | undefined;
  let receipt: Receipt | null | undefined;
  let basis: DraftTarget | undefined;
  const prepare = async (raw: OfficeCommand, label: string, operationId?: string) => {
    const step: OfficeStep = {
      ...selector,
      step: label,
      ...(operationId ? { operationId } : {}),
      ...(basis ? { basis } : {}),
    };
    const binding = await bindIntent(decodeWireSync(OfficeCommand)(raw), api, context, step);
    const candidate = {
      requestDigest: await digestBytes(new TextEncoder().encode(JSON.stringify(request))),
      intentDigest: binding.intent.digest,
    };
    const saved = await api.memo(`univer.step.v1.${label}`, candidate, context);
    if (JSON.stringify(saved) !== JSON.stringify(candidate))
      throw new OfficeUnavailable(safeFailure("IDEMPOTENCY_CONFLICT"));
    const access = await host
      .resolve({ api, context, intent: binding.intent })
      .catch((error: unknown) => {
        context.abortSignal?.throwIfAborted();
        if (raw.command === "stage-file" || raw.command === "stage-code")
          // Admission can fail on recovery of an earlier claimed dispatch; do not assert no prior IO.
          throw officeStagingFailure(binding.intent.operationId, "stage-admission", true, error);
        throw error;
      });
    if (
      "referenceId" in selector
        ? access.reference?.id !== selector.referenceId
        : access.attachment?.id !== attachmentId
    )
      throw new OfficeUnavailable(safeFailure("FORBIDDEN"));
    reference = access.reference;
    referenceBasis = access.referenceBasis;
    attachment = access.attachment;
    receipt = access.attachmentReceipt;
    context.abortSignal?.throwIfAborted();
    return { ...binding, access };
  };
  return {
    get referenceBasis() {
      return referenceBasis;
    },
    get attachment() {
      return attachment;
    },
    set basis(value: DraftTarget) {
      basis = value;
    },
    async describeReference() {
      if (!("referenceId" in selector)) throw new OfficeUnavailable(safeFailure("FORBIDDEN"));
      await prepare(
        { command: "operation", operationId: `reference_open_${selector.referenceId}` },
        "describe",
      );
      if (reference === undefined) throw new OfficeUnavailable(safeFailure("FORBIDDEN"));
      return reference;
    },
    async describe() {
      await prepare({ command: "operation", operationId: `file_open_${attachmentId}` }, "describe");
      if (!attachment || receipt === undefined)
        throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
      return { attachment, receipt };
    },
    async run(command: OfficeCommand, label: string, operationId?: string): Promise<OfficeOutput> {
      const bound = await prepare(command, label, operationId);
      const { intent, access } = bound;
      const staging =
        bound.command.command === "stage-file" || bound.command.command === "stage-code";
      let dispatched = false;
      try {
        if (bound.command.command === "operation" && access.observeStaged)
          return await observeStage();
        if (hasOperation(bound.command)) {
          await api.details({ command: command.command, operationId: intent.operationId }, context);
          if (!(await claimDispatch(intent, api, context))) return await observe();
          dispatched = true;
        }
        return await dispatch(bound.command, access, context.abortSignal);
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        if (staging && error instanceof OfficeStagingFailure) throw error;
        if (dispatched) {
          reportFailure(error, {
            component: "office.workflow",
            operation: "dispatch",
            operationId: intent.operationId,
            event: "application.recovery",
          });
          return await observe(error);
        }
        throw error;
      }
      async function observeStage(): Promise<OfficeOutput> {
        const id =
          bound.command.command === "operation" ? bound.command.operationId : intent.operationId;
        try {
          const raw = await access.observeStaged?.();
          if (!raw) throw officeStagingFailure(id, "upload-observation", true);
          const value = decodeWireSync(ArtifactRef)(raw);
          if (value.id !== id) throw officeStagingFailure(id, "upload-observation", true);
          return { kind: "artifact", value };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          throw officeStagingFailure(id, "upload-observation", true, error);
        }
      }
      async function observe(dispatchFailure?: unknown): Promise<OfficeOutput> {
        if (staging) return await observeStage();
        if (receiptKind(bound.command) === null)
          throw withCause(
            new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN", intent.operationId)),
            dispatchFailure,
          );
        try {
          const raw = await access.client.receipt({ operationId: intent.operationId });
          return {
            kind: "receipt",
            value: checkReceipt(raw, intent.operationId, receiptKind(bound.command)),
          };
        } catch (cause) {
          context.abortSignal?.throwIfAborted();
          throw withCause(
            new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN", intent.operationId)),
            dispatchFailure === undefined
              ? cause
              : new AggregateError([dispatchFailure, cause], "Dispatch and observation failed"),
          );
        }
      }
    },
  };
}
