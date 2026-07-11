import { normalizeText } from './env-file.mjs';

const LEGACY_HOSTING_TO_DEPLOYMENT_PROFILE = {
  'self-hosted': 'standalone',
  'cloud-hosted': 'cloud',
};

export function normalizeDeploymentProfile(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return normalized;
  }
  return LEGACY_HOSTING_TO_DEPLOYMENT_PROFILE[normalized] ?? normalized;
}

export function buildProfileId(deploymentProfile, serviceLayoutOrEnvironment, environment) {
  const normalizedDeploymentProfile = normalizeDeploymentProfile(deploymentProfile);
  const normalizedEnvironment = normalizeText(environment ?? serviceLayoutOrEnvironment);
  const normalizedServiceLayout = environment === undefined
    ? undefined
    : normalizeText(serviceLayoutOrEnvironment);
  const parts = [normalizedDeploymentProfile, normalizedServiceLayout, normalizedEnvironment]
    .filter((value) => value !== undefined);
  if (parts.some((value) => !value)) {
    throw new Error('deploymentProfile and environment are required to build a profile id');
  }
  return parts.join('.');
}

export function parseProfileId(profileId) {
  const normalized = normalizeText(profileId);
  if (!normalized) {
    throw new Error('profile id is required');
  }
  const segments = normalized.split('.');
  if (segments.length !== 2 && segments.length !== 3) {
    throw new Error(
      `profile id must be <deploymentProfile>.<environment> or <deploymentProfile>.<serviceLayout>.<environment>, received: ${profileId}`,
    );
  }
  const [deploymentProfile, serviceLayout, environment] = segments.length === 3
    ? segments
    : [segments[0], undefined, segments[1]];
  return {
    deploymentProfile,
    serviceLayout,
    environment,
    profileId: normalized,
    hosting: deploymentProfile,
  };
}

export function resolveProfileRelativePath(spec, profileId) {
  const explicit = spec.profileFiles?.[profileId];
  if (explicit) {
    return explicit;
  }
  const { deploymentProfile, hosting, serviceLayout, environment } = parseProfileId(profileId);
  const pattern = spec.profilePattern ?? '{deploymentProfile}.{serviceLayout}.{environment}.env';
  const profileRoot = spec.profileRoot ?? 'configs/topology';
  return `${profileRoot}/${pattern
    .replaceAll('{deploymentProfile}', deploymentProfile)
    .replaceAll('{hosting}', hosting)
    .replaceAll('{serviceLayout}', serviceLayout ?? '')
    .replaceAll('{environment}', environment)}`;
}

export function listProfileIdsFromVocabulary(spec) {
  const deploymentProfiles =
    spec.vocabulary?.deploymentProfile?.allowed ?? spec.vocabulary?.hosting?.allowed ?? [];
  const serviceLayouts = spec.vocabulary?.serviceLayout?.allowed ?? [];
  const environments = spec.vocabulary?.environment?.allowed ?? [];
  const profileIds = [];
  for (const deploymentProfile of deploymentProfiles) {
    if (serviceLayouts.length > 0) {
      for (const layout of serviceLayouts) {
        for (const tier of environments) {
          profileIds.push(buildProfileId(deploymentProfile, layout, tier));
        }
      }
      continue;
    }
    for (const tier of environments) {
      profileIds.push(buildProfileId(deploymentProfile, tier));
    }
  }
  return profileIds;
}
