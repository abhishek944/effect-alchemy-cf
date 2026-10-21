export type {
  AcceptedOfficeFile,
  OfficeIntentCommand,
  OfficePiHost,
  OfficeResolution,
  OfficeTaskAccess,
  OfficeTaskClient,
  OfficeToolContext,
  OfficeToolIntent,
} from "./types.ts";
export { OFFICE_GUIDANCE } from "./guidance.ts";
export { makeOfficeExtension, OFFICE_EXTENSION_NAME, OFFICE_TOOL_NAME } from "./extension.ts";
export { OFFICE_TOOL_RESULT_BYTES } from "./results.ts";
export { OfficeToolRequest, officeToolParameters } from "./parameters.ts";
