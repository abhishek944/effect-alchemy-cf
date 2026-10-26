import { Command } from "commander";
import { InspectQuery, ExportOptions, decodeWireSync } from "@starter/office-contract";
import type { InspectQuery as Query, ExportOptions as Export } from "@starter/office-contract";

export type UniverAction =
  | { kind: "import" | "status" | "ready" | "reopen" }
  | { kind: "execute"; code: string }
  | { kind: "inspect"; query: Query; cursor: string | null }
  | { kind: "export"; options: Export }
  | { kind: "operation"; id: string }
  | { kind: "help"; text: string };

/** Application CLI over the shared server. argv is never passed to a shell or a local-file CLI. */
export async function parseUniverCommand(argv: readonly string[]): Promise<UniverAction> {
  let action: UniverAction | undefined;
  let output = "";
  const program = new Command("univer")
    .description("Operate the authorized attachment's saved native document and working draft")
    .option("--json", "structured output (always enabled by the AI tool)")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        output += text;
      },
      writeErr: () => {},
    });
  for (const kind of ["import", "status"] as const)
    program
      .command(kind)
      .description(
        kind === "import" ? "Import once or reuse the saved document" : "Read saved draft status",
      )
      .action(() => {
        action = { kind };
      });
  program
    .command("execute")
    .description("Execute Facade JavaScript in the attachment's draft")
    .requiredOption("-e, --code <source>", "bounded Facade JavaScript")
    .action((options: { code: string }) => {
      action = { kind: "execute", code: options.code };
    });
  program
    .command("inspect <target> [selectors...]")
    .description("Inspect workbook, worksheet, range, document, paragraphs, presentation or slides")
    .option("--worksheet <id>", "worksheet ID from workbook inspection")
    .option("--cursor <cursor>", "actual continuation cursor from a previous result")
    .action(
      (target: string, selectors: string[], options: { worksheet?: string; cursor?: string }) => {
        const query =
          target === "worksheet"
            ? { kind: target, worksheetId: options.worksheet }
            : target === "range"
              ? { kind: target, worksheetId: options.worksheet, range: selectors[0] }
              : target === "paragraphs" || target === "slides"
                ? { kind: target, ids: selectors }
                : { kind: target };
        if (
          (target === "range" && selectors.length !== 1) ||
          (!["range", "paragraphs", "slides"].includes(target) && selectors.length !== 0)
        )
          throw new Error("Invalid inspection selectors");
        action = {
          kind: "inspect",
          query: decodeWireSync(InspectQuery)(query),
          cursor: options.cursor ?? null,
        };
      },
    );
  program
    .command("export <format>")
    .description("Export the current draft through the native server")
    .option("--worksheet <id>", "worksheet ID for CSV/TSV")
    .action((format: string, options: { worksheet?: string }) => {
      const kind =
        format === "docx" || format === "txt" ? "doc" : format === "pptx" ? "slide" : "sheet";
      action = {
        kind: "export",
        options: decodeWireSync(ExportOptions)({
          kind,
          format,
          ...(options.worksheet ? { worksheetId: options.worksheet } : {}),
        }),
      };
    });
  const worktree = program
    .command("worktree")
    .description("Working draft lifecycle; never merge or approve");
  for (const kind of ["ready", "reopen"] as const)
    worktree.command(kind).action(() => {
      action = { kind };
    });
  program
    .command("operation <id>")
    .description("Observe the exact original operation; never rerun it")
    .action((id: string) => {
      action = { kind: "operation", id };
    });
  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "commander.helpDisplayed")
      return { kind: "help", text: output };
    throw error;
  }
  if (action === undefined) throw new Error("A Univer command is required; use --help");
  return action;
}
