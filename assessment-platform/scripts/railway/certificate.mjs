import { X509Certificate, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

/** Preserve a public PEM verbatim; JSON serialization corrupts TLS trust files. */
export function writePublicCertificate(file, value) {
  if (typeof value !== 'string' || value.length > 1048576 || /PRIVATE KEY/.test(value))
    throw new Error('Only a public TLS certificate can be saved.');
  const blocks = value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (blocks?.length !== 1) throw new Error('Expected one public TLS certificate.');
  const pem = blocks[0] + '\n';
  try {
    new X509Certificate(pem);
  } catch {
    throw new Error('The public TLS certificate is invalid.');
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, pem, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}
