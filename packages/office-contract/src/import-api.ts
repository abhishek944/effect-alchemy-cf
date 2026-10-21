import * as Endpoint from "effect/http-api/HttpApiEndpoint";
import { ImportInto } from "./import-into.ts";
import { OfficeErrors } from "./errors.ts";
import { Receipt } from "./models.ts";
export const ImportIntoEndpoint = Endpoint.post("importInto", "/api/office/import-into", {
  payload: ImportInto,
  error: OfficeErrors,
  success: Receipt,
});
