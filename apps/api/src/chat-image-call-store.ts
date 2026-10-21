import type { AgentContext } from "agents";
import { DomainUuid } from "./chat-capabilities.ts";
import { committedId } from "./chat-text.ts";
import type { ImageUsagePresentation } from "./chat-image-presentation.ts";
import {
  ImageCallAdmission,
  ImageCallState,
  type ImageCallView,
  type ImageCallUpdate,
  type AssistantSavedFilesPage,
} from "./chat-image-call-schema.ts";
import { decodeCallRow, encodeAdmission } from "./chat-image-call-codec.ts";
import { initialImageCallCost, isUnsettledImageCall } from "./chat-image-call-cost.ts";
import { assistantCallFiles } from "./chat-image-call-files.ts";
import { recordImageCall } from "./chat-image-call-record.ts";
import { ImageCallTable } from "./chat-image-call-table.ts";
import { imageCallUsage } from "./chat-image-call-usage.ts";
import {
  CALL_EVIDENCE_BYTES,
  CallDigest,
  CallIndex,
  CallPositive,
  callBoundary,
  callPageSize,
  callParse,
  callValue,
  freezeCall,
  ImageCallError,
} from "./chat-image-call-values.ts";

/** Local evidence only. No method grants owner consume, native or provider authority. */
export class ChatImageCallStore {
  private readonly storage: AgentContext["storage"];
  private readonly table: ImageCallTable;
  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    this.table = callBoundary(() => new ImageCallTable(storage));
  }
  admit(input: ImageCallAdmission): { fresh: boolean } {
    return callBoundary(() => {
      const json = encodeAdmission(input);
      const valid = callValue(ImageCallAdmission, callParse(json, CALL_EVIDENCE_BYTES));
      return this.storage.transactionSync(() => {
        const known = this.read(valid.key);
        if (known !== null) {
          if (encodeAdmission(known.admission) !== json) throw new ImageCallError("conflict");
          return { fresh: false };
        }
        if (this.table.collision(valid)) throw new ImageCallError("conflict");
        const state = callValue(ImageCallState, {
          status: "prepared",
          started: false,
          dispatched: false,
          failureLatched: false,
          ownerFinalizationPending: true,
          outcome: { dispatched: false, uncertain: false, storageUncertain: false, partial: false },
          metadata: null,
          cost: initialImageCallCost(),
          outputCount: 0,
        });
        this.table.insert(valid, json, state);
        return { fresh: true };
      });
    });
  }
  read(key: string): ImageCallView | null {
    return callBoundary(() => {
      callValue(CallDigest, key);
      const row = this.table.get(key);
      if (row === undefined) return null;
      const view = decodeCallRow(row, this.table.sql);
      if (view.admission.key !== key) throw new ImageCallError("corrupt");
      return view;
    });
  }
  private require(key: string): ImageCallView {
    const value = this.read(key);
    if (value === null) throw new ImageCallError("invalid_input");
    return value;
  }
  start(key: string): boolean {
    return callBoundary(() =>
      this.storage.transactionSync(() => {
        const { admission: _admission, ...state } = this.require(key);
        if (state.started || state.status !== "prepared") return false;
        this.table.write(
          key,
          callValue(ImageCallState, {
            ...state,
            status: "started",
            started: true,
            ownerFinalizationPending: true,
          }),
        );
        return true;
      }),
    );
  }
  markDispatched(key: string): boolean {
    return callBoundary(() =>
      this.storage.transactionSync(() => {
        const { admission: _admission, ...state } = this.require(key);
        if (!state.started || state.dispatched || state.status !== "started") return false;
        this.table.write(
          key,
          callValue(ImageCallState, {
            ...state,
            dispatched: true,
            outcome: { ...state.outcome, dispatched: true },
          }),
        );
        return true;
      }),
    );
  }
  markOwnerFinalizationPending(key: string): void {
    this.ownerFinalization(key, true);
  }
  /** Caller must prove owner finish/no-reservation; receipt presence or timeout is not proof. */
  acknowledgeOwnerFinalization(key: string): void {
    this.ownerFinalization(key, false);
  }
  private ownerFinalization(key: string, pending: boolean): void {
    callBoundary(() =>
      this.storage.transactionSync(() => {
        const { admission: _admission, ...state } = this.require(key);
        if (state.ownerFinalizationPending === pending) return;
        this.table.write(
          key,
          callValue(ImageCallState, { ...state, ownerFinalizationPending: pending }),
        );
      }),
    );
  }
  record(key: string, update: ImageCallUpdate): void {
    callBoundary(() =>
      this.storage.transactionSync(() => recordImageCall(this.table, this.require(key), update)),
    );
  }
  logicalState(
    logicalOperationId: string,
    excludingOperationId?: string,
  ): {
    started: boolean;
    dispatched: boolean;
    blocked: boolean;
  } {
    return callBoundary(() => {
      callValue(DomainUuid, logicalOperationId);
      if (excludingOperationId !== undefined) callValue(DomainUuid, excludingOperationId);
      const row = this.table.logical(logicalOperationId, excludingOperationId);
      if (Object.values(row).some((value) => value !== 0 && value !== 1))
        throw new ImageCallError("corrupt");
      return freezeCall({
        started: row.started === 1,
        dispatched: row.dispatched === 1,
        blocked: row.blocked === 1,
      });
    });
  }
  unsettled(after?: string, limit = 30): { keys: readonly string[]; nextCursor: string | null } {
    return callBoundary(() => {
      if (after !== undefined && this.read(after) === null)
        throw new ImageCallError("invalid_input");
      const rows = this.table.unsettled(after ?? "", callPageSize(limit));
      let previous = after ?? "";
      const keys = rows
        .map((row) => {
          const view = decodeCallRow(row, this.table.sql);
          const key = view.admission.key;
          if (key <= previous || !isUnsettledImageCall(view)) throw new ImageCallError("corrupt");
          previous = key;
          return key;
        })
        .slice(0, limit);
      return freezeCall({ keys, nextCursor: rows.length > limit ? (keys.at(-1) ?? null) : null });
    });
  }
  assistantFiles(messageId: string, cursor?: string): AssistantSavedFilesPage {
    return callBoundary(() =>
      assistantCallFiles(this.table.sql, (key) => this.read(key), messageId, cursor),
    );
  }
  hasAssistantFiles(entryId: number, modelIndex: number): boolean {
    return callBoundary(() => {
      callValue(CallPositive, entryId);
      callValue(CallIndex, modelIndex);
      return this.table.hasAssistantFiles(entryId, modelIndex);
    });
  }
  usage(messageId?: string): ImageUsagePresentation {
    return callBoundary(() => {
      const position = messageId === undefined ? undefined : committedId(messageId);
      if (position === null) throw new ImageCallError("invalid_input");
      return imageCallUsage(this.table, position);
    });
  }
}
