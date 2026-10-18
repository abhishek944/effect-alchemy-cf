import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const [emailArg, file] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
if (
  process.argv.length !== 4 ||
  !email ||
  !file ||
  email.length > 254 ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
) {
  throw new Error("Usage: node scripts/admin-ota.mjs <existing-account-email> <new-sql-file>");
}
const token = randomBytes(32).toString("hex");
const hash = createHash("sha256").update(token).digest("hex");
const createdAt = new Date();
const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
/** @param {string} text */
const quote = (text) => `'${text.replaceAll("'", "''")}'`;
const sql = [
  "-- Review the stage/database before applying. This grants admin access when redeemed.",
  "-- Inserts nothing if the account does not exist; confirm exactly one row is returned.",
  'INSERT INTO "verification" ("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt")',
  `SELECT ${quote(randomUUID())}, ${quote(`admin-ota:${hash}`)}, "id",`,
  `  ${quote(expiresAt.toISOString())}, ${quote(createdAt.toISOString())}, ${quote(createdAt.toISOString())}`,
  `FROM "user" WHERE "email" = ${quote(email)}`,
  'RETURNING "id";',
  "",
].join("\n");
// The file contains only the token hash. Never persist the plaintext bearer credential.
writeFileSync(file, sql, { flag: "wx", mode: 0o600 });
process.stdout.write(`SQL written to ${file}; no database was changed.\n`);
process.stdout.write(`One-time access token (keep private): ${token}\n`);
process.stdout.write(`Expires: ${expiresAt.toISOString()}\n`);
