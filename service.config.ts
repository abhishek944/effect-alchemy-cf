/**
 * Legacy product identity. Theme storage keys and account-invalidation events
 * still carry this name so existing local data stays readable; nothing about the
 * current runtime depends on it. Do not rename without a storage migration.
 */
export const serviceName = "ServiceStarter";
