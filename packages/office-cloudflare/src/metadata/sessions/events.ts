import type { OwnerScope, ViewRecord } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "../store.ts";
import { eventStatement } from "../events.ts";

export function leaseEvent(db: MetadataStore, owner: OwnerScope, view: ViewRecord): Statement {
  const scope = view.target.scope;
  return eventStatement(db, owner, {
    documentId: view.view.documentId,
    draftId: scope.kind === "draft" ? scope.draftId : null,
    generation: scope.kind === "draft" ? scope.generation : 0,
    revision: null,
    operationId: null,
    kind: "editor-state",
  });
}
