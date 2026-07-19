import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createTopologyRuntime,
  loadTopologySpec,
  mergeRuntimeEnv,
  validateTopologySpec,
} from '../tools/topology/lib/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frameworkRoot = path.resolve(__dirname, '..');

test('loads and validates sdkwork-drive example spec', () => {
  const specPath = path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json');
  const spec = loadTopologySpec(specPath);
  assert.equal(spec.appId, 'sdkwork-drive');
  assert.equal(spec.schemaVersion, 5);
  assert.deepEqual(spec.vocabulary.deploymentProfile.allowed, ['standalone', 'cloud']);
});

test('createTopologyRuntime loads standalone development profile keys', () => {
  const specPath = path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json');
  const spec = loadTopologySpec(specPath);
  const runtime = createTopologyRuntime(spec, frameworkRoot, specPath);
  const profile = runtime.loadProfile('standalone.development');
  assert.equal(profile.SDKWORK_DRIVE_DEPLOYMENT_PROFILE, 'standalone');
  assert.equal(profile.SDKWORK_DRIVE_APPLICATION_PUBLIC_HTTP_URL, 'http://127.0.0.1:3900');
});

test('applyTopologyEnv injects topology keys', () => {
  const spec = loadTopologySpec(path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json'));
  const runtime = createTopologyRuntime(spec, frameworkRoot, path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json'));
  const env = runtime.applyProfileEnv('cloud.development', [mergeRuntimeEnv({ FOO: 'bar' })]);
  assert.equal(env.SDKWORK_DRIVE_DEPLOYMENT_PROFILE, 'cloud');
  assert.equal(env.VITE_SDKWORK_DRIVE_DEPLOYMENT_PROFILE, 'cloud');
  assert.equal(env.FOO, 'bar');
});

test('resolveGatewayBind respects standalone and cloud binds', () => {
  const spec = loadTopologySpec(path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json'));
  const runtime = createTopologyRuntime(spec, frameworkRoot, path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json'));
  assert.equal(
    runtime.resolveGatewayBind({ SDKWORK_DRIVE_APPLICATION_PUBLIC_INGRESS_BIND: '127.0.0.1:3910' }, 'standalone'),
    '127.0.0.1:3910',
  );
  assert.equal(
    runtime.resolveGatewayBind({ SDKWORK_API_CLOUD_GATEWAY_BIND: '127.0.0.1:3920' }, 'cloud'),
    '127.0.0.1:3920',
  );
});

test('loads the sdkwork-drive v5 topology spec and profile', () => {
  const driveRoot = path.resolve(frameworkRoot, '../sdkwork-drive');
  const spec = loadTopologySpec(path.join(driveRoot, 'specs/topology.spec.json'));
  assert.equal(spec.schemaVersion, 5);
  assert.equal(spec.archetype, 'application-http-gateway');
  const runtime = createTopologyRuntime(spec, driveRoot);
  const profile = runtime.loadProfile('standalone.development');
  assert.equal(profile.SDKWORK_DRIVE_DEPLOYMENT_PROFILE, 'standalone');
  assert.equal(profile.VITE_DRIVE_PC_PLATFORM_API_GATEWAY_HTTP_URL, 'http://127.0.0.1:3900');
});

test('v4 topology supports SDKWork v4 two-segment profile ids', () => {
  const spec = validateTopologySpec({
    schemaVersion: 4,
    kind: 'sdkwork.app.topology',
    appId: 'sdkwork-games',
    archetype: 'application-http-gateway',
    profileRoot: 'etc/topology',
    profilePattern: '{deploymentProfile}.{environment}.env',
    vocabulary: {
      deploymentProfile: { allowed: ['standalone', 'cloud'] },
      environment: { allowed: ['development', 'production'] },
    },
    defaults: {
      developmentProfileId: 'standalone.development',
      productionProfileId: 'cloud.production',
      desktopBuildProfileId: 'standalone.production',
    },
    profileFiles: {
      'standalone.development': 'etc/topology/standalone.development.env',
      'cloud.production': 'etc/topology/cloud.production.env',
    },
    envKeys: {
      deploymentProfile: 'SDKWORK_GAMES_DEPLOYMENT_PROFILE',
      environment: 'SDKWORK_GAMES_ENVIRONMENT',
      profileId: 'SDKWORK_GAMES_PROFILE_ID',
      clientDeploymentProfile: 'VITE_SDKWORK_GAMES_DEPLOYMENT_PROFILE',
    },
    surfaces: {
      'application.public-ingress': {
        connectivityPlane: 'application',
        protocols: ['http'],
        bindEnv: 'SDKWORK_GAMES_APPLICATION_PUBLIC_INGRESS_BIND',
        httpUrlEnv: 'SDKWORK_GAMES_APPLICATION_PUBLIC_HTTP_URL',
      },
    },
  });
  const runtime = createTopologyRuntime(spec, frameworkRoot);
  const env = runtime.applyProfileEnv('cloud.production');

  assert.equal(runtime.assertProfileId('cloud.production'), 'cloud.production');
  assert.deepEqual(runtime.parseProfileId('cloud.production'), {
    deploymentProfile: 'cloud',
    serviceLayout: undefined,
    environment: 'production',
    profileId: 'cloud.production',
    hosting: 'cloud',
  });
  assert.equal(env.SDKWORK_GAMES_DEPLOYMENT_PROFILE, 'cloud');
  assert.equal(env.SDKWORK_GAMES_ENVIRONMENT, 'production');
  assert.equal(env.SDKWORK_GAMES_PROFILE_ID, 'cloud.production');
  assert.equal(env.VITE_SDKWORK_GAMES_DEPLOYMENT_PROFILE, 'cloud');
  assert.equal(env.SDKWORK_GAMES_SERVICE_LAYOUT, undefined);
});

test('resolveIamDevEnv injects application bootstrap roots from repo root', () => {
  const driveRoot = path.resolve(frameworkRoot, '../sdkwork-drive');
  const spec = loadTopologySpec(path.join(driveRoot, 'specs/topology.spec.json'));
  const runtime = createTopologyRuntime(spec, driveRoot);
  const env = runtime.resolveIamDevEnv({});
  assert.equal(env.SDKWORK_APP_ROOT, driveRoot);
  assert.equal(env.SDKWORK_IAM_APP_ROOT, driveRoot);
  assert.equal(env.SDKWORK_DRIVE_APP_ROOT, driveRoot);
});

test('loads sdkwork-im v5 topology spec and resolves standalone and cloud surfaces', () => {
  const imRoot = path.resolve(frameworkRoot, '../sdkwork-im');
  const spec = loadTopologySpec(path.join(imRoot, 'specs/topology.spec.json'));
  assert.equal(spec.schemaVersion, 5);
  assert.equal(spec.archetype, 'realtime-application-platform');
  assert.equal(spec.cloudIngress.strategy, 'platform-collapsed');
  const runtime = createTopologyRuntime(spec, imRoot);
  const profile = runtime.loadProfile('standalone.development');
  assert.equal(
    runtime.resolveSurfaceHttpUrl(profile, 'application.public-ingress'),
    'http://127.0.0.1:18079',
  );
  assert.equal(
    runtime.resolveSurfaceHttpUrl(profile, 'platform.api-gateway'),
    'http://127.0.0.1:18079',
  );
  assert.equal(
    runtime.resolveSurfaceWebsocketOrigin(profile, 'application.public-ingress'),
    'ws://127.0.0.1:18079',
  );
  const cloudProfile = runtime.loadProfile('cloud.development');
  assert.equal(
    runtime.resolveSurfaceHttpUrl(cloudProfile, 'application.public-ingress'),
    'https://api-dev.sdkwork.com',
  );
  assert.equal(
    runtime.resolveSurfaceHttpUrl(cloudProfile, 'platform.api-gateway'),
    'https://api-dev.sdkwork.com',
  );
  assert.deepEqual(
    runtime.resolvePlan('standalone.development', 'browser', 'h5').localProcesses.map((entry) => entry.id),
    ['standalone-gateway', 'im-h5'],
  );
  assert.deepEqual(
    runtime.resolvePlan('cloud.development', 'browser', 'h5').localProcesses.map((entry) => entry.id),
    ['im-h5'],
  );
});
