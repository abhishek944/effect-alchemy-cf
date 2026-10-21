export type NativeRoute = {
  readonly method: string;
  readonly template: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
};
const base = "/universer-api";
const snapshot = [
  "snapshot/:type/unit/:unitID/rev/:revision",
  "snapshot/:type/unit/:unitID/block/:blockID",
  "snapshot/block/:type/unit/:unitID/block/:blockID",
  "snapshot/:type/unit/:unitID/fetchmissing",
];
/** Observed from actual public 1.0.3 endpoint.register; not a blanket /universer-api proxy. */
export const nativeRegistrations = new Set([
  `GET ${base}/user/session-ticket`,
  ...snapshot.flatMap((path) => [
    `GET ${base}/${path}`,
    `GET ${base}/worktrees/:worktreeID/${path}`,
  ]),
  `POST ${base}/comb/:type/unit/:unitID/new_changes`,
  `POST ${base}/worktrees/:worktreeID/comb/:type/unit/:unitID/new_changes`,
  `UPGRADE ${base}/comb/connect`,
  `UPGRADE ${base}/worktrees/:worktreeID/comb/connect`,
  `UPGRADE ${base}/worktrees/:worktreeID/events`,
]);
const view = "/api/office/views/:viewID/protocol";
export const scopedRegistrations = new Set([
  `POST ${view}/authz/-/object/-/batch_allowed`,
  `GET ${view}/images/:fileID/sign-url`,
  `POST ${view}/images/upload`,
  ...snapshot.map((path) => `GET ${view}/${path}`),
]);
const nativeId = /^[A-Za-z0-9_-]{1,256}$/;
const integer = /^(-1|0|[1-9][0-9]{0,15})$/;
function match(path: string, template: string): Readonly<Record<string, string>> | null {
  const parts = path.split("/"),
    pattern = template.split("/");
  if (parts.length !== pattern.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index++) {
    const value = parts[index],
      rule = pattern[index];
    if (value === undefined || rule === undefined) return null;
    if (!rule.startsWith(":")) {
      if (value !== rule) return null;
      continue;
    }
    const name = rule.slice(1);
    if (name === "type") {
      if (!["1", "2", "3"].includes(value)) return null;
    } else if (name === "revision") {
      if (!integer.test(value) || !Number.isSafeInteger(Number(value))) return null;
    } else if (!nativeId.test(value)) return null;
    params[name] = value;
  }
  return params;
}
export function classifyNativeRoute(method: string, raw: string): NativeRoute | null {
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    raw.includes("#") ||
    raw.length > 4096 ||
    /%|\/\.|\/\//.test(raw)
  )
    return null;
  const url = new URL(raw, "http://native.invalid");
  for (const entry of [...nativeRegistrations, ...scopedRegistrations]) {
    const separator = entry.indexOf(" ");
    if (entry.slice(0, separator) !== method) continue;
    const template = entry.slice(separator + 1),
      params = match(url.pathname, template);
    if (params === null) continue;
    const allowed = template.endsWith("session-ticket")
      ? ["channelId"]
      : template.endsWith("fetchmissing")
        ? ["from", "to"]
        : method === "UPGRADE"
          ? ["sessionTicket"]
          : template.endsWith("images/upload")
            ? ["size", "source", "assign"]
            : [];
    if (
      [...url.searchParams.keys()].some(
        (key) => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1,
      )
    )
      return null;
    return { method, template, params, query: url.searchParams };
  }
  return null;
}
