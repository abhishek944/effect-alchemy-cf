import { Effect } from "effect";
import { HostMetadata } from "@starter/office-server/native-remote";
import type { OfficeMetadata } from "@starter/office-server/ports";
import type { OfficeControlCaller } from "./native-channel.ts";

/** Explicit finite mappings; the Worker independently validates original authority on every call. */
export function createOfficeMetadataClient(channel: OfficeControlCaller): OfficeMetadata {
  return Object.freeze({
    document: (owner, documentId) =>
      channel.call(HostMetadata.document, { owner, documentId }, false),
    documents: (owner, cursor) => channel.call(HostMetadata.documents, { owner, cursor }, false),
    reserveDocument: (record) => channel.call(HostMetadata.reserveDocument, { record }, true),
    publishDocument: (permit) => channel.call(HostMetadata.publishDocument, { permit }, true),
    draft: (owner, draftId) => channel.call(HostMetadata.draft, { owner, draftId }, false),
    drafts: (owner, cursor) => channel.call(HostMetadata.drafts, { owner, cursor }, false),
    reserveDraft: (record) => channel.call(HostMetadata.reserveDraft, { record }, true),
    advanceGeneration: (permit, draftId, expected) =>
      channel.call(HostMetadata.advanceGeneration, { permit, draftId, expected }, true),
    putView: (record) => channel.call(HostMetadata.putView, { record }, true),
    view: (owner, viewId) => channel.call(HostMetadata.view, { owner, viewId }, false),
    historicalViewTarget: (owner, viewId) =>
      channel.call(HostMetadata.historicalViewTarget, { owner, viewId }, false),
    editor: (owner, editorId) => channel.call(HostMetadata.editor, { owner, editorId }, false),
    editors: (owner, documentId) =>
      channel.call(HostMetadata.editors, { owner, documentId }, false),
    changeEditor: (owner, action, expectedEpoch, resolvedView) =>
      channel.call(HostMetadata.changeEditor, { owner, action, expectedEpoch, resolvedView }, true),
    reserveJob: (record) => channel.call(HostMetadata.reserveJob, { record }, true),
    job: (owner, jobId) => channel.call(HostMetadata.job, { owner, jobId }, false),
    advanceJob: (record, expectedVersion) =>
      channel.call(HostMetadata.advanceJob, { record, expectedVersion }, true),
    reserveOperation: (record) => channel.call(HostMetadata.reserveOperation, { record }, true),
    operation: (owner, operationId) =>
      channel.call(HostMetadata.operation, { owner, operationId }, false),
    advanceOperation: (record, expectedVersion) =>
      channel.call(HostMetadata.advanceOperation, { record, expectedVersion }, true),
    claimQueued: (workerId, limit, until) =>
      channel.call(HostMetadata.claimQueued, { workerId, limit, until }, true),
    putReview: (review) => channel.call(HostMetadata.putReview, { review }, true),
    review: (owner, reviewId) => channel.call(HostMetadata.review, { owner, reviewId }, false),
    approve: (approval) => channel.call(HostMetadata.approve, { approval }, true),
    approval: (owner, operationId) =>
      channel.call(HostMetadata.approval, { owner, operationId }, false),
    admitPublication: (permit, operation, approvalOperationId, fingerprint) =>
      channel.call(
        HostMetadata.admitPublication,
        { permit, operation, approvalOperationId, fingerprint },
        true,
      ),
    publicationBarrier: (owner, documentId) =>
      channel.call(HostMetadata.publicationBarrier, { owner, documentId }, false),
    finishPublication: (permit, receipt) =>
      channel.call(HostMetadata.finishPublication, { permit, receipt }, true).pipe(Effect.asVoid),
    stageWrite: (permit, write) => channel.call(HostMetadata.stageWrite, { permit, write }, true),
    prepareWrite: (permit, writeId, binding) =>
      channel.call(HostMetadata.prepareWrite, { permit, writeId, binding }, true),
    writes: (owner, operationId, cursor) =>
      channel.call(HostMetadata.writes, { owner, operationId, cursor }, false),
    confirmWrite: (permit, writeId, acceptedRevision) =>
      channel
        .call(HostMetadata.confirmWrite, { permit, writeId, acceptedRevision }, true)
        .pipe(Effect.asVoid),
    events: (owner, documentId, after) =>
      channel.call(HostMetadata.events, { owner, documentId, after }, false),
  } satisfies OfficeMetadata);
}
