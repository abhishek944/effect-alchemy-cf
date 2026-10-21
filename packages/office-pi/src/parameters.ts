import { Schema } from "effect";
import { OfficeCommand } from "@starter/office-contract";

/** One actual finite command schema; the object wrapper supports provider root-object rules. */
export const OfficeToolRequest = Schema.Struct({ request: OfficeCommand });
const document = Schema.toJsonSchemaDocument(OfficeToolRequest);
export const officeToolParameters = { ...document.schema, $defs: document.definitions };
