import type { D1Database } from "@cloudflare/workers-types";
import { initializeOfficeMetadataSchema } from "@starter/office-cloudflare/metadata";
import { initializeCoordinatorSchema } from "@starter/office-cloudflare/coordinator-control";
import { initializeNativeSchema } from "@starter/office-cloudflare/native";

/** Both first Human use and Task target discovery need all existing storage families. */
export async function initializeOfficeStorageSchema(database: D1Database): Promise<void> {
  await initializeOfficeMetadataSchema(database);
  await initializeNativeSchema(database);
  await initializeCoordinatorSchema(database);
}
