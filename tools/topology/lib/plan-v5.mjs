import path from 'node:path';

const FORBIDDEN_CLOUD_DEVELOPMENT_ROLES = Object.freeze([
  'standalone-gateway', 'application-cloud-gateway', 'platform-gateway',
  'api-listener', 'database', 'redis', 'migration', 'seed', 'worker',
]);

function remoteUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
  } catch {
    return false;
  }
}

function origin(value) {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

export function createResolvedRuntimePlan(runtime, profileId, runtimeTarget) {
  const profile = runtime.spec.orchestration?.profiles?.[runtime.assertProfileId(profileId)];
  if (!profile) throw new Error(`missing orchestration profile ${profileId}`);
  const profileEnv = runtime.loadProfile(profileId);
  const { deploymentProfile, environment } = runtime.parseProfileId(profileId);
  const processes = (profile.processes ?? []).filter((process) =>
    !Array.isArray(process.runtimeTargets)
      || process.runtimeTargets.length === 0
      || process.runtimeTargets.includes(runtimeTarget));
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
  const gateways = processes.filter((process) => [
    'standalone-gateway', 'application-cloud-gateway', 'platform-gateway',
  ].includes(process.role));
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
  if (runtime.spec.cloudIngress?.strategy === 'platform-collapsed'
    && resolvedBaseUrls['application.public-ingress']
    && resolvedBaseUrls['platform.api-gateway']
    && origin(resolvedBaseUrls['application.public-ingress']) !== origin(resolvedBaseUrls['platform.api-gateway'])) {
    throw new Error('platform-collapsed application and platform surfaces must share one origin');
  }
  return {
    schemaVersion: 1,
    kind: 'sdkwork.runtime-plan',
    appId: runtime.spec.appId,
    activeProfile: profileId,
    deploymentProfile,
    environment,
    runtimeTarget,
    localProcesses: processes,
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
