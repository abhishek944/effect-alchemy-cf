export type {
  AcceptedOfficeFile,
  OfficeAttachment,
  OfficeAttachmentPage,
  OfficeAttachmentSummary,
  OfficeAttachmentsRequest,
  OfficeIntentCommand,
  OfficePiHost,
  OfficeResolution,
  OfficeTaskAccess,
  OfficeTaskPort,
  OfficeToolContext,
  OfficeToolIntent,
} from "./types.ts";
export { OFFICE_GUIDANCE } from "./guidance.ts";
export {
  makeOfficeExtension,
  OFFICE_EXTENSION_NAME,
  OFFICE_TOOL_NAME,
  OFFICE_PANEL_TOOL_NAME,
} from "./extension.ts";
export { attachmentListTool, OFFICE_ATTACHMENTS_TOOL_NAME } from "./attachment-tool.ts";
export { OFFICE_TOOL_RESULT_BYTES } from "./results.ts";
export { OfficeStagingFailure, officeStagingFailure } from "./staging-failure.ts";
export type { OfficeStagingPhase } from "./staging-failure.ts";
export {
  AttachmentListRequest,
  OfficePanelRequest,
  UniverCliRequest,
  attachmentListParameters,
  officeToolParameters,
} from "./parameters.ts";
export type { OfficeToolSource } from "./parameters.ts";
export { parseUniverCommand } from "./cli.ts";
