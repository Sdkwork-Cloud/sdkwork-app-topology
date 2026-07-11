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
  assert.deepEqual(spec.vocabulary.topology.allowed, ['standalone', 'cloud']);
});

test('createTopologyRuntime loads standalone development profile keys', () => {
  const exampleRoot = path.join(frameworkRoot, 'examples/sdkwork-drive');
  const spec = loadTopologySpec(path.join(exampleRoot, 'topology.spec.json'));
  const runtime = createTopologyRuntime(spec, exampleRoot);
  const profile = runtime.loadTopologyProfile('standalone', 'development');
  assert.equal(profile.SDKWORK_DRIVE_TOPOLOGY, 'standalone');
  assert.equal(profile.VITE_DRIVE_PC_API_GATEWAY_BASE_URL, 'http://127.0.0.1:3900');
});

test('applyTopologyEnv injects topology keys', () => {
  const spec = loadTopologySpec(path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json'));
  const runtime = createTopologyRuntime(spec, path.resolve(frameworkRoot, '../sdkwork-drive'));
  const env = runtime.applyTopologyEnv('cloud', [mergeRuntimeEnv({ FOO: 'bar' })]);
  assert.equal(env.SDKWORK_DRIVE_TOPOLOGY, 'cloud');
  assert.equal(env.VITE_DRIVE_PC_TOPOLOGY, 'cloud');
  assert.equal(env.FOO, 'bar');
});

test('resolveGatewayBind respects standalone and cloud binds', () => {
  const spec = loadTopologySpec(path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json'));
  const runtime = createTopologyRuntime(spec, path.resolve(frameworkRoot, '../sdkwork-drive'));
  assert.equal(
    runtime.resolveGatewayBind({ SDKWORK_DRIVE_STANDALONE_GATEWAY_BIND: '127.0.0.1:3910' }, 'standalone'),
    '127.0.0.1:3910',
  );
  assert.equal(
    runtime.resolveGatewayBind({ SDKWORK_API_CLOUD_GATEWAY_BIND: '127.0.0.1:3920' }, 'cloud'),
    '127.0.0.1:3920',
  );
});

test('loads sdkwork-drive v4 topology spec and profile', () => {
  const driveRoot = path.resolve(frameworkRoot, '../sdkwork-drive');
  const spec = loadTopologySpec(path.join(driveRoot, 'specs/topology.spec.json'));
  assert.equal(spec.schemaVersion, 4);
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
    profileRoot: 'configs/topology',
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
      'standalone.development': 'configs/topology/standalone.development.env',
      'cloud.production': 'configs/topology/cloud.production.env',
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

test('loads sdkwork-im v4 topology spec and resolves surfaces', () => {
  const imRoot = path.resolve(frameworkRoot, '../sdkwork-im');
  const spec = loadTopologySpec(path.join(imRoot, 'specs/topology.spec.json'));
  assert.equal(spec.schemaVersion, 4);
  assert.equal(spec.archetype, 'realtime-application-platform');
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
});
