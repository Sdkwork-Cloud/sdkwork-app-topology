import { createResolvedRuntimePlan } from './plan-v5.mjs';
import { createTopologyRuntimeV2 } from './runtime-v2.mjs';

export function createTopologyRuntimeV5(spec, repoRoot, specPath) {
  const legacy = createTopologyRuntimeV2(spec, repoRoot);
  const {
    assertHosting: _assertHosting,
    assertServiceLayout: _assertServiceLayout,
    hostingValues: _hostingValues,
    serviceLayoutValues: _serviceLayoutValues,
    hostingKey: _hostingKey,
    serviceLayoutKey: _serviceLayoutKey,
    clientHostingKey: _clientHostingKey,
    ...runtime
  } = legacy;
  const v5 = {
    ...runtime,
    schemaVersion: 5,
    specPath,
    parseProfileId: legacy.parseProfileId,
  };
  return {
    ...v5,
    resolvePlan: (profileId, runtimeTarget, clientArchitecture = ({
      browser: 'pc-web',
      desktop: 'tauri',
      'capacitor-ios': 'capacitor',
      'capacitor-android': 'capacitor',
      'flutter-ios': 'flutter',
      'flutter-android': 'flutter',
      'android-native': 'android-native',
      'ios-native': 'ios-native',
      'harmony-native': 'harmony-native',
      'mini-program': 'mini-program',
    }[runtimeTarget] ?? null)) => createResolvedRuntimePlan(v5, profileId, runtimeTarget, clientArchitecture),
  };
}
