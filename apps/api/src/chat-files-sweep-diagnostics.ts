import { reportFailure } from "@starter/diagnostics";

/** One R2 copy/delete attempt; a rejected promise or explicit false both fail. */
export type FileAttempt = { readonly ok: boolean; readonly cause?: unknown };

export const awaitFileAttempt = async (run: () => Promise<boolean>): Promise<FileAttempt> => {
  try {
    return { ok: await run() };
  } catch (cause) {
    return { ok: false, cause };
  }
};

/**
 * Bounded sweep disposition. Copy origin failures are reported by the object
 * adapter; this owner reports only the deferred aggregate (no duplicate root).
 * Delete failures are owned here, so the first cause is retained.
 */
export const fileSweepDiagnostics = () => {
  let deleteCause: unknown;
  let deleteFailures = 0;
  let copyFailures = 0;
  return {
    deleteFailed(result: FileAttempt): boolean {
      if (result.ok) return false;
      deleteCause ??= result.cause;
      deleteFailures += 1;
      return true;
    },
    copyFailed(result: FileAttempt): boolean {
      if (result.ok) return false;
      copyFailures += 1;
      return true;
    },
    report(): void {
      if (deleteFailures > 0)
        reportFailure(deleteCause ?? new Error("File object delete was rejected"), {
          component: "chat-files",
          operation: "sweep",
          reason: "chat_files_delete_deferred",
          outcome: "unknown",
          event: "application.cleanup",
        });
      if (copyFailures > 0)
        reportFailure(new Error("File object copy was rejected"), {
          component: "chat-files",
          operation: "sweep",
          reason: "chat_files_copy_deferred",
          outcome: "unknown",
          event: "application.cleanup",
        });
    },
  };
};
