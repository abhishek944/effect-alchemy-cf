import type { OfficeMetadata } from "@starter/office-server/ports";
import type { OfficeProviderOptions } from "./store.ts";
import { MetadataStore, storeEffect } from "./store.ts";
import { createCatalog } from "./catalog.ts";
import { createDraftCatalog } from "./drafts.ts";
import { createOperations } from "./operations.ts";
import { createQueue } from "./queue.ts";
import { createEvents } from "./events.ts";
import { createReviews } from "./reviews.ts";
import { createNativeWrites } from "./writes.ts";
import { createPublication } from "./publication.ts";
import { createSessions } from "./sessions/index.ts";
import { readView } from "./sessions/views.ts";
import { createJobMetadata } from "./jobs/index.ts";
export {
  initializeOfficeMetadataSchema,
  metadataSchemaStatements,
  metadataSchemaVersion,
} from "./schema.ts";
export type { OfficeProviderOptions } from "./store.ts";
export { readConfirmedTaskOperations } from "./task-lineage.ts";
export { readOfficeDocumentSources } from "./document-sources.ts";
/** One actual Office D1/R2 metadata bundle. Host initializes schema and supplies trusted stage/worker identity. */
export function createOfficeMetadata(options: OfficeProviderOptions): OfficeMetadata {
  const db = new MetadataStore(options);
  return {
    ...createCatalog(db),
    ...createDraftCatalog(db),
    ...createOperations(db),
    ...createQueue(db),
    ...createEvents(db),
    ...createReviews(db),
    ...createNativeWrites(db),
    ...createPublication(db),
    ...createSessions(db),
    historicalViewTarget: (owner, id) =>
      storeEffect(async () => (await readView(db, owner, id))?.target ?? null),
    ...createJobMetadata(db),
  };
}
