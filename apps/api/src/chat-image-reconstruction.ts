import type { ImageAcceptedBinding } from "./chat-image-response-schema.ts";
import { ImageInputError } from "./chat-image-input-types.ts";
import {
  inspectImageCandidate,
  requireReconstructionClosed,
  type ImageReconstructionAccess,
  type ImageReconstructionContext,
} from "./chat-image-reconstruction-entry.ts";

export type ImageReconstructionResult = {
  readonly status: "progress" | "ready" | "blocked";
  readonly reason: ImageInputError["code"] | null;
  readonly scanned: number;
  readonly bound: number;
  /** Counts in the current full pass, not distinct lifetime operations. */
  readonly absent: number;
  readonly unplaced: number;
};

/**
 * Constant retained metadata: keep only the earliest accepted tuple per pass.
 * At most 8 pages of 30 candidates per step. Finish a COMPLETE pass before each
 * bind, so lexical operation order cannot install an era above an older entry.
 * Repeated passes trade I/O for bounded memory; parent controls the boot budget.
 */
export class ImageInputReconstruction {
  private readonly access: ImageReconstructionAccess;
  private cursor: string | undefined;
  private earliest: ImageAcceptedBinding | null = null;
  private scanned = 0;
  private bound = 0;
  private absent = 0;
  private unplaced = 0;
  private terminal: ImageReconstructionResult | null = null;
  private running = false;

  constructor(access: ImageReconstructionAccess) {
    this.access = access;
  }

  private result(
    status: ImageReconstructionResult["status"],
    reason: ImageInputError["code"] | null = null,
  ): ImageReconstructionResult {
    return Object.freeze({
      status,
      reason,
      scanned: this.scanned,
      bound: this.bound,
      absent: this.absent,
      unplaced: this.unplaced,
    });
  }

  async step(context: ImageReconstructionContext): Promise<ImageReconstructionResult> {
    if (this.running) throw new ImageInputError("conflict");
    if (this.terminal !== null) return this.terminal;
    this.running = true;
    try {
      for (let pages = 0; pages < 8; pages += 1) {
        context.abortSignal?.throwIfAborted();
        requireReconstructionClosed(this.access);
        const page = this.access.responses.unbound(this.cursor, 30);
        if (
          page.operationIds.length > 30 ||
          (page.nextCursor !== null && page.nextCursor <= (this.cursor ?? ""))
        )
          throw new ImageInputError("corrupt");
        let previous = this.cursor ?? "";
        for (const operationId of page.operationIds) {
          if (
            operationId <= previous ||
            (page.nextCursor !== null && operationId > page.nextCursor)
          )
            throw new ImageInputError("corrupt");
          previous = operationId;
          const evidence = await inspectImageCandidate(this.access, operationId, context);
          this.scanned += 1;
          if (evidence.state === "absent") this.absent += 1;
          else if (evidence.state === "unplaced") this.unplaced += 1;
          else {
            const next = evidence.binding;
            if (
              this.earliest?.entryId === next.entryId &&
              this.earliest.operationId !== next.operationId
            )
              throw new ImageInputError("corrupt");
            if (
              this.earliest === null ||
              next.entryId < this.earliest.entryId ||
              (next.entryId === this.earliest.entryId && next.modelIndex < this.earliest.modelIndex)
            )
              this.earliest = next;
          }
        }
        if (page.nextCursor !== null) {
          this.cursor = page.nextCursor;
          continue; // An EMPTY page with continuation is not completion.
        }
        if (this.earliest === null) {
          this.terminal = this.result("ready");
          return this.terminal;
        }
        // Revalidate the minimum tuple immediately before the first/next era CAS.
        const evidence = await inspectImageCandidate(
          this.access,
          this.earliest.operationId,
          context,
        );
        if (
          evidence.state !== "accepted" ||
          evidence.binding.entryId !== this.earliest.entryId ||
          evidence.binding.submissionId !== this.earliest.submissionId ||
          evidence.binding.inputDigest !== this.earliest.inputDigest
        )
          throw new ImageInputError("corrupt");
        requireReconstructionClosed(this.access);
        this.access.responses.bindAccepted(evidence.binding);
        this.bound += 1;
        this.cursor = undefined;
        this.earliest = null;
        this.absent = 0;
        this.unplaced = 0;
        return this.result("progress");
      }
      return this.result("progress");
    } catch (error) {
      const reason = context.abortSignal?.aborted
        ? "cancelled"
        : error instanceof ImageInputError
          ? error.code
          : "corrupt";
      this.terminal = this.result("blocked", reason);
      return this.terminal;
    } finally {
      this.running = false;
    }
  }
}
