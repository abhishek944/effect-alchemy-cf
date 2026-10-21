import { MANAGED_LABEL, OWNER_LABEL, type DockerClient } from "./docker-client.ts";
import { DockerExecutorError } from "./types.ts";

/** Fail closed instead of accepting Docker's warning-only resource-limit degradation. */
export async function verifyDockerSupport(client: DockerClient): Promise<void> {
  const info = await client.call([
    "info",
    "--format",
    "{{.OSType}} {{.MemoryLimit}} {{.SwapLimit}} {{.CPUCfsQuota}} {{.PidsLimit}} {{json .SecurityOptions}}",
  ]);
  if (
    info.code !== 0 ||
    !info.stdout.startsWith("linux true true true true ") ||
    !info.stdout.includes('"name=seccomp,profile=builtin"')
  )
    throw new DockerExecutorError({
      code: "INVALID_CONFIG",
      message:
        "Executor requires Linux Docker with memory/swap/CPU/PID limits and builtin seccomp.",
    });
}

/** Fixed job argv: neither input bytes nor a caller can select host capabilities. */
export function createArguments(client: DockerClient, name: string): string[] {
  const {
    config: { imageId, owner, limits: l },
  } = client;
  return [
    "container",
    "create",
    "--pull=never",
    "--interactive",
    "--init",
    "--name",
    name,
    "--label",
    `${MANAGED_LABEL}=1`,
    "--label",
    `${OWNER_LABEL}=${owner}`,
    "--network=none",
    "--ipc=private",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=65532:65532",
    `--pids-limit=${l.pids}`,
    `--cpus=${l.cpus}`,
    `--memory=${l.memoryMiB}m`,
    `--memory-swap=${l.memoryMiB}m`,
    "--ulimit",
    `nofile=${l.fileDescriptors}:${l.fileDescriptors}`,
    "--ulimit",
    "core=0:0",
    "--log-driver=none",
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,nodev,size=${l.tmpfsMiB}m,mode=1777`,
    "--tmpfs",
    `/task:rw,noexec,nosuid,nodev,size=${l.tmpfsMiB}m,uid=65532,gid=65532,mode=700`,
    "--workdir=/task",
    "--env=HOME=/task",
    "--env=TMPDIR=/tmp",
    "--env=PATH=/usr/local/bin:/usr/bin:/bin",
    imageId,
  ];
}
