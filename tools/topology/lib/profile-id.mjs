import { normalizeText } from './env-file.mjs';

export function buildProfileId(deploymentProfile, serviceLayout, environment) {
  const parts = [deploymentProfile, serviceLayout, environment].map((value) => normalizeText(value));
  if (parts.some((value) => !value)) {
    throw new Error('deploymentProfile, serviceLayout, and environment are required to build a profile id');
  }
  return parts.join('.');
}

export function parseProfileId(profileId) {
  const normalized = normalizeText(profileId);
  if (!normalized) {
    throw new Error('profile id is required');
  }
  const segments = normalized.split('.');
  if (segments.length !== 3) {
    throw new Error(
      `profile id must be <deploymentProfile>.<serviceLayout>.<environment>, received: ${profileId}`,
    );
  }
  const [deploymentProfile, serviceLayout, environment] = segments;
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
    .replaceAll('{serviceLayout}', serviceLayout)
    .replaceAll('{environment}', environment)}`;
}

export function listProfileIdsFromVocabulary(spec) {
  const deploymentProfiles =
    spec.vocabulary?.deploymentProfile?.allowed ?? spec.vocabulary?.hosting?.allowed ?? [];
  const serviceLayout = spec.vocabulary?.serviceLayout?.allowed ?? [];
  const environment = spec.vocabulary?.environment?.allowed ?? [];
  const profileIds = [];
  for (const deploymentProfile of deploymentProfiles) {
    for (const layout of serviceLayout) {
      for (const tier of environment) {
        profileIds.push(buildProfileId(deploymentProfile, layout, tier));
      }
    }
  }
  return profileIds;
}
