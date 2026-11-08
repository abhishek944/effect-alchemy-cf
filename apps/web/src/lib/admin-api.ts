import { ApiError, apiErrorFromResponse, errorMessageOf, networkError } from "@/lib/api-error";

export { ApiError as AdminApiError } from "@/lib/api-error";

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

const UNEXPECTED_RESPONSE = "Unable to complete your request. Please try again.";

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
    throw networkError(operation);
  }
  const requestId = response.headers.get("x-request-id");
  if (!response.ok) throw await apiErrorFromResponse(response, operation);
  if (response.status === 204) return { body: null, requestId, status: response.status };
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new ApiError({
      tag: null,
      status: 502,
      message: UNEXPECTED_RESPONSE,
      requestId,
      operation,
      responseStatus: response.status,
    });
  }
  return { body, requestId, status: response.status };
}

/** Server-verified admin identity for the current session. */
export async function fetchAdminIdentity(): Promise<AdminIdentity> {
  const { body, requestId, status } = await request("/api/admin/me", undefined, "admin.identity");
  if (!isIdentity(body)) throw unexpected(requestId, "admin.identity", status);
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
    throw unexpected(requestId, "admin.user-search", status);
  const user = body.user;
  if (user === null) return null;
  if (!isAdminUser(user)) throw unexpected(requestId, "admin.user-search", status);
  return user;
}

export async function updateUserRole(id: string, role: AdminRole): Promise<void> {
  const { body, requestId, status } = await request(
    `/api/admin/users/${encodeURIComponent(id)}/role`,
    { method: "PATCH", body: JSON.stringify({ role }) },
    "admin.user-role",
  );
  if (!isRecord(body) || body.ok !== true) throw unexpected(requestId, "admin.user-role", status);
}

export function adminErrorMessage(error: unknown): string {
  return errorMessageOf(error);
}

const unexpected = (requestId: string | null, operation: string, status: number): ApiError =>
  new ApiError({
    tag: null,
    status: 500,
    message: UNEXPECTED_RESPONSE,
    requestId,
    operation,
    responseStatus: status,
  });
