import { Effect } from "effect";
import { OfficeInvalid, safeFailure } from "@starter/office-contract";
import { runOfficeCommand, type ResolveOfficeCli } from "@starter/office-server/cli";

/** Standalone stdin/stdout composition. Host injects accepted-input proof/resources, never env credentials. */
export async function runOfficeCli(resolve: ResolveOfficeCli): Promise<void> {
  const input: AsyncIterable<unknown> = process.stdin;
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of input) {
    if (!(part instanceof Uint8Array)) throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    size += part.byteLength;
    if (size > 256 * 1024) throw new OfficeInvalid(safeFailure("LIMIT_EXCEEDED"));
    parts.push(part);
  }
  let command: unknown;
  try {
    command = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts, size)),
    );
  } catch {
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  }
  const result = await Effect.runPromise(runOfficeCommand(resolve, command));
  const bytes = Buffer.from(JSON.stringify(result));
  if (bytes.byteLength > 64 * 1024) throw new OfficeInvalid(safeFailure("LIMIT_EXCEEDED"));
  await new Promise<void>((resolveWrite, reject) =>
    process.stdout.write(bytes, (error) => (error ? reject(error) : resolveWrite())),
  );
}
