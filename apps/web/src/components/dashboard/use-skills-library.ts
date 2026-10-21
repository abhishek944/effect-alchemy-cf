/**
 * Remote library state for the Skills settings surface: the authoritative
 * list, one download at a time and honest read failures. This hook owns the
 * only list read/write path (request epoch + abort), including the refresh
 * launched after a known-published upload, so no late snapshot can overwrite a
 * newer list. Attempt queue state lives in useSkillUploads.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { downloadSkill, listSkills, skillsErrorMessage } from "@/lib/skills-api";
import { readSkillAttempts } from "@/lib/skills-attempt";
import { saveSkillDownload } from "@/lib/skills-file";
import type { SkillFile } from "@/lib/skills-types";
import {
  LOADING,
  type SkillDownloadFailure,
  type SkillListReadOutcome,
  type SkillNotice,
  type SkillNoticeRun,
  type SkillsLibrary,
  type SkillsPhase,
} from "./skills-library-model";
import useSkillUploads from "./use-skill-uploads";

export default function useSkillsLibrary(userId: string): SkillsLibrary {
  const [phase, setPhase] = useState<SkillsPhase>("loading");
  const [files, setFiles] = useState<readonly SkillFile[]>([]);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<string | null>(LOADING);
  const [notice, setNotice] = useState<SkillNotice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [downloadVersion, setDownloadVersion] = useState<string | null>(null);
  const [downloadFailure, setDownloadFailure] = useState<SkillDownloadFailure | null>(null);
  const [listStale, setListStale] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const read = useCallback(
    async (
      uploadId: string | undefined,
      mode: "load" | "check" | "quiet" | "refresh",
    ): Promise<SkillListReadOutcome> => {
      // A known publication makes the visible list stale until a GET writes it.
      if (mode === "refresh") setListStale(true);
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const list = await listSkills(uploadId, controller.signal);
        if (controller.signal.aborted || requestRef.current !== controller) {
          return { kind: "superseded" };
        }
        setFiles(list.files);
        setListStale(false);
        setPhase("ready");
        setLoadError("");
        setStatus((current) => (current === LOADING ? null : current));
        if (uploadId === undefined) return { kind: "applied" };
        const receipt = list.receipt;
        if (receipt === null || receipt.uploadId !== uploadId) {
          if (mode === "load" || mode === "check") {
            setNotice({
              title: "Could not confirm that upload.",
              message: "Check skills again.",
              action: "check",
            });
          }
          return { kind: "invalid" };
        }
        return { kind: "receipt", receipt };
      } catch (cause) {
        if (controller.signal.aborted || requestRef.current !== controller) {
          return { kind: "superseded" };
        }
        const message = skillsErrorMessage(cause);
        if (mode === "load") {
          setLoadError(message);
          setPhase("error");
          setStatus(null);
        } else if (mode === "check") {
          setNotice({ title: "Could not check that upload.", message, action: "check" });
        }
        return { kind: "failed", message };
      }
    },
    [],
  );

  useEffect(() => () => requestRef.current?.abort(), []);

  const upload = useSkillUploads({
    userId,
    files,
    read,
    setBusy,
    setNotice,
    setStatus,
  });

  function reload() {
    setNotice(null);
    setPhase("loading");
    setStatus(LOADING);
    const oldest = readSkillAttempts(userId)[0];
    void (async () => {
      const outcome = await read(oldest?.uploadId, "load");
      if (outcome.kind === "receipt" && oldest !== undefined) {
        upload.settle(oldest.uploadId, outcome.receipt);
      }
    })();
  }

  async function download(file: SkillFile) {
    setDownloadFailure(null);
    setDownloadVersion(file.version);
    try {
      saveSkillDownload(await downloadSkill(file), file.filename);
    } catch (cause) {
      setDownloadFailure({ file, message: skillsErrorMessage(cause) });
    } finally {
      setDownloadVersion(null);
    }
  }

  function runNotice(action: SkillNoticeRun) {
    if (action === "check") void upload.checkSkills();
    else if (action === "refresh") reload();
    else upload.startFresh();
  }

  const shownNotice = notice ?? upload.unsettledNotice;

  return {
    phase,
    files,
    loadError,
    status,
    notice: shownNotice,
    unsettled: notice === null ? upload.unsettled : null,
    listStale,
    conflict: upload.conflict,
    busy,
    downloadVersion,
    downloadFailure,
    reload,
    selectFile: upload.selectFile,
    confirmReplace: upload.confirmReplace,
    cancelReplace: upload.cancelReplace,
    checkSkills: upload.checkSkills,
    startFresh: upload.startFresh,
    cancelUpload: upload.cancelUpload,
    download,
    runNotice,
  };
}
