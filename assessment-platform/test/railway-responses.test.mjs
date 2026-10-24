import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeVolumeInventory,
  normalizeProxyInventory,
  normalizeCreatedProxy,
} from '../scripts/railway/responses.mjs';

const serviceName = 'assessment-postgres-17';
const serviceId = '11111111-1111-4111-8111-111111111111';
const volume = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'assessment-postgres-17-volume',
  mountPath: '/var/lib/postgresql/data',
  serviceName,
  currentSizeMB: 0,
  sizeMB: 500,
  status: 'Ready',
  isPendingDeletion: false,
  deletedAt: null,
};
const proxy = {
  id: 'tcp_123',
  domain: 'example.proxy.rlwy.net',
  proxyPort: 15432,
  applicationPort: 5432,
  endpoint: 'example.proxy.rlwy.net:15432',
  syncStatus: 'ACTIVE',
};

test('accepts the actual empty and populated CLI volume envelopes', () => {
  assert.deepEqual(normalizeVolumeInventory({ volumes: [] }, serviceName), []);
  const value = { project: 'development', environment: 'production', volumes: [volume] };
  assert.deepEqual(normalizeVolumeInventory(value, serviceName, serviceId), [volume]);
  assert.deepEqual(
    normalizeVolumeInventory({ volumes: [{ ...volume, serviceId }] }, serviceName, serviceId),
    [{ ...volume, serviceId }],
  );
});

test('refuses unrelated, ambiguous, detached, or deleting volumes instead of adopting them', () => {
  for (const value of [
    [],
    {},
    { volumes: null },
    { volumes: [volume, volume] },
    { volumes: [null] },
    { volumes: [{ ...volume, mountPath: '/unrelated/data' }] },
    { volumes: [{ ...volume, serviceName: 'another-service' }] },
    { volumes: [{ ...volume, serviceName: null }] },
    { volumes: [{ ...volume, serviceId: 'another-service-id' }] },
    { volumes: [{ ...volume, isPendingDeletion: true }] },
    { volumes: [{ ...volume, deletedAt: '2026-10-21T00:00:00Z' }] },
  ])
    assert.throws(() => normalizeVolumeInventory(value, serviceName, serviceId), /Railway/);
});

test('accepts CLI TCP proxy inventory and unwraps creation responses', () => {
  assert.deepEqual(normalizeProxyInventory({ proxies: [] }), []);
  assert.deepEqual(normalizeProxyInventory({ proxies: [proxy] }), [proxy]);
  assert.deepEqual(
    normalizeCreatedProxy({ applicationPort: 5432, staged: false, committed: true, proxy }),
    proxy,
  );
  assert.deepEqual(
    normalizeCreatedProxy({ applicationPort: 5432, staged: false, committed: false, proxy }),
    proxy,
  );
  assert.equal(
    normalizeCreatedProxy({ applicationPort: 5432, staged: false, committed: true, proxy: null }),
    null,
  );
});

test('rejects wrong TCP ports, contradictory endpoints and invented response shapes', () => {
  for (const changed of [
    { applicationPort: 6379 },
    { proxyPort: 0 },
    { proxyPort: 65536 },
    { proxyPort: '15432' },
    { domain: 'https://example.proxy.rlwy.net' },
    { domain: 'example.proxy.rlwy.net/other' },
    { endpoint: 'another.proxy.rlwy.net:15432' },
    { id: undefined },
  ]) {
    const candidate = { ...proxy, ...changed };
    assert.throws(() => normalizeProxyInventory({ proxies: [candidate] }), /Railway/);
    assert.throws(
      () =>
        normalizeCreatedProxy({
          applicationPort: 5432,
          staged: false,
          committed: true,
          proxy: candidate,
        }),
      /Railway/,
    );
  }
  for (const value of [[], { tcpProxies: [] }, { proxies: [proxy, proxy] }, { proxies: [null] }])
    assert.throws(() => normalizeProxyInventory(value), /Railway/);
  for (const value of [
    proxy,
    { applicationPort: 6379, staged: false, committed: true, proxy },
    { applicationPort: 5432, staged: true, committed: true, proxy },
    { applicationPort: 5432, staged: false, committed: true },
  ])
    assert.throws(() => normalizeCreatedProxy(value), /Railway/);
});

test('validation errors do not echo unexpected secret-bearing response values', () => {
  const secret = 'private-response-value';
  assert.throws(
    () => normalizeProxyInventory({ proxies: [{ ...proxy, endpoint: secret }] }),
    (error) => !error.message.includes(secret),
  );
});
