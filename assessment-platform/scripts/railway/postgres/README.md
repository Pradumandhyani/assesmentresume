# Railway development PostgreSQL 17 with verified public TLS

This narrowly derived infrastructure image keeps the pinned official Railway
SSL17 image's entrypoint, volume locks and PostgreSQL lifecycle safeguards. Its
certificate hook adds the generated public TCP proxy hostname to the leaf SANs,
alongside `localhost` and the Railway private domain. It preserves its CA and
signing key across restarts, endpoint changes and server-leaf renewals. Expiring,
missing or invalid established CA material fails closed and requires recovery or
a planned trust rotation.

Deploy only to the newly authorized development service. Configure the TCP proxy
before its first deployment. Mount a dedicated persistent volume at
`/var/lib/postgresql/data`, set `PGDATA=/var/lib/postgresql/data/pgdata`, and retain
the Railway-provided `RAILWAY_TCP_PROXY_DOMAIN` and `RAILWAY_PRIVATE_DOMAIN`.
Provide private `POSTGRES_USER`/`POSTGRES_PASSWORD`, `POSTGRES_DB=railway` and SCRAM
authentication. Do not point this image at an unrelated existing service/volume.

The build context is this directory. No application, local environment file,
account credential or keyring is uploaded in it. The immutable base image is
pinned by digest. Updating it requires reviewing its wrapper insertion point and
revalidating the TLS/renewal tests.

Export only `/var/lib/postgresql/data/certs/root.crt` through authenticated Railway
SSH into a private local CA file. Never export `root.key` or `server.key`. Pass the
CA file to `prepareDevelopmentDatabase`; its returned connection URL includes
`sslmode=verify-full` and the absolute `sslrootcert` path for standard pg/Prisma
clients. TCP plaintext and replication plaintext are rejected before existing HBA
rules. Certificate verification and hostname checks are never disabled.

The hook changes certificates and access configuration only. It never runs SQL,
deletes a database, resets accounts, changes passwords, or replaces migrations.
Container/database/TLS behavior must be tested on the actual dedicated service;
source assertions and a shell syntax check alone are not runtime evidence.
