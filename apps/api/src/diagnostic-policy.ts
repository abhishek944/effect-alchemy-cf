import { Forbidden, UserNotFound } from "./admin-model.ts";
import {
  BillingConflict,
  BillingForbidden,
  BillingInvalidInput,
  BillingMissing,
} from "./billing-model.ts";
import {
  ChatArchived,
  ChatBusy,
  ChatForbidden,
  ChatInvalid,
  ChatNotFound,
  ChatRateLimited,
  PayloadTooLarge,
  RefreshRequired,
} from "./chat-model.ts";
import { Unauthorized } from "./model.ts";
import { SkillAttemptNoAdmission } from "./skills-model.ts";

// Only actual public domain rejection classes, never all status-bearing errors or 503s.
const expected = [
  Unauthorized,
  Forbidden,
  UserNotFound,
  BillingConflict,
  BillingForbidden,
  BillingInvalidInput,
  BillingMissing,
  ChatArchived,
  ChatBusy,
  ChatForbidden,
  ChatInvalid,
  ChatNotFound,
  ChatRateLimited,
  PayloadTooLarge,
  RefreshRequired,
  SkillAttemptNoAdmission,
];

export const expectedPublicRejection = (error: unknown): boolean =>
  expected.some((Type) => error instanceof Type);
