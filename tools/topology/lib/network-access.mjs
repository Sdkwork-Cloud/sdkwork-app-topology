import { networkInterfaces as readNetworkInterfaces } from 'node:os';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DEFAULT_ADDRESS_FAMILIES = Object.freeze(['IPv4', 'IPv6']);

function normalizeAddressFamily(value) {
  const family = String(value ?? '').trim().toLowerCase();
  if (family === '4' || family === 'ipv4') {
    return 'IPv4';
  }
  if (family === '6' || family === 'ipv6') {
    return 'IPv6';
  }
  return undefined;
}

function normalizeAddressFamilies(families) {
  const values = Array.isArray(families) ? families : [families];
  return new Set(values.map(normalizeAddressFamily).filter(Boolean));
}

export function formatNetworkUrlHost(address) {
  const normalized = String(address).trim().replace(/^\[|\]$/gu, '');
  return normalized.includes(':') ? `[${normalized}]` : normalized;
}

function normalizePort(value) {
  const port = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535
    ? port
    : undefined;
}

function normalizeProtocol(value) {
  const protocol = String(value ?? 'http').trim().replace(/:$/u, '');
  return protocol || 'http';
}

function normalizePathname(value) {
  const pathname = String(value ?? '').trim();
  if (!pathname) {
    return '';
  }
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export function resolveNetworkInterfaceSnapshot(
  networkInterfaces = readNetworkInterfaces,
) {
  const snapshot = typeof networkInterfaces === 'function'
    ? networkInterfaces()
    : networkInterfaces;
  return snapshot ?? {};
}

export function resolveNonLoopbackIpAddresses(
  networkInterfaces = readNetworkInterfaces,
  { families = DEFAULT_ADDRESS_FAMILIES } = {},
) {
  const selectedFamilies = normalizeAddressFamilies(families);
  const addresses = new Set();
  const snapshot = resolveNetworkInterfaceSnapshot(networkInterfaces);
  for (const entries of Object.values(snapshot)) {
    for (const entry of entries ?? []) {
      const family = normalizeAddressFamily(entry?.family);
      const address = String(entry?.address ?? '').trim();
      if (
        !selectedFamilies.has(family)
        || entry.internal
        || !address
      ) {
        continue;
      }
      addresses.add(address);
    }
  }
  return [...addresses].sort((left, right) => left.localeCompare(right));
}

export function resolveNonLoopbackIpv4Addresses(
  networkInterfaces = readNetworkInterfaces,
) {
  return resolveNonLoopbackIpAddresses(networkInterfaces, { families: ['IPv4'] });
}

export function resolveNonLoopbackIpv6Addresses(
  networkInterfaces = readNetworkInterfaces,
) {
  return resolveNonLoopbackIpAddresses(networkInterfaces, { families: ['IPv6'] });
}

export function resolveNetworkAccessUrls({
  addressFamilies = ['IPv4'],
  host = '0.0.0.0',
  networkInterfaces,
  pathname = '',
  port,
  protocol = 'http',
} = {}) {
  const normalizedPort = normalizePort(port);
  if (!normalizedPort) {
    return [];
  }

  const normalizedHost = String(host ?? '').trim().toLowerCase();
  const urlPrefix = `${normalizeProtocol(protocol)}://`;
  const urlSuffix = `:${normalizedPort}${normalizePathname(pathname)}`;
  const urls = [`${urlPrefix}127.0.0.1${urlSuffix}`];
  if (LOOPBACK_HOSTS.has(normalizedHost)) {
    return urls;
  }

  for (const address of resolveNonLoopbackIpAddresses(networkInterfaces, {
    families: addressFamilies,
  })) {
    urls.push(`${urlPrefix}${formatNetworkUrlHost(address)}${urlSuffix}`);
  }
  return urls;
}

export function resolveNetworkAccessSummary(options = {}) {
  const urls = resolveNetworkAccessUrls(options);
  const normalizedHost = String(options.host ?? '0.0.0.0').trim().toLowerCase();
  return {
    allUrls: urls,
    listenerScope: LOOPBACK_HOSTS.has(normalizedHost) ? 'loopback' : 'network',
    localUrl: urls[0],
    networkUrls: urls.slice(1),
  };
}

export function formatResolvedNetworkAccessLines({
  localUrl,
  networkUrls = [],
} = {}, {
  includeLocal = true,
  localLabel = 'Local',
  networkLabel = 'Network',
  prefix = '',
  unavailableText,
} = {}) {
  if (!localUrl) {
    return [];
  }

  const lines = includeLocal
    ? [`${prefix}${localLabel}: ${localUrl}`]
    : [];
  if (networkUrls.length > 0) {
    lines.push(...networkUrls.map(
      (url) => `${prefix}${networkLabel}: ${url}`,
    ));
  } else if (unavailableText) {
    lines.push(`${prefix}${networkLabel}: ${unavailableText}`);
  }
  return lines;
}

export function formatNetworkAccessLines({
  addressFamilies = ['IPv4'],
  host = '0.0.0.0',
  includeLocal = true,
  localLabel = 'Local',
  networkInterfaces,
  networkLabel = 'Network',
  pathname = '',
  port,
  prefix = '',
  protocol = 'http',
  unavailableText,
} = {}) {
  const summary = resolveNetworkAccessSummary({
    addressFamilies,
    host,
    networkInterfaces,
    pathname,
    port,
    protocol,
  });
  return formatResolvedNetworkAccessLines(summary, {
    includeLocal,
    localLabel,
    networkLabel,
    prefix,
    unavailableText,
  });
}
