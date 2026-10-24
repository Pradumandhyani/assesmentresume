import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePublicCertificate } from '../scripts/railway/certificate.mjs';

test('exports a usable public CA PEM without JSON escaping and preserves it on invalid input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assessment-ca-'));
  try {
    const file = join(directory, 'ca.crt');
    writePublicCertificate(file, rootCertificates[0]);
    const actual = readFileSync(file, 'utf8');
    assert.equal(
      new X509Certificate(actual).fingerprint256,
      new X509Certificate(rootCertificates[0]).fingerprint256,
    );
    assert.ok(actual.startsWith('-----BEGIN CERTIFICATE-----\n'));
    for (const invalid of [
      'not a certificate',
      '-----BEGIN PRIVATE KEY-----',
      rootCertificates[0] + rootCertificates[1],
    ])
      assert.throws(() => writePublicCertificate(file, invalid));
    assert.equal(readFileSync(file, 'utf8'), actual);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
