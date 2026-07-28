import { normalizeText } from './env-file.mjs';
import { ACCESS_ENDPOINT_KINDS } from './access-endpoints.mjs';
import { parseProfileId } from './profile-id.mjs';
import { MANAGED_RESOURCE_DRIVERS } from './managed-resources.mjs';

export const PROCESS_ROLES = Object.freeze([
  'client', 'api-standalone-gateway',
  'edge-runtime', 'database', 'redis', 'migration', 'seed', 'worker', 'tunnel',
]);

export const RUNTIME_TARGETS = Object.freeze([
  'browser', 'desktop', 'tablet-ipados', 'tablet-android',
  'capacitor-ios', 'capacitor-android', 'flutter-ios', 'flutter-android',
  'android-native', 'ios-native', 'harmony-native', 'mini-program',
  'server', 'container', 'test-runner',
]);

export const CLIENT_ARCHITECTURES = Object.freeze([
  'pc-web', 'h5', 'capacitor', 'flutter', 'tauri', 'electron',
  'android-native', 'ios-native', 'harmony-native', 'mini-program',
]);

function assertProfileId(profileId, specPath) {
  const parsed = parseProfileId(profileId);
  if (parsed.serviceLayout) {
    throw new Error(`${specPath} profile id ${profileId} must use <deploymentProfile>.<environment>`);
  }
  if (!['standalone', 'cloud'].includes(parsed.deploymentProfile)) {
    throw new Error(`${specPath} profile id ${profileId} has invalid deploymentProfile`);
  }
  return parsed;
}

export function validateTopologySpecV5(spec, specPath = 'topology.spec.json') {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`${specPath} must be a JSON object`);
  }
  if (spec.schemaVersion !== 5) throw new Error(`${specPath} schemaVersion must be 5`);
  if (spec.kind !== 'sdkwork.app.topology') throw new Error(`${specPath} kind must be sdkwork.app.topology`);
  if (!/^sdkwork-[a-z0-9-]+$/u.test(spec.appId ?? '')) throw new Error(`${specPath} appId must use sdkwork-<application-code>`);
  const profiles = spec.vocabulary?.deploymentProfile?.allowed;
  if (!Array.isArray(profiles) || profiles.length !== 2
    || profiles[0] !== 'standalone' || profiles[1] !== 'cloud') {
    throw new Error(`${specPath} vocabulary.deploymentProfile.allowed must be standalone, cloud`);
  }
  if (spec.vocabulary?.hosting || spec.vocabulary?.serviceLayout) {
    throw new Error(`${specPath} hosting/serviceLayout vocabulary is retired in schema v5`);
  }
  const environments = spec.vocabulary?.environment?.allowed;
  if (!Array.isArray(environments) || environments.length === 0) {
    throw new Error(`${specPath} vocabulary.environment.allowed must be a non-empty array`);
  }

  if (spec.cloudIngress !== undefined) {
    throw new Error(`${specPath} cloudIngress is retired; declare remote surface URLs instead`);
  }

  const profileFiles = spec.profileFiles;
  if (!profileFiles || typeof profileFiles !== 'object' || Array.isArray(profileFiles)) {
    throw new Error(`${specPath} profileFiles is required`);
  }
  for (const [profileId, profileFile] of Object.entries(profileFiles)) {
    const parsed = assertProfileId(profileId, specPath);
    if (!environments.includes(parsed.environment)) throw new Error(`${specPath} profile ${profileId} uses an undeclared environment`);
    if (!normalizeText(profileFile) || /^[/\\]|\.\./u.test(profileFile)) throw new Error(`${specPath} profileFiles.${profileId} must be a safe relative path`);
  }

  const surfaces = spec.surfaces ?? {};
  if (!surfaces['application.public-ingress']) throw new Error(`${specPath} missing application.public-ingress`);
  if (!surfaces['platform.api-gateway']) throw new Error(`${specPath} missing platform.api-gateway`);
  for (const [surfaceId, surface] of Object.entries(surfaces)) {
    if (!normalizeText(surface.connectivityPlane)) throw new Error(`${specPath} surfaces.${surfaceId}.connectivityPlane is required`);
    if (!surface.bindEnv && !surface.httpUrlEnv && !surface.optional) {
      throw new Error(`${specPath} surfaces.${surfaceId} must declare bindEnv or httpUrlEnv`);
    }
  }

  const orchestration = spec.orchestration?.profiles;
  if (!orchestration || typeof orchestration !== 'object') throw new Error(`${specPath} orchestration.profiles is required`);
  for (const [profileId, profile] of Object.entries(orchestration)) {
    assertProfileId(profileId, specPath);
    if (!profileFiles[profileId]) throw new Error(`${specPath} orchestration profile ${profileId} is missing from profileFiles`);
    const processesById = new Map(
      (profile.processes ?? []).map((process) => [process.id, process]),
    );
    for (const process of profile.processes ?? []) {
      if (!normalizeText(process.id)) throw new Error(`${specPath} ${profileId} process id is required`);
      if (!PROCESS_ROLES.includes(process.role)) throw new Error(`${specPath} ${profileId} process ${process.id} requires a canonical role`);
      if (process.applicationRoot !== undefined
        && (process.role !== 'client' || !normalizeText(process.applicationRoot))) {
        throw new Error(`${specPath} ${profileId} process ${process.id} applicationRoot is valid only on a client process`);
      }
      if (process.role === 'edge-runtime') {
        if (!/^_sdkwork:runtime:[a-z0-9][a-z0-9:-]*$/u.test(normalizeText(process.script))) {
          throw new Error(`${specPath} ${profileId} edge-runtime ${process.id} requires an _sdkwork:runtime:* script`);
        }
        if (!/^docs\/(?:adr|architecture\/decisions)\/[A-Za-z0-9._/-]+\.md$/u.test(normalizeText(process.decisionRef))) {
          throw new Error(`${specPath} ${profileId} edge-runtime ${process.id} requires a canonical decisionRef`);
        }
      }
      if (process.runtimeTargets !== undefined) {
        if (!Array.isArray(process.runtimeTargets) || process.runtimeTargets.length === 0
          || process.runtimeTargets.some((target) => !RUNTIME_TARGETS.includes(target))) {
          throw new Error(`${specPath} ${profileId} process ${process.id} runtimeTargets must contain canonical runtime targets`);
        }
      }
      if (process.clientArchitectures !== undefined) {
        if (process.role !== 'client'
          || !Array.isArray(process.clientArchitectures)
          || process.clientArchitectures.length === 0
          || process.clientArchitectures.some((architecture) => !CLIENT_ARCHITECTURES.includes(architecture))) {
          throw new Error(`${specPath} ${profileId} process ${process.id} clientArchitectures must contain canonical client architectures on a client process`);
        }
      }
      if (process.bindEnv !== undefined && !/^[A-Z][A-Z0-9_]+$/u.test(process.bindEnv)) {
        throw new Error(`${specPath} ${profileId} process ${process.id} bindEnv must be an environment key`);
      }
      if (profileId === 'cloud.development' && !['client', 'tunnel'].includes(process.role)) {
        throw new Error(`${specPath} cloud.development forbids local process role ${process.role}`);
      }
    }
    const browserDeliveryIds = new Set();
    for (const delivery of profile.browserDeliveries ?? []) {
      const label = `${specPath} ${profileId} browser delivery ${delivery.id ?? '<missing>'}`;
      if (!/^[a-z0-9][a-z0-9.-]*$/u.test(normalizeText(delivery.id))) {
        throw new Error(`${label} id must use lowercase dot/kebab tokens`);
      }
      if (browserDeliveryIds.has(delivery.id)) {
        throw new Error(`${label} is duplicated`);
      }
      browserDeliveryIds.add(delivery.id);
      if (!normalizeText(delivery.applicationRoot) || /^[/\\]|(?:^|[/\\])\.\.(?:[/\\]|$)/u.test(delivery.applicationRoot)) {
        throw new Error(`${label} applicationRoot must be a safe relative path`);
      }
      if (!Array.isArray(delivery.clientArchitectures)
        || delivery.clientArchitectures.length === 0
        || new Set(delivery.clientArchitectures).size !== delivery.clientArchitectures.length
        || delivery.clientArchitectures.some((architecture) => !CLIENT_ARCHITECTURES.includes(architecture))) {
        throw new Error(`${label} clientArchitectures must contain unique canonical client architectures`);
      }
      if (delivery.originMode !== 'same-origin') {
        throw new Error(`${label} originMode must be same-origin`);
      }
      if (delivery.apiSurfaceId !== 'application.public-ingress') {
        throw new Error(`${label} apiSurfaceId must be application.public-ingress`);
      }
      if (profileId === 'standalone.development'
        && delivery.deliveryMode !== 'dev-server-proxy') {
        throw new Error(`${label} must use dev-server-proxy`);
      }
      if (profileId === 'standalone.production'
        && delivery.deliveryMode !== 'gateway-static') {
        throw new Error(`${label} must use gateway-static`);
      }
      if (delivery.deliveryMode === 'dev-server-proxy') {
        const client = processesById.get(delivery.clientProcessId);
        if (!client || client.role !== 'client' || !normalizeText(client.bindEnv)) {
          throw new Error(`${label} requires a clientProcessId that references a client with bindEnv`);
        }
        if (delivery.preserveCanonicalPaths !== true) {
          throw new Error(`${label} must preserve canonical API paths`);
        }
        if (!Array.isArray(client.clientArchitectures)
          || client.clientArchitectures.length !== delivery.clientArchitectures.length
          || !delivery.clientArchitectures.every((architecture) => client.clientArchitectures.includes(architecture))) {
          throw new Error(`${label} clientArchitectures must match its client process`);
        }
      } else if (delivery.deliveryMode === 'gateway-static') {
        const host = processesById.get(delivery.hostProcessId);
        if (!host || host.role !== 'api-standalone-gateway') {
          throw new Error(`${label} requires a gateway hostProcessId`);
        }
        if (!normalizeText(delivery.buildOutput)
          || /^[/\\]|(?:^|[/\\])\.\.(?:[/\\]|$)/u.test(delivery.buildOutput)) {
          throw new Error(`${label} buildOutput must be a safe relative path`);
        }
        if (!/^[A-Z][A-Z0-9_]+$/u.test(delivery.runtimeRootEnv ?? '')) {
          throw new Error(`${label} runtimeRootEnv must be an environment key`);
        }
        if (delivery.mountPath !== '/' || delivery.spaFallback !== '/index.html') {
          throw new Error(`${label} requires mountPath / and spaFallback /index.html`);
        }
      } else {
        throw new Error(`${label} requires a canonical deliveryMode`);
      }
    }
    const accessEndpointIds = new Set();
    for (const endpoint of profile.accessEndpoints ?? []) {
      if (!/^[a-z0-9][a-z0-9.-]*$/u.test(normalizeText(endpoint.id))) {
        throw new Error(`${specPath} ${profileId} access endpoint id must use lowercase dot/kebab tokens`);
      }
      if (accessEndpointIds.has(endpoint.id)) {
        throw new Error(`${specPath} ${profileId} access endpoint id ${endpoint.id} is duplicated`);
      }
      accessEndpointIds.add(endpoint.id);
      if (!ACCESS_ENDPOINT_KINDS.includes(endpoint.kind)) {
        throw new Error(`${specPath} ${profileId} access endpoint ${endpoint.id} requires a canonical kind`);
      }
      if (!normalizeText(endpoint.path)?.startsWith('/') || /[?#]/u.test(endpoint.path)) {
        throw new Error(`${specPath} ${profileId} access endpoint ${endpoint.id} path must be an absolute path without query or hash`);
      }
      const processId = normalizeText(endpoint.source?.processId);
      const surfaceId = normalizeText(endpoint.source?.surfaceId);
      if (Boolean(processId) === Boolean(surfaceId)) {
        throw new Error(`${specPath} ${profileId} access endpoint ${endpoint.id} must reference exactly one processId or surfaceId`);
      }
      if (processId) {
        const process = processesById.get(processId);
        if (!process) {
          throw new Error(`${specPath} ${profileId} access endpoint ${endpoint.id} references unknown process ${processId}`);
        }
        if (!normalizeText(process.bindEnv)) {
          throw new Error(`${specPath} ${profileId} access endpoint ${endpoint.id} process ${processId} must declare bindEnv`);
        }
      }
      if (surfaceId && !surfaces[surfaceId]) {
        throw new Error(`${specPath} ${profileId} access endpoint ${endpoint.id} references unknown surface ${surfaceId}`);
      }
      if (endpoint.runtimeTargets !== undefined
        && (!Array.isArray(endpoint.runtimeTargets)
          || endpoint.runtimeTargets.length === 0
          || endpoint.runtimeTargets.some((target) => !RUNTIME_TARGETS.includes(target)))) {
        throw new Error(`${specPath} ${profileId} access endpoint ${endpoint.id} runtimeTargets must contain canonical runtime targets`);
      }
      if (endpoint.clientArchitectures !== undefined
        && (!Array.isArray(endpoint.clientArchitectures)
          || endpoint.clientArchitectures.length === 0
          || endpoint.clientArchitectures.some((architecture) => !CLIENT_ARCHITECTURES.includes(architecture)))) {
        throw new Error(`${specPath} ${profileId} access endpoint ${endpoint.id} clientArchitectures must contain canonical client architectures`);
      }
    }
    for (const resource of profile.managedResources ?? []) {
      if (!normalizeText(resource.id)) throw new Error(`${specPath} ${profileId} managed resource id is required`);
      if (!MANAGED_RESOURCE_DRIVERS.includes(resource.driver)) {
        throw new Error(`${specPath} ${profileId} managed resource ${resource.id} requires a supported driver`);
      }
      for (const key of ['enabledEnv', 'listenAddressEnv', 'listenPortEnv', 'distributionEnv']) {
        if (resource[key] !== undefined && !/^[A-Z][A-Z0-9_]+$/u.test(resource[key])) {
          throw new Error(`${specPath} ${profileId} managed resource ${resource.id} ${key} must be an environment key`);
        }
      }
    }
  }
  const standalone = orchestration['standalone.development'];
  if (standalone) {
    const gateways = (standalone.processes ?? []).filter((process) => process.role === 'api-standalone-gateway');
    if (gateways.length !== 1) throw new Error(`${specPath} standalone.development requires exactly one api-standalone-gateway`);
  }
  return spec;
}
