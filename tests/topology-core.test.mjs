import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createTopologyRuntime,
  loadTopologySpec,
  mergeRuntimeEnv,
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

test('loads sdkwork-drive v2 topology spec and profile', () => {
  const driveRoot = path.resolve(frameworkRoot, '../sdkwork-drive');
  const spec = loadTopologySpec(path.join(driveRoot, 'specs/topology.spec.json'));
  assert.equal(spec.schemaVersion, 2);
  assert.equal(spec.archetype, 'application-http-gateway');
  const runtime = createTopologyRuntime(spec, driveRoot);
  const profile = runtime.loadProfile('standalone.split-services.development');
  assert.equal(profile.SDKWORK_DRIVE_DEPLOYMENT_PROFILE, 'standalone');
  assert.equal(profile.VITE_DRIVE_PC_PLATFORM_API_GATEWAY_HTTP_URL, 'http://127.0.0.1:3900');
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

test('loads sdkwork-im v2 topology spec and resolves surfaces', () => {
  const imRoot = path.resolve(frameworkRoot, '../sdkwork-im');
  const spec = loadTopologySpec(path.join(imRoot, 'specs/topology.spec.json'));
  assert.equal(spec.archetype, 'realtime-application-platform');
  const runtime = createTopologyRuntime(spec, imRoot);
  const profile = runtime.loadProfile('standalone.split-services.development');
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
