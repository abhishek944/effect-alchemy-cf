/** Server-only Core. Complete service composition exists; integrated authority/native acceptance is separate. */
export { makeOffice, composeOffice } from "./make-office.ts";
export { Office } from "../ports/service.ts";
export type { OfficeDependencies, OfficeService } from "../ports/service.ts";
export { makeNativeRuntime, OfficeNativeRuntime } from "./native-runtime.ts";
export type { NativeServices } from "./native-services.ts";
export { makeOfficeReads } from "./reads.ts";
export { makeOfficeFiles } from "./files.ts";
export { makeOfficeViews, lookupView } from "./views.ts";
export { makeOfficeEditors } from "./editors.ts";
export { makeOfficeExecution } from "./execute.ts";
export { makeOfficeCreation } from "./create.ts";
export { makeOfficeReady } from "./ready.ts";
export { makeOfficeApproval } from "./approve.ts";
export { makeOfficeMerge } from "./merge.ts";
export { makeOfficeReadJobs } from "./read-jobs/index.ts";
export { reserveOperation, advanceOperation } from "./operations.ts";
export { makeNativeJournal } from "./native-journal.ts";
export { observeNativeWrite, originalWriteTarget } from "./write-observation.ts";
