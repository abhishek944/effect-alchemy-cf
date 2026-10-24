/** Finite route names only: never emit a raw path, query or user-provided segment. */
export function requestRoute(url: string): string {
  const path = url.split("?")[0] ?? "";
  if (path === "/api/health") return "health";
  if (path === "/api/me") return "account.me";
  if (path.startsWith("/api/auth/")) {
    const routes: Readonly<Record<string, string>> = {
      "/api/auth/sign-in/email": "auth.sign-in",
      "/api/auth/sign-up/email": "auth.sign-up",
      "/api/auth/sign-out": "auth.sign-out",
      "/api/auth/get-session": "auth.session",
      "/api/auth/admin-ota-login": "auth.admin-ota",
    };
    return routes[path] ?? "auth.other";
  }
  if (path.startsWith("/api/billing/webhooks/")) return "billing.webhook";
  if (path.startsWith("/api/admin/billing")) return "admin.billing";
  if (path.startsWith("/api/admin/")) return "admin.operation";
  if (path.startsWith("/api/billing")) {
    if (path.endsWith("/checkout")) return "billing.checkout";
    if (path.endsWith("/portal")) return "billing.portal";
    if (path.endsWith("/refresh")) return "billing.refresh";
    return "billing.read";
  }
  if (path.startsWith("/api/office/")) {
    if (path.includes("/protocol/")) return "office.protocol";
    if (path.includes("/operations/")) return "office.operation";
    if (path.startsWith("/api/office/originals/")) return "office.original";
    if (path.includes("/uploads")) return "office.upload";
    if (path.includes("/views")) return "office.view";
    if (path.includes("/drafts")) return "office.draft";
    if (path.includes("/documents")) return "office.document";
    return "office.control";
  }
  if (path.startsWith("/universer-api")) return "office.native-protocol";
  if (path === "/api/chat/capabilities") return "chat.capabilities";
  if (path === "/api/chat/preferences") return "chat.account-preferences";
  if (path.startsWith("/api/chats")) {
    if (path.endsWith("/events")) return "chat.events";
    if (path.endsWith("/messages")) return "chat.send";
    if (path.endsWith("/stop")) return "chat.stop";
    if (path.includes("/files") || path.includes("/attachments")) return "chat.files";
    if (path.includes("/images")) return "chat.images";
    if (path.includes("/speech")) return "chat.speech";
    if (path.includes("/skills")) return "chat.skills";
    if (path.includes("/usage")) return "chat.usage";
    return "chat.metadata";
  }
  if (path.startsWith("/api/profile")) return "account.profile";
  if (path.startsWith("/api/theme")) return "account.theme";
  if (path.startsWith("/api/skills")) return "skills.library";
  return path.startsWith("/api/") ? "api.other" : "assets";
}
