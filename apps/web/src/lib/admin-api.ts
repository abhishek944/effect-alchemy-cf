import { readResponseRequestId, serverReference, withReference } from "@/lib/browser-diagnostics";

export type AdminRole = "user" | "admin";

export type AdminIdentity = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
};

export type AdminUser = AdminIdentity & {
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

export class AdminApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;

  constructor(
    status: number,
    message: string,
    requestId: string | null = null,
    operation = "admin.request",
    responseStatus = status,
  ) {
    super(withReference(message, serverReference(operation, responseStatus, requestId)));
    this.name = "AdminApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  401: "Your admin session has ended. Sign in again to continue.",
  403: "This action is not allowed for your account. Sign in again to continue.",
  404: "That record could not be found.",
  429: "Too many attempts. Wait a moment and try again.",
  503: "Admin tools are temporarily unavailable. Try again shortly.",
};

const UNEXPECTED_RESPONSE = "The server returned an unexpected response. Try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRole(value: unknown): value is AdminRole {
  return value === "user" || value === "admin";
}

function isIdentity(value: unknown): value is AdminIdentity {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    isRole(value.role)
  );
}

function isAdminUser(value: unknown): value is AdminUser {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    isRole(value.role) &&
    typeof value.emailVerified === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

async function request(
  path: string,
  init: RequestInit | undefined,
  operation: string,
): Promise<{ body: unknown; requestId: string | null; status: number }> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      ...init,
    });
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new AdminApiError(
      0,
      "Network unavailable. Check your connection and try again.",
      null,
      operation,
    );
  }
  const requestId = readResponseRequestId(response);
  if (!response.ok) {
    const message = STATUS_MESSAGES[response.status];
    throw new AdminApiError(
      response.status,
      message ?? `Request failed (${response.status}).`,
      requestId,
      operation,
    );
  }
  if (response.status === 204) return { body: null, requestId, status: response.status };
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new AdminApiError(502, UNEXPECTED_RESPONSE, requestId, operation, response.status);
  }
  return { body, requestId, status: response.status };
}

/** Server-verified admin identity for the current session. */
export async function fetchAdminIdentity(): Promise<AdminIdentity> {
  const { body, requestId, status } = await request("/api/admin/me", undefined, "admin.identity");
  if (!isIdentity(body))
    throw new AdminApiError(500, UNEXPECTED_RESPONSE, requestId, "admin.identity", status);
  return body;
}

/** Exact-email lookup; personal data stays out of URL logs. */
export async function searchUserByEmail(email: string): Promise<AdminUser | null> {
  const { body, requestId, status } = await request(
    "/api/admin/users/search",
    { method: "POST", body: JSON.stringify({ email }) },
    "admin.user-search",
  );
  if (!isRecord(body) || !("user" in body))
    throw new AdminApiError(500, UNEXPECTED_RESPONSE, requestId, "admin.user-search", status);
  const user = body.user;
  if (user === null) return null;
  if (!isAdminUser(user))
    throw new AdminApiError(500, UNEXPECTED_RESPONSE, requestId, "admin.user-search", status);
  return user;
}

export async function updateUserRole(id: string, role: AdminRole): Promise<void> {
  const { body, requestId, status } = await request(
    `/api/admin/users/${encodeURIComponent(id)}/role`,
    { method: "PATCH", body: JSON.stringify({ role }) },
    "admin.user-role",
  );
  if (!isRecord(body) || body.ok !== true)
    throw new AdminApiError(500, UNEXPECTED_RESPONSE, requestId, "admin.user-role", status);
}

/** One-time access bootstrap; the server sets the standard Better Auth cookie. */
export async function adminOtaLogin(token: string): Promise<void> {
  await request(
    "/api/auth/admin-ota-login",
    { method: "POST", body: JSON.stringify({ token }) },
    "admin.ota-login",
  );
}

export function adminErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";
}
