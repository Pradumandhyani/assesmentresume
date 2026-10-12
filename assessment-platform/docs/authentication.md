# Authentication and permissions design

Step 1 design, with student authentication implemented in Step 2. See [supported hash formats and runtime settings](step-2.md). Attempt and administration policies below remain future contracts.

## Existing identities

Only local question-bank assets exist in the inspected workspace; no users table definition,
credentials, migrations or configured live database were found. The schema's `User @@map("users")`
is **a new-install design**, not a claim about a production table. Before implementing login,
introspect the actual identity schema read-only and adapt field mappings, identifier type,
normalization and password verifier. See [database adoption](database.md).

Use existing credentials in deployed installations. There is no registration endpoint or active default admin. Development student provisioning requires explicit credentials; the assessment seed creates a disabled fixture-owner profile.
`Student` and `Admin` profiles reference `User` using unique foreign keys; one effective role
per identity is the initial policy. Role/profile consistency must be enforced transactionally
and validated during adoption. Disabled accounts and incremented `authVersion` invalidate sessions.
Admin privileges come from approved provisioning, never a browser-submitted role or profile ID.

New password hashes use **Argon2id**, with an initial budget of 64 MiB, time cost 3, parallelism 1
and unique library-generated salts. Benchmark parameters on production hardware. Bound concurrent
hash verifications and enforce shared login rate limits to protect memory. Passwords are never
trimmed or normalized. Treat unknown identity and wrong password identically, including a dummy
hash verification, and omit sensitive values from validation errors.

Recognize existing documented hash formats and verify without changing them. Rehash to Argon2id
only after successful verification using a compare-and-swap against the old hash. Do not rewrite,
reset, export or assume a format for existing passwords. Unsupported formats require an approved
identity integration or credential migration before login can ship.

## Session lifecycle

On successful credential verification, generate at least 256 bits of cryptographically random
session material, rotate any prior session and store only its SHA-256 digest in `AuthSession`.
The opaque browser cookie is `__Host-assessment_session` in production: `Secure`, `HttpOnly`,
`SameSite=Lax`, `Path=/`, **no Domain**. Ordinary sign-in has no `Max-Age` and expires after 12 hours in PostgreSQL; remembered sign-in uses a bounded persistent cookie (seven days by default).
Use `assessment_session_dev` without Secure only for local HTTP; production environment validation
rejects that combination. Never expose tokens in JSON, localStorage, URLs, logs or query keys.

Each request validates token digest, expiry, revocation, active user and `authVersion`, then obtains
the role and profile IDs on the server. PostgreSQL is authoritative. Redis is an optional bounded
cache with revocation invalidation; fail closed on uncertain validity. Logout durably revokes the
session and expires the exact cookie. Sessions outlive the three-hour exam; refreshing an exam
does not create a new attempt or restart a deadline. Session expiry requires reauthentication and
then resuming the existing server attempt, without compensating time automatically.

## CSRF, origins and browser topology

Both browser apps use credentialed same-origin `/api/v1` requests through the gateway. Student and
admin hostnames can have separate host-scoped session cookies. CORS allows only exact configured
origins with credentials, never `*`. No endpoint trusts CORS as authorization.

`GET /auth/csrf` issues a session-bound synchronizer token. For login, issue a short-lived signed
pre-authentication nonce cookie and a matching token; provision the signing key in the secret
manager before auth implementation. All unsafe methods, including login/logout, require the
`X-CSRF-Token` header, exact allowed `Origin` and JSON content type. Validate token binding and
expiry, reject absent/invalid origins and rotate CSRF material with sessions. `SameSite` alone is
insufficient. Fetch metadata can provide additional defense. Authentication and CSRF guards are
implemented for student authentication in Step 2; reserved exam/admin features remain unwired.

The centralized Step 2 exception filter emits `ApiError`; authentication
failures do not reveal whether the identifier exists. Set `Cache-Control: private, no-store` on
session and exam responses; disable CDN/Next.js data caching for these requests. Admin markdown
and question content require sanitization and a production CSP.

## Permission matrix

| Operation                                                           | Public            | Student                            | Admin                            |
| ------------------------------------------------------------------- | ----------------- | ---------------------------------- | -------------------------------- |
| Get CSRF / submit existing credentials                              | Yes, rate limited | Yes                                | Yes                              |
| Read/revoke own session                                             | No                | Own                                | Own                              |
| Profile, assigned schedules                                         | No                | Own only                           | Through admin routes             |
| Start/resume attempt, read question                                 | No                | Own assigned attempt only          | No impersonation route           |
| Draft, language, run, submit, finalize                              | No                | Own active attempt before deadline | No student-write bypass          |
| Read released results                                               | No                | Own only                           | Managed assessment summaries     |
| Questions, version publication, schedule, assignments, cancellation | No                | No                                 | Yes, audited                     |
| Audit log                                                           | No                | No                                 | Redacted metadata only           |
| Hidden case plaintext / expected output retrieval                   | No                | No                                 | No browser endpoint              |
| Judge/broker interface                                              | No                | No                                 | Internal service identities only |

An admin may author hidden cases in an input-only upload. Responses never echo those inputs or
expected outputs, including error details. All test retrieval responses are restricted to public
examples or redacted counts. Bind student ID to the session; do not accept ownership from a body.
For nested routes verify every parent relationship, not just a globally valid UUID. Return 404
for another student's resource; 403 for a denied role. Admin mutations require durable audit writes.

Worker identities use mTLS/least-privilege service credentials rather than student/admin cookies.
Production API, question-writing service, judge and migration roles have separate SQL credentials.
