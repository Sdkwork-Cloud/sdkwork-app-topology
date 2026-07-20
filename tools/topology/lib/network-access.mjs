import { networkInterfaces as readNetworkInterfaces } from 'node:os';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

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

export function resolveNonLoopbackIpv4Addresses(
  networkInterfaces = readNetworkInterfaces(),
) {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces ?? {})) {
    for (const entry of entries ?? []) {
      if (
        (entry?.family !== 'IPv4' && entry?.family !== 4)
        || entry.internal
        || !entry.address
        || addresses.includes(entry.address)
      ) {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  return addresses.sort((left, right) => left.localeCompare(right));
}

export function resolveNetworkAccessUrls({
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

  for (const address of resolveNonLoopbackIpv4Addresses(networkInterfaces)) {
    urls.push(`${urlPrefix}${address}${urlSuffix}`);
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
