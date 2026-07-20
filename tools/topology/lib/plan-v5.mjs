import path from 'node:path';

import { resolveOwnedBindings } from './development-ownership.mjs';

const FORBIDDEN_CLOUD_DEVELOPMENT_ROLES = Object.freeze([
  'api-standalone-gateway',
  'edge-runtime', 'database', 'redis', 'migration', 'seed', 'worker',
]);

function remoteUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
  } catch {
    return false;
  }
}

export function createResolvedRuntimePlan(runtime, profileId, runtimeTarget, clientArchitecture) {
  const profile = runtime.spec.orchestration?.profiles?.[runtime.assertProfileId(profileId)];
  if (!profile) throw new Error(`missing orchestration profile ${profileId}`);
  const profileEnv = runtime.loadProfile(profileId);
  const { deploymentProfile, environment } = runtime.parseProfileId(profileId);
  const processes = (profile.processes ?? []).filter((process) => {
    const runtimeMatches = !Array.isArray(process.runtimeTargets)
      || process.runtimeTargets.length === 0
      || process.runtimeTargets.includes(runtimeTarget);
    const architectureMatches = !Array.isArray(process.clientArchitectures)
      || process.clientArchitectures.length === 0
      || process.clientArchitectures.includes(clientArchitecture);
    return runtimeMatches && architectureMatches;
  });
  const resolvedBaseUrls = {};
  const endpointProvenance = {};
  const remoteSurfaces = [];
  const profileSource = runtime.spec.profileFiles[profileId].replaceAll('\\', '/');
  for (const [surfaceId, surface] of Object.entries(runtime.spec.surfaces ?? {})) {
    if (!surface.httpUrlEnv) continue;
    const value = profileEnv[surface.httpUrlEnv];
    if (!value) continue;
    resolvedBaseUrls[surfaceId] = value;
    endpointProvenance[surfaceId] = { source: profileSource, key: surface.httpUrlEnv };
    if (remoteUrl(value)) remoteSurfaces.push(surfaceId);
  }
  const gateways = processes.filter((process) => process.role === 'api-standalone-gateway');
  const forbiddenProcesses = deploymentProfile === 'cloud' && environment === 'development'
    ? processes.filter((process) => FORBIDDEN_CLOUD_DEVELOPMENT_ROLES.includes(process.role)).map((process) => process.id)
    : [];
  if (deploymentProfile === 'cloud' && environment === 'development') {
    for (const surfaceId of ['application.public-ingress', 'platform.api-gateway']) {
      const surface = runtime.spec.surfaces?.[surfaceId];
      if (surface?.httpUrlEnv && !resolvedBaseUrls[surfaceId]) throw new Error(`${profileId} requires an explicit URL for ${surfaceId}`);
    }
    const tunnel = processes.some((process) => process.role === 'tunnel');
    for (const [surfaceId, value] of Object.entries(resolvedBaseUrls)) {
      if (!remoteUrl(value) && !tunnel) throw new Error(`${profileId} ${surfaceId} must use a deployed URL or explicit tunnel`);
    }
  }
  return {
    schemaVersion: 1,
    kind: 'sdkwork.runtime-plan',
    appId: runtime.spec.appId,
    activeProfile: profileId,
    deploymentProfile,
    environment,
    runtimeTarget,
    clientArchitecture: clientArchitecture ?? null,
    localProcesses: processes,
    ownedBindings: resolveOwnedBindings(runtime.spec, profile, profileEnv),
    managedResources: profile.managedResources ?? [],
    localGateway: gateways.length === 1
      ? { id: gateways[0].id, role: gateways[0].role, binary: gateways[0].binary ?? gateways[0].crate ?? null }
      : null,
    remoteSurfaces,
    resolvedBaseUrls,
    endpointProvenance,
    localDataStores: processes.filter((process) => ['database', 'redis'].includes(process.role)).map((process) => ({ id: process.id, role: process.role })),
    healthChecks: (profile.healthSurfaces ?? []).map((surfaceId) => ({ surfaceId, url: resolvedBaseUrls[surfaceId] ?? null, required: true })),
    configSources: [path.relative(runtime.repoRoot, runtime.specPath).replaceAll('\\', '/'), profileSource],
    forbiddenProcessRoles: deploymentProfile === 'cloud' && environment === 'development'
      ? FORBIDDEN_CLOUD_DEVELOPMENT_ROLES
      : [],
    forbiddenProcesses,
  };
}
