import { ToolchainCatalog } from './toolchain-catalog';
import { DockerCliControl, GvisorSandboxEngine } from './docker-engine';
// Run from an independent systemd timer, including when the broker is stopped.
// Deletes only explicitly labelled, expired containers and volumes; no student process executes here.
async function main() {
  if (process.platform !== 'linux' || !process.env.SANDBOX_TOOLCHAIN_CATALOG)
    throw new Error('Dedicated Linux node configuration required');
  await new GvisorSandboxEngine(
    ToolchainCatalog.fromFile(process.env.SANDBOX_TOOLCHAIN_CATALOG),
    new DockerCliControl(),
  ).reap();
}
void main().catch(() => {
  console.error('Sandbox reaper failed; inspect node health without logging student data.');
  process.exitCode = 1;
});
