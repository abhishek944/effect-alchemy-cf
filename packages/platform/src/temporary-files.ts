import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

/** Private scratch space for SDKs whose public API requires files; never durable storage. */
export const withTemporaryFiles = async <T>(
  run: (files: {
    directory: string;
    input: (index: number, bytes: Uint8Array) => Promise<string>;
    output: (path: string) => Promise<Uint8Array>;
  }) => Promise<T>,
): Promise<T> => {
  const directory = await mkdtemp(join(tmpdir(), "highchat-image-"));
  try {
    return await run({
      directory,
      async input(index, bytes) {
        const path = join(directory, `input-${index}`);
        await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
        return path;
      },
      async output(path) {
        const local = relative(directory, path);
        if (!local || local.startsWith("..") || isAbsolute(local))
          throw new Error("SDK output is outside its temporary directory");
        return readFile(path);
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
