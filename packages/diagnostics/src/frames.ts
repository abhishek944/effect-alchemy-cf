// A foreign stack may contain document names. Only these fixed application identities may leave memory.
const sources = [
  ...["index", "classification", "context", "causes"].map(
    (name) => `packages/diagnostics/src/${name}.ts`,
  ),
  ...[
    "worker",
    "observability",
    "authentication",
    "auth-failure",
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
  ].map((name) => `apps/api/src/${name}.ts`),
  "packages/auth/src/auth.ts",
  ...["http", "slack-api", "cloudflare-email"].map(
    (name) => `packages/integrations/src/${name}.ts`,
  ),
];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const source = `(?:${sources.map(escape).join("|")})`;
export const DIAGNOSTIC_FRAME_PATTERN = new RegExp(`^${source}:[0-9]{1,6}:[0-9]{1,6}$`);
const sourceFrame = new RegExp(`\\b(${source}):([0-9]{1,6}):([0-9]{1,6})\\b`);
/** Skip message text; only actual frame lines and fixed known source identities are projected. */
export function diagnosticFrames(stack: unknown): string[] {
  if (typeof stack !== "string") return [];
  const frames: string[] = [];
  for (const line of stack.slice(0, 16384).split("\n").slice(1, 41)) {
    if (!/^\s*at\s/.test(line)) continue;
    const sourceMatch = sourceFrame.exec(line);
    if (sourceMatch) frames.push(`${sourceMatch[1]}:${sourceMatch[2]}:${sourceMatch[3]}`);
    if (frames.length === 3) break;
  }
  return frames;
}
