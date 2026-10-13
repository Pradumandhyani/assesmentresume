# Execution security design

## Isolation boundary

Step 4 implements the dedicated gVisor broker and worker; actual runtime verification remains a
separate [Linux release gate](judge-test-gate.md). The API cannot import/start a worker or use an
unrestricted `child_process` runner. Judge workers
are trusted orchestrators on dedicated nodes, separated from the API and identity database roles.
They request executions from an internal mTLS sandbox broker using pinned toolchain image digests.
Never expose the broker, Redis, PostgreSQL or Docker/Kubernetes management interface to browsers.

Initial deployment option: gVisor-backed ephemeral OCI sandboxes on dedicated Linux nodes with
seccomp, namespaces and cgroups v2. Firecracker microVMs are an alternative for stronger VM
isolation when operations can support KVM/jailer orchestration. Benchmark compatibility and
security for Python, Java and C++. Ordinary Docker containers alone are not the selected isolation
boundary. The development Compose stack provisions only infrastructure and a reverse proxy;
it provides no judge and must not be interpreted as a secure code runner.

## Compile and run separately

Use allowlisted Python, Java and C++ toolchains referenced by immutable `QuestionTemplate.toolchainId`.
The deployment toolchain catalog pins image SHA-256 digest, compiler/interpreter version,
fixed entrypoint/file name, flags, language-specific resource profile and revision. It is managed
server-side; clients supply only a language and source. Missing/unapproved toolchains fail closed.
Do not concatenate source, arguments or user paths into shell commands.

Compilation runs inside its own sandbox with no hidden inputs. Fixed files such as `main.py`,
`Main.java`, `main.cpp` are written by the broker into a fresh bounded workspace. Validate UTF-8
and 64 KiB source size before queueing. Disallow user-provided package installation, flags,
filenames, archives, symlinks and working directories. Java class naming and C++ standard policy
are fixed by the template; no dynamic dependency resolution or network access.

Run each test in a fresh sandbox/process namespace. Mount only the compiled artifact and minimal
read-only runtime. Provide one case's input through stdin, never mount all cases or expected
outputs. Compare output in the trusted judge after execution. The sandbox sees no database/Redis/
KMS credentials, control-plane sockets, host paths, cloud metadata or other student's files.

## Resource and syscall policy

Require nonroot UID/GID, read-only root FS, isolated quota-limited tmpfs workspace, no capabilities,
no-new-privileges, restrictive seccomp, pid limits, CPU quotas, memory limits, file count/size limits,
output byte limits and a trusted wall-clock watchdog. Disable network completely, including DNS,
loopback access to the host, cloud metadata and IPv6 routes. Kill the entire cgroup/microVM at
termination or timeout; clean artifacts and destroy the sandbox, including after worker death.
Never mount the host Docker socket. The broker itself requires narrowly scoped node-control access.

Initial ceilings: source 64 KiB, compile wall time 30 s, compile memory 1 GiB, at most 64 processes,
workspace 64 MiB, run wall time at most 30 s, CPU time at most 10 s per case, run memory at most
1 GiB, stdout at most 64 KiB and stderr at most 4 KiB when returned for a public run. Published
versions may choose stricter limits. Apply both per-case and total job budgets (initially 120 s)
so 100-case questions cannot monopolize workers. JVM heap/metaspace/stack/process profiles must
fit cgroup limits; language multipliers are server-owned catalog policy, not browser settings.
Resource policy requires actual tests under the chosen runtime before enabling a toolchain.

## Hidden test confidentiality

`TestCase` stores **AEAD envelope ciphertext** for inputs and expected outputs plus a key ID and
integrity digest; no plaintext ORM fields exist. The key is held in a secret manager/KMS, not the
database, examples, Git or browser. Judge decrypts only the selected version's cases under an
audited service identity. The API SQL role cannot SELECT the test table; a filtered view exposes
public case envelopes only. Administrative uploads encrypt before persistence and return counts,
not payloads. Admin write privileges use a separate connection identity.

Encryption keys are separated by data class: public cases, hidden cases and internal diagnostics.
The API service may decrypt public examples only. Bind AEAD associated data to question version,
case ordinal and data field. Key rotation rewraps KMS-managed data keys by stable key ID outside
immutable question content; do not modify published ciphertext rows or hashes to rotate keys.
DB row restrictions and key permissions work together; ciphertext alone is not authorization.

The current provider reads a private workload-provisioned keyring, rather than calling a cloud
KMS API. It enforces distinct key material per data class, authenticates ciphertext and validates
active key IDs. API repositories never fetch diagnostic ciphertext and have no testcase keys.
The optional DBA-reviewed runtime grants and native role checks remain deployment requirements.

Submission output can print or encode hidden stdin. Consequently **never return hidden stdout,
stderr, expected/actual output, case identifiers, failing ordinal, per-case timings or internal
compiler/runtime diagnostics** through any browser endpoint, log or observable storage URL.
Only public-case execution output may be returned, bounded and rendered as plain text.
Opaque internal artifacts are access controlled, encrypted and retained for a short audited period.

For SUBMIT/FINAL, hide execution verdict/results until assessment result release; interactive
hidden-test verdict or score feedback creates an adaptive oracle even without raw outputs.
Before release, show queue/processing state only and `result: null`. After release expose aggregate
verdict/score through approved DTOs; hidden diagnostics remain withheld. Public runs execute only
public examples. Limit requests to constrain probing and resource abuse. Fairness/rate limiting
does not replace confidentiality or isolation.

## Security acceptance before execution can ship

Verify sandbox escape attempts, network/metadata denial, fork/thread bombs, infinite loops, output
floods, memory exhaustion, filesystem/path/symlink attacks, malicious compilation directives,
cross-job residue, broker authorization, cancellation and orphan cleanup. Test source/expected
output leakage in every response, error, trace and object artifact. Patch/pin runtime and toolchain
images, inventory dependencies and monitor escapes/termination reasons. Restore testing and
independent security review are release gates; this Windows workspace has not run the real judge
suite. See [implemented profiles and node setup](../backend/sandbox/README.md).

Isolation choices follow the [gVisor security model](https://gvisor.dev/docs/architecture_guide/security/)
and [Firecracker architecture](https://firecracker-microvm.github.io/).
