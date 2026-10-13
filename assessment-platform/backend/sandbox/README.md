# Dedicated Linux sandbox node

This is backend infrastructure, not a fourth application. Student code executes only in
mandatory gVisor `runsc` containers. Windows development does not provide this runtime.
Execution stays disabled until the [real judge gate](../../docs/judge-test-gate.md) passes.

Use a dedicated Linux host with Docker, cgroups v2, Node 24, pnpm and a reviewed gVisor binary.
Provision the broker with its own mTLS server certificate, CA, allowlisted client certificate
SHA-256 fingerprints, reviewed binary hash and content-addressed toolchain catalog. It needs
Docker control permission, which is root-equivalent; keep this identity off API/database nodes.
The broker has no database, Redis or testcase keys. Deny public ingress and restrict its private
port to judge identities. Client certificates must have clientAuth, the server certificate
serverAuth and a SAN matching SANDBOX_BROKER_URL. TLS 1.3 and CA/hostname verification are required.

Merge a `runsc` runtime entry into the existing Docker configuration without replacing it:

```json
{
  "runtimes": { "runsc": { "path": "/usr/local/bin/runsc", "runtimeArgs": ["--platform=systrap"] } }
}
```

Follow the [official installation](https://gvisor.dev/docs/user_guide/install/) and
[Docker integration](https://gvisor.dev/docs/user_guide/quick_start/docker/) instructions.
Do not install a floating `latest` binary for production; review a release, verify its published
checksum, record its SHA-256 and test that exact binary. The broker verifies the binary and
Docker runtime path before serving requests; it has no runc fallback.

From repository root on the Linux node:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @assessment/backend build
pnpm sandbox:build
cp backend/.env.sandbox.example backend/.env.sandbox.local
# Fill private certificate paths, fingerprints, runsc hash and catalog path.
pnpm sandbox:broker
```

Development key generation writes `backend/sandbox/secrets/keyring.local.json` exclusively.
Its active IDs are `development-public-v1`, `development-hidden-v1` and `development-diagnostics-v1`;
copy those IDs into the judge's corresponding `*_KMS_KEY_ID` settings. They are identifiers only,
not cloud KMS credentials. API deployments receive no keyring or broker secrets.

`sandbox:build` resolves official supported Python 3.13, JDK 21 and GCC 14 image families to
immutable base digests, builds UID 10001 images, records actual patch versions and local image
SHA-256 IDs in ignored `toolchains/catalog.local.json`. New IDs include the full image hash;
rebuilding appends new entries and retains historical image tags/IDs rather than rebinding a
published template. Do not prune images still referenced by active assessments. Review/scan the resulting images and
commit their approved metadata to your deployment system. Load those exact images and catalog
on each broker; no request pulls an image. `catalog.example.json` contains deliberate replacement
placeholders and cannot start a worker. Toolchain IDs and digests must match on judge and broker.

Compilation and each test use different containers. A trusted sleep container keeps a 64 MiB
tmpfs volume mounted. Source arrives as one fixed-name regular-file tar stream through Docker;
there is no host source staging, bind mount or shell interpolation. The complete compiler
container is removed before exposing the artifact. Tests mount the artifact read-only, receive
one input on stdin and never receive expected outputs. Cleanup removes holders and volumes;
180-second labels allow independent orphan collection after process death.

Install the reviewed templates in `infra/systemd/` after adjusting paths and creating the service
account. Enable both broker supervision and the independent reaper timer. Do not rely solely on
worker cleanup. The template Docker group is privileged on this dedicated node; operating-system
hardening does not reduce the Docker control API's authority. No socket is mounted into any
student container. Validate the unit files on the target host before enabling them.

Guest processes/threads have RLIMIT_NPROC (default 32, compile 64); the host cgroup allows 256
tasks for runsc/gofer overhead. Memory is a host-cgroup ceiling including sandbox overhead.
CPU accounting uses host-cgroup stats, one CPU quota, a 100 ms sampling watchdog and a separate
wall watchdog; scheduling/stat latency can overshoot the nominal CPU threshold. Missing stats
while running fail closed. Validate these profiles, JVM startup and fork limits on the actual
kernel/runtime rather than interpreting configuration flags as proof of enforcement.
