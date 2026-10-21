/** Fixed PID1 idle entry for a FRESH no-egress job box, never the document host.
 * Independent absolute-deadline guard; Worker still owns destroy and every physical IO join.
 */
const raw = process.env["OFFICE_JOB_DEADLINE"];
if (raw === undefined || !/^[0-9]{1,16}$/.test(raw))
  throw new Error("Missing original job deadline");
const deadline = Number(raw);
const remaining = deadline - Date.now();
if (!Number.isSafeInteger(deadline) || remaining <= 0 || remaining > 120_000)
  throw new Error("Invalid original job deadline");
const expiry = setTimeout(() => process.exit(124), remaining);
process.once("SIGTERM", () => {
  clearTimeout(expiry);
  process.exit(0);
});
