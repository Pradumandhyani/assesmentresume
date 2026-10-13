# Process separation

Step 4 adds runnable `judge/main.ts`, `outbox/main.ts`, `sandbox/broker.ts` and independent
`sandbox/reaper.ts`. These are separate processes built from this backend package. No API
process starts a judge or receives its testcase keys. See [Step 4](../../../docs/step-4.md),
[sandbox setup](../../sandbox/README.md) and the [Linux gate](../../../docs/judge-test-gate.md).
