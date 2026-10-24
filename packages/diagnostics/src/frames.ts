// A foreign stack may contain document names. Only these fixed application identities may leave memory.
const sources = [
  ...["index", "classification", "context", "causes"].map(
    (name) => `packages/diagnostics/src/${name}.ts`,
  ),
  ...[
    "worker",
    "observability",
    "authentication",
    "office-authentication",
    "auth-failure",
    "office-job-process",
    "office-job-object",
    "office-job-http",
    "office-job-streams",
    "office-job-termination",
    "office-private-jobs",
    "office-container-lifetime",
    "office-host-process",
    "office-host-fetch",
    "office-host-object",
    "office-invocations",
    "office-task-callback",
    "office-task-issuance",
    "office-private-stream",
    "office-private-authority",
    "chat-runtime",
    "chat-source",
    "chat-submission",
    "chat-conversation-do",
    "chat-catalog-do",
    "chat-bindings",
    "chat-sse",
    "chat-http-events",
    "chat-media-http",
    "chat-http-read",
    "chat-send-http",
    "chat-file-io-objects",
    "chat-file-io-body",
    "chat-files-store",
    "chat-skills-store",
    "chat-skills-defect",
    "chat-title",
    "chat-accounting",
    "billing-sync",
    "billing-checkout",
    "billing-config",
    "billing-ingress",
  ].map((name) => `apps/api/src/${name}.ts`),
  ...["worker", "native-bootstrap", "native-job-anchor", "native-main", "native-client"].map(
    (name) => `apps/office/src/${name}.ts`,
  ),
  ...["worker", "placement", "exchange", "run", "supervisor"].map(
    (name) => `packages/office-server/src/jobs/${name}.ts`,
  ),
  ...["auth", "billing-store", "billing-data", "billing-lease", "billing-writes"].map(
    (name) => `packages/auth/src/${name}.ts`,
  ),
  ...["http", "billing-dodo-client", "billing-polar-client", "slack-api", "cloudflare-email"].map(
    (name) => `packages/integrations/src/${name}.ts`,
  ),
];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const source = `(?:${sources.map(escape).join("|")})`;
const entries = "(?:native-bootstrap|native-job-anchor|worker|server|office)\\.mjs";
export const DIAGNOSTIC_FRAME_PATTERN = new RegExp(
  `^(?:${source}|office-bundle/${entries}):[0-9]{1,6}:[0-9]{1,6}$`,
);
const sourceFrame = new RegExp(`\\b(${source}):([0-9]{1,6}):([0-9]{1,6})\\b`);
const bundleFrame = new RegExp(
  `/opt/office/dependencies/packages/office-server/(${entries}):([0-9]{1,6}):([0-9]{1,6})\\b`,
);
/** Skip message text; only actual frame lines and fixed known source identities are projected. */
export function diagnosticFrames(stack: unknown): string[] {
  if (typeof stack !== "string") return [];
  const frames: string[] = [];
  for (const line of stack.slice(0, 16384).split("\n").slice(1, 41)) {
    if (!/^\s*at\s/.test(line)) continue;
    const sourceMatch = sourceFrame.exec(line);
    const bundleMatch = bundleFrame.exec(line);
    if (sourceMatch) frames.push(`${sourceMatch[1]}:${sourceMatch[2]}:${sourceMatch[3]}`);
    else if (bundleMatch)
      frames.push(`office-bundle/${bundleMatch[1]}:${bundleMatch[2]}:${bundleMatch[3]}`);
    if (frames.length === 3) break;
  }
  return frames;
}
