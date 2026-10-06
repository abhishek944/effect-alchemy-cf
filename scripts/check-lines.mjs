import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ignored = new Set([".git", ".alchemy", ".turbo", "node_modules", "dist", "var"]);
const generated = new Set(["pnpm-lock.yaml"]);
/** @type {string[]} */
const violations = [];

/** @param {string} directory */
function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || generated.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      check(path);
    } else if (entry.isFile()) {
      const content = readFileSync(path);
      if (content.includes(0)) continue;
      const lines = content.toString("utf8").replace(/\n$/, "").split("\n").length;
      if (lines > 200) violations.push(`${relative(".", path)}: ${lines} lines`);
    }
  }
}

check(".");
if (violations.length > 0) {
  process.stderr.write(`Files exceed 200 physical lines:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("All authored files are within 200 physical lines.\n");
}
