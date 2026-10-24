const volumeMount = '/var/lib/postgresql/data';
const applicationPort = 5432;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const invalid = (resource) => {
  throw new Error(`Unexpected Railway ${resource} response; existing resources were preserved.`);
};

/** CLI 5.71.0 lists all environment volumes, including volumes on other services. */
export function normalizeVolumeInventory(value, expectedServiceName, expectedServiceId) {
  if (
    !record(value) ||
    !Array.isArray(value.volumes) ||
    value.volumes.length > 1 ||
    typeof expectedServiceName !== 'string' ||
    !expectedServiceName ||
    (expectedServiceId !== undefined && !identifier(expectedServiceId))
  )
    invalid('volume inventory');
  for (const volume of value.volumes) {
    if (
      !record(volume) ||
      !identifier(volume.id) ||
      volume.mountPath !== volumeMount ||
      volume.serviceName !== expectedServiceName ||
      (volume.serviceId !== undefined &&
        (!identifier(volume.serviceId) ||
          (expectedServiceId !== undefined && volume.serviceId !== expectedServiceId))) ||
      volume.isPendingDeletion === true ||
      (volume.deletedAt !== undefined && volume.deletedAt !== null)
    )
      invalid('volume inventory');
  }
  return value.volumes;
}

function normalizeProxy(proxy) {
  if (!record(proxy)) invalid('TCP proxy');
  const domain = proxy.domain;
  const validDomain =
    typeof domain === 'string' &&
    domain.length <= 253 &&
    domain.includes('.') &&
    domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  if (
    !identifier(proxy.id) ||
    !validDomain ||
    !Number.isInteger(proxy.proxyPort) ||
    proxy.proxyPort < 1 ||
    proxy.proxyPort > 65535 ||
    proxy.applicationPort !== applicationPort ||
    proxy.endpoint !== `${domain}:${proxy.proxyPort}`
  )
    invalid('TCP proxy');
  return proxy;
}

/** CLI 5.71.0 returns { proxies: [...] }, not a raw array or GraphQL tcpProxies. */
export function normalizeProxyInventory(value) {
  if (!record(value) || !Array.isArray(value.proxies) || value.proxies.length > 1)
    invalid('TCP proxy inventory');
  return value.proxies.map(normalizeProxy);
}

/** Creation may succeed before the active proxy is readable; callers must poll its inventory. */
export function normalizeCreatedProxy(value) {
  if (
    !record(value) ||
    value.applicationPort !== applicationPort ||
    typeof value.staged !== 'boolean' ||
    typeof value.committed !== 'boolean' ||
    (value.staged && value.committed)
  )
    invalid('TCP proxy creation');
  return value.proxy === null ? null : normalizeProxy(value.proxy);
}
