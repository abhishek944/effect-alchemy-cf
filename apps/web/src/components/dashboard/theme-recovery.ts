/**
 * Recovery read for a refused or uncertain theme write.
 *
 * The account is re-read so browser state matches the server. A refused write is
 * never reported as landed even when the authoritative theme happens to equal the
 * requested one; an uncertain outcome is confirmed only when an established
 * account preference satisfies the desired state. The rejected choice is preserved
 * only for an explicit Retry.
 */
import { errorMessage, getAccountTheme } from "@/lib/account-api";
import type { AttemptAccess, Retain } from "./theme-access";
import type { DashboardTheme } from "./theme-storage";

export const revalidateTheme = async (
  access: AttemptAccess,
  message: string,
  attempted: DashboardTheme,
  retain: Retain,
  /** A refused write is never reported as landed, even if the states coincide. */
  acceptedOutcome: "refused" | "uncertain",
): Promise<boolean> => {
  const token = access.begin("read");
  try {
    const view = await getAccountTheme();
    if (access.stale(token)) return false;
    access.adopt(view, token);
    const established = view.source === "account" || view.revision > 0;
    if (
      acceptedOutcome === "uncertain" &&
      established &&
      view.theme === attempted &&
      retain !== "none"
    ) {
      // Matching explicit account state confirms the preference, not request delivery.
      access.desired.current = null;
      access.migration.current = null;
      access.clearNote();
      return true;
    }
    if (retain === "desired") access.desired.current = attempted;
    access.fail(message);
    return false;
  } catch (cause) {
    if (!access.stale(token))
      access.fail(`${errorMessage(cause)} The saved theme could not be confirmed.`);
    return false;
  } finally {
    access.settled(token, "read");
  }
};
