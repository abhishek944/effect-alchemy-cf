const commands = new Set([
  "import",
  "status",
  "execute",
  "inspect",
  "export",
  "worktree",
  "operation",
  "--help",
  "-h",
  "list",
  "draft",
  "drafts",
  "open",
  "stage-code",
  "stage-file",
  "create",
  "create-draft",
  "import-into",
  "render",
  "ready",
  "reopen",
  "discard",
  "review",
]);
const selectors = new Set([
  "ready",
  "reopen",
  "create",
  "list",
  "workbook",
  "worksheet",
  "range",
  "document",
  "paragraphs",
  "presentation",
  "slides",
  "xlsx",
  "csv",
  "tsv",
  "docx",
  "txt",
  "pptx",
  "pdf",
]);

/** Never invoke getters or emit arbitrary argument text, even on schema rejection. */
const field = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
};
const sourceId = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,96}$/.test(value) ? value : undefined;
const state = (value: unknown) =>
  value === undefined ? "absent" : sourceId(value) === undefined ? "invalid" : "valid";

/** Safe Office argument summary only; no bodies, code, filenames, cursors or authority. */
export function toolArgumentFields(raw: unknown) {
  try {
    const attachment = field(raw, "attachmentId");
    const reference = field(raw, "referenceId");
    const worktree = field(raw, "worktreeId");
    const commandInput = field(raw, "command");
    const count = Array.isArray(commandInput) ? field(commandInput, "length") : undefined;
    const argv =
      typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 32
        ? Array.from({ length: count }, (_, index) => field(commandInput, String(index)))
        : [];
    const validArgv =
      typeof count === "number" &&
      count <= 32 &&
      argv.every((arg): arg is string => typeof arg === "string" && arg.length <= 32_768);
    const args = validArgv ? argv.filter((arg) => arg !== "--json") : [];
    const command = typeof args[0] === "string" && commands.has(args[0]) ? args[0] : undefined;
    const selector =
      ["worktree", "inspect", "export"].includes(command ?? "") &&
      typeof args[1] === "string" &&
      selectors.has(args[1])
        ? args[1]
        : undefined;
    return {
      attachment_id: sourceId(attachment),
      attachment_id_state: state(attachment),
      worktree_id: sourceId(worktree),
      worktree_id_state: state(worktree),
      reference_id: sourceId(reference),
      reference_id_state: state(reference),
      command: command ?? (commandInput === undefined ? "absent" : "unclassified"),
      selector,
      argument_count: typeof count === "number" ? Math.min(count, 33) : undefined,
      argument_chars: validArgv ? argv.reduce((sum, arg) => sum + arg.length, 0) : undefined,
      cursor_present: field(raw, "cursor") !== undefined,
    };
  } catch {
    return { projection_failed: true };
  }
}
