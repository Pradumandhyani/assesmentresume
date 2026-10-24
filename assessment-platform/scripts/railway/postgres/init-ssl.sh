#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# This hook is for a newly provisioned, dedicated development service. It never
# migrates a cluster, resets a database, or rotates an established trust anchor.
ssl_dir='/var/lib/postgresql/data/certs'
fail() { printf '%s\n' "assessment TLS: $1" >&2; exit 1; }
[[ "${PGDATA:-}" == '/var/lib/postgresql/data/pgdata' ]] || fail 'Unexpected PGDATA; refusing to initialize.'
[[ "${POSTGRES_HOST_AUTH_METHOD:-scram-sha-256}" == 'scram-sha-256' ]] || fail 'SCRAM authentication is required.'
[[ "${RAILWAY_TCP_PROXY_DOMAIN:-}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.proxy\.rlwy\.net$ ]] || fail 'Configure the Railway TCP proxy before deployment.'
[[ "${RAILWAY_PRIVATE_DOMAIN:-}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.railway\.internal$ ]] || fail 'A valid Railway private domain is required.'
for file in "$ssl_dir" "$ssl_dir/root.crt" "$ssl_dir/root.key" "$ssl_dir/server.crt" "$ssl_dir/server.key"; do
  [[ ! -L "$file" ]] || fail 'Certificate symlinks are not permitted.'
done
mkdir -p "$ssl_dir"
chmod 700 "$ssl_dir"
chown postgres:postgres "$ssl_dir"
work=$(mktemp -d "$ssl_dir/.issue.XXXXXXXX")
cleanup() {
  rm -f -- "$work/root.crt" "$work/root.key" "$work/server.crt" "$work/server.key" "$work/server.csr" "$work/extensions.cnf" "$work/hba"
  rmdir -- "$work"
}
trap cleanup EXIT

if [[ -e "$ssl_dir/root.crt" || -e "$ssl_dir/root.key" ]]; then
  [[ -s "$ssl_dir/root.crt" && -s "$ssl_dir/root.key" ]] || fail 'Incomplete CA; restore the original CA and key from backup.'
else
  [[ ! -e "$ssl_dir/server.crt" && ! -e "$ssl_dir/server.key" && ! -e "$PGDATA/PG_VERSION" ]] || fail 'Established data or certificates have lost their CA; restore the original.'
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
    -subj '/CN=Assessment Railway Development CA' \
    -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -keyout "$work/root.key" -out "$work/root.crt" >/dev/null 2>&1
  mv "$work/root.key" "$ssl_dir/root.key"
  mv "$work/root.crt" "$ssl_dir/root.crt"
fi
openssl verify -CAfile "$ssl_dir/root.crt" "$ssl_dir/root.crt" >/dev/null 2>&1 || fail 'The preserved CA is invalid.'
openssl x509 -checkend 2592000 -noout -in "$ssl_dir/root.crt" >/dev/null 2>&1 || fail 'CA expiry requires a planned trust rotation; it will not be replaced automatically.'
cmp -s <(openssl x509 -in "$ssl_dir/root.crt" -pubkey -noout) <(openssl pkey -in "$ssl_dir/root.key" -pubout 2>/dev/null) || fail 'The preserved CA certificate and key do not match.'

renew=false
if [[ ! -s "$ssl_dir/server.crt" || ! -s "$ssl_dir/server.key" ]]; then
  renew=true
elif ! openssl x509 -checkend 2592000 -noout -in "$ssl_dir/server.crt" >/dev/null 2>&1; then
  renew=true
elif ! cmp -s <(openssl x509 -in "$ssl_dir/server.crt" -pubkey -noout) <(openssl pkey -in "$ssl_dir/server.key" -pubout 2>/dev/null); then
  renew=true
else
  for domain in localhost "$RAILWAY_PRIVATE_DOMAIN" "$RAILWAY_TCP_PROXY_DOMAIN"; do
    if ! openssl verify -CAfile "$ssl_dir/root.crt" -purpose sslserver -verify_hostname "$domain" "$ssl_dir/server.crt" >/dev/null 2>&1; then
      renew=true
    fi
  done
fi
if [[ "$renew" == true ]]; then
  cat > "$work/extensions.cnf" <<EOF
[server]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,DNS:${RAILWAY_PRIVATE_DOMAIN},DNS:${RAILWAY_TCP_PROXY_DOMAIN}
EOF
  openssl req -new -newkey rsa:3072 -sha256 -nodes \
    -subj "/CN=${RAILWAY_TCP_PROXY_DOMAIN}" \
    -keyout "$work/server.key" -out "$work/server.csr" >/dev/null 2>&1
  openssl x509 -req -sha256 -days 365 -in "$work/server.csr" \
    -CA "$ssl_dir/root.crt" -CAkey "$ssl_dir/root.key" \
    -set_serial "0x$(openssl rand -hex 16)" \
    -extfile "$work/extensions.cnf" -extensions server \
    -out "$work/server.crt" >/dev/null 2>&1
  mv "$work/server.key" "$ssl_dir/server.key"
  mv "$work/server.crt" "$ssl_dir/server.crt"
  printf '%s\n' 'assessment TLS: Issued a verified server leaf; the CA was preserved.'
fi
chmod 600 "$ssl_dir/root.key" "$ssl_dir/server.key"
chmod 644 "$ssl_dir/root.crt" "$ssl_dir/server.crt"
chown postgres:postgres "$ssl_dir/root.key" "$ssl_dir/root.crt" "$ssl_dir/server.key" "$ssl_dir/server.crt"

if [[ -f "$PGDATA/postgresql.conf" ]]; then
  if ! grep -q '^# assessment verified TLS settings$' "$PGDATA/postgresql.conf"; then
    cat >> "$PGDATA/postgresql.conf" <<EOF

# assessment verified TLS settings
ssl = on
ssl_min_protocol_version = 'TLSv1.2'
ssl_cert_file = '$ssl_dir/server.crt'
ssl_key_file = '$ssl_dir/server.key'
ssl_ca_file = '$ssl_dir/root.crt'
password_encryption = 'scram-sha-256'
EOF
  fi
  hba="$PGDATA/pg_hba.conf"
  [[ -f "$hba" && ! -L "$hba" ]] || fail 'The PostgreSQL access policy is missing or unsafe.'
  starts=$(grep -c '^# assessment TLS-only begin$' "$hba" || true)
  ends=$(grep -c '^# assessment TLS-only end$' "$hba" || true)
  [[ "$starts" == "$ends" && "$starts" -le 1 ]] || fail 'The managed access policy is incomplete; restore the original file.'
  cat > "$work/hba" <<'EOF'
# assessment TLS-only begin
hostnossl all all 0.0.0.0/0 reject
hostnossl all all ::/0 reject
hostnossl replication all 0.0.0.0/0 reject
hostnossl replication all ::/0 reject
# assessment TLS-only end
EOF
  awk '/^# assessment TLS-only begin$/{skip=1;next} /^# assessment TLS-only end$/{skip=0;next} !skip{print}' "$hba" >> "$work/hba"
  if ! cmp -s "$work/hba" "$hba"; then
    # Keep the original file's inode/ownership for the upstream entrypoint.
    cat "$work/hba" > "$hba"
    chmod 600 "$hba"
  fi
fi
sync "$ssl_dir/root.crt" "$ssl_dir/root.key" "$ssl_dir/server.crt" "$ssl_dir/server.key" "$ssl_dir"
