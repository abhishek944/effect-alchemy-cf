import type { OfficeMetadata } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { storeEffect } from "./store.ts";
import { admitPublication, barrierRow } from "./publication-admission.ts";
import { finishPublication } from "./publication-finish.ts";
export function createPublication(
  db: MetadataStore,
): Pick<OfficeMetadata, "admitPublication" | "publicationBarrier" | "finishPublication"> {
  return {
    admitPublication: (permit, record, approval, fingerprint) =>
      storeEffect(() => admitPublication(db, permit, record, approval, fingerprint)),
    publicationBarrier: (owner, id) => storeEffect(() => barrierRow(db, owner, id)),
    finishPublication: (permit, receipt) =>
      storeEffect(() => finishPublication(db, permit, receipt)),
  };
}
