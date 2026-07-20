import { normalizeText } from './env-file.mjs';
import { parseProfileId } from './profile-id.mjs';

export const PROCESS_ROLES = Object.freeze([
  'client', 'api-standalone-gateway',
  'api-listener', 'database', 'redis', 'migration', 'seed', 'worker', 'tunnel',
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
    for (const process of profile.processes ?? []) {
      if (!normalizeText(process.id)) throw new Error(`${specPath} ${profileId} process id is required`);
      if (!PROCESS_ROLES.includes(process.role)) throw new Error(`${specPath} ${profileId} process ${process.id} requires a canonical role`);
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
      if (profileId === 'cloud.development' && !['client', 'tunnel'].includes(process.role)) {
        throw new Error(`${specPath} cloud.development forbids local process role ${process.role}`);
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
