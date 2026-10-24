# The immutable Railway SSL17 base retains its volume locks and lifecycle code.
FROM ghcr.io/railwayapp-templates/postgres-ssl:17@sha256:87184beace8ec657a760401a466a13c5b689066b31b77993103b4771933a9d31

USER root
COPY --chmod=755 init-ssl.sh /usr/local/bin/assessment-init-ssl.sh
COPY --chmod=755 init-ssl.sh /docker-entrypoint-initdb.d/init-ssl.sh
# Run after the original wrapper's volume locks/version safeguards, including on
# restarts where docker-entrypoint-initdb.d is not executed again. Fail the build
# if the reviewed upstream insertion point ever changes.
RUN test "$(grep -c '^SSL_DIR=' /usr/local/bin/wrapper.sh)" -eq 1 \
    && sed -i '/^SSL_DIR=/i\/usr/local/bin/assessment-init-ssl.sh' /usr/local/bin/wrapper.sh \
    && bash -n /usr/local/bin/assessment-init-ssl.sh \
    && postgres --version | grep -E '^postgres \(PostgreSQL\) 17\.'

ENV PGDATA=/var/lib/postgresql/data/pgdata \
    POSTGRES_DB=railway \
    POSTGRES_HOST_AUTH_METHOD=scram-sha-256 \
    POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256

# Command-line values also override ALTER SYSTEM settings. TCP plaintext is
# rejected by the managed leading pg_hba rules installed by init-ssl.sh.
CMD ["postgres", "-p", "5432", "-c", "listen_addresses=*", "-c", "ssl=on", "-c", "ssl_min_protocol_version=TLSv1.2", "-c", "ssl_cert_file=/var/lib/postgresql/data/certs/server.crt", "-c", "ssl_key_file=/var/lib/postgresql/data/certs/server.key", "-c", "ssl_ca_file=/var/lib/postgresql/data/certs/root.crt"]
