import { parseTcpBinding } from './development-ownership.mjs';
import {
  formatResolvedNetworkAccessLines,
  resolveNetworkAccessSummary,
} from './network-access.mjs';

export const ACCESS_ENDPOINT_KINDS = Object.freeze([
  'user-interface',
  'api-reference',
  'health',
  'service',
]);

const ACCESS_ENDPOINT_LABELS = Object.freeze({
  'user-interface': 'Application',
  'api-reference': 'API Reference',
  health: 'Health',
  service: 'Service',
});

function matchesSelection(values, selected) {
  return !Array.isArray(values) || values.length === 0 || values.includes(selected);
}

function endpointUrl(baseUrl, pathname) {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function loopbackBaseUrl(binding) {
  const host = ['0.0.0.0', '::', '[::]'].includes(binding.host)
    ? '127.0.0.1'
    : binding.host;
  const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${formattedHost}:${binding.port}`;
}

function reachableSurfaceBaseUrl(baseUrl, binding) {
  const url = new URL(baseUrl);
  if (binding && ['0.0.0.0', '::', '[::]'].includes(url.hostname)) {
    return loopbackBaseUrl(binding);
  }
  return baseUrl;
}

export function resolveDeclaredAccessEndpoints({
  runtime,
  profile,
  profileEnv,
  selectedProcesses,
  resolvedBaseUrls,
  runtimeTarget,
  clientArchitecture,
}) {
  const selectedProcessIds = new Set(selectedProcesses.map((process) => process.id));
  const processesById = new Map((profile.processes ?? []).map((process) => [process.id, process]));
  const endpoints = [];

  for (const declaration of profile.accessEndpoints ?? []) {
    if (!matchesSelection(declaration.runtimeTargets, runtimeTarget)
      || !matchesSelection(declaration.clientArchitectures, clientArchitecture)) {
      continue;
    }

    const processId = declaration.source?.processId;
    const surfaceId = declaration.source?.surfaceId;
    let binding;
    let baseUrl;

    if (processId) {
      if (!selectedProcessIds.has(processId)) {
        continue;
      }
      const process = processesById.get(processId);
      binding = parseTcpBinding(profileEnv[process.bindEnv], process.bindEnv);
      baseUrl = loopbackBaseUrl(binding);
    } else if (surfaceId) {
      const surface = runtime.spec.surfaces[surfaceId];
      if (surface.bindEnv && profileEnv[surface.bindEnv]) {
        binding = parseTcpBinding(profileEnv[surface.bindEnv], surface.bindEnv);
      }
      baseUrl = resolvedBaseUrls[surfaceId]
        ?? runtime.resolveSurfaceHttpUrl(profileEnv, surfaceId);
      if (!baseUrl && binding) {
        baseUrl = loopbackBaseUrl(binding);
      }
      if (!baseUrl) {
        throw new Error(`access endpoint ${declaration.id} cannot resolve surface ${surfaceId}`);
      }
      baseUrl = reachableSurfaceBaseUrl(baseUrl, binding);
    }

    endpoints.push({
      id: declaration.id,
      kind: declaration.kind,
      primary: declaration.primary === true,
      source: { ...declaration.source },
      path: declaration.path,
      url: endpointUrl(baseUrl, declaration.path),
      binding: binding
        ? { host: binding.host, port: binding.port, value: binding.value }
        : null,
    });
  }

  const primaryEndpoints = endpoints.filter((endpoint) => endpoint.primary);
  if (primaryEndpoints.length > 1) {
    throw new Error(
      `resolved runtime plan has multiple primary access endpoints: ${primaryEndpoints.map((endpoint) => endpoint.id).join(', ')}`,
    );
  }
  return endpoints;
}

export function resolveAccessEndpointReports(plan, { networkInterfaces } = {}) {
  return (plan.accessEndpoints ?? []).map((endpoint) => {
    if (!endpoint.binding) {
      return {
        ...endpoint,
        allUrls: [endpoint.url],
        listenerScope: 'remote',
        localUrl: endpoint.url,
        networkUrls: [],
      };
    }
    const protocol = new URL(endpoint.url).protocol.replace(/:$/u, '');
    return {
      ...endpoint,
      ...resolveNetworkAccessSummary({
        host: endpoint.binding.host,
        port: endpoint.binding.port,
        pathname: endpoint.path,
        protocol,
        networkInterfaces,
      }),
    };
  });
}

export function formatPrimaryAccessLines(plan, {
  heading = 'Access URLs',
  localLabel = 'Local',
  networkInterfaces,
  networkLabel = 'Network',
  prefix = '',
  statusText,
  unavailableText = 'unavailable (listener is loopback-only or no LAN address was detected)',
} = {}) {
  const reports = resolveAccessEndpointReports(plan, { networkInterfaces });
  const primary = reports.find((endpoint) => endpoint.primary);
  if (!primary) {
    return [];
  }
  const isRemote = primary.listenerScope === 'remote';
  return [
    ...(statusText ? [`${prefix}${statusText}`] : []),
    `${prefix}${heading}`,
    ...formatResolvedNetworkAccessLines(primary, {
      localLabel: isRemote ? 'URL' : localLabel,
      networkLabel,
      prefix: `${prefix}  `,
      unavailableText: isRemote ? undefined : unavailableText,
    }),
  ];
}

export function formatAccessEndpointCatalogLines(plan, {
  heading = 'Access Endpoints',
  prefix = '',
} = {}) {
  const endpoints = plan.accessEndpoints ?? [];
  if (endpoints.length === 0) {
    return [];
  }
  return [
    `${prefix}${heading}`,
    ...endpoints.map((endpoint) => (
      `${prefix}  ${ACCESS_ENDPOINT_LABELS[endpoint.kind] ?? endpoint.id}: ${endpoint.url}`
    )),
  ];
}
