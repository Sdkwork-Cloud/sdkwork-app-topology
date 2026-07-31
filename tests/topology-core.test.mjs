import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

test('init-app emits a surface-oriented v5 topology without platform gateway ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-topology-init-'));
  const result = spawnSync(process.execPath, [
    path.join(frameworkRoot, 'scripts/sdkwork-topology.mjs'),
    'init-app',
    '--root', root,
    '--app-id', 'sdkwork-demo',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const spec = JSON.parse(fs.readFileSync(path.join(root, 'specs/topology.spec.json'), 'utf8'));
  assert.equal(spec.cloudIngress, undefined);
  assert.equal(spec.database, undefined);
  assert.equal(spec.applicationCode, 'demo');
  assert.equal(spec.envKeys.deploymentProfile, 'SDKWORK_DEMO_DEPLOYMENT_PROFILE');
  assert.equal(spec.components.cloudGateway, undefined);
  assert.equal(spec.surfaces['platform.api-gateway'].owner, undefined);
  assert.equal(spec.surfaces['platform.api-gateway'].autostartEnv, undefined);
  assert.equal(
    spec.orchestration.profiles['standalone.development'].processes[0].crate,
    'sdkwork-api-demo-standalone-gateway',
  );
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

test('resolveGatewayBind respects the application standalone bind', () => {
  const spec = loadTopologySpec(path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json'));
  const runtime = createTopologyRuntime(spec, frameworkRoot, path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json'));
  assert.equal(
    runtime.resolveGatewayBind({ SDKWORK_DRIVE_APPLICATION_PUBLIC_INGRESS_BIND: '127.0.0.1:3910' }, 'standalone'),
    '127.0.0.1:3910',
  );
});

test('loads the self-contained sdkwork-drive v5 topology spec and profile', () => {
  const specPath = path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json');
  const spec = loadTopologySpec(specPath);
  assert.equal(spec.schemaVersion, 5);
  assert.equal(spec.archetype, 'application-http-gateway');
  const runtime = createTopologyRuntime(spec, frameworkRoot, specPath);
  const profile = runtime.loadProfile('standalone.development');
  assert.equal(profile.SDKWORK_DRIVE_DEPLOYMENT_PROFILE, 'standalone');
  assert.equal(profile.SDKWORK_DRIVE_APPLICATION_PUBLIC_HTTP_URL, 'http://127.0.0.1:3900');
  assert.equal(profile.SDKWORK_DRIVE_PLATFORM_API_GATEWAY_HTTP_URL, undefined);
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
  const specPath = path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json');
  const spec = loadTopologySpec(specPath);
  const runtime = createTopologyRuntime(spec, frameworkRoot, specPath);
  const env = runtime.resolveIamDevEnv({});
  assert.equal(env.SDKWORK_APP_ROOT, frameworkRoot);
  assert.equal(env.SDKWORK_IAM_APP_ROOT, frameworkRoot);
  assert.equal(env.SDKWORK_DRIVE_APP_ROOT, frameworkRoot);
});

test('resolveIamDevEnv preserves process database governance controls', () => {
  const specPath = path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json');
  const spec = loadTopologySpec(specPath);
  const runtime = createTopologyRuntime(spec, frameworkRoot, specPath);
  const env = runtime.resolveIamDevEnv(
    {
      SDKWORK_DATABASE_TEMPORARY_ANY_POOL_EXCEPTION: 'true',
      SDKWORK_DATABASE_TEMPORARY_DRIVER_POOL_COUNT: '1',
      SDKWORK_DATABASE_URL: 'postgresql://discarded-runtime-identity',
    },
    { ensurePostgresEnvFile: false },
  );

  assert.equal(env.SDKWORK_DATABASE_TEMPORARY_ANY_POOL_EXCEPTION, 'true');
  assert.equal(env.SDKWORK_DATABASE_TEMPORARY_DRIVER_POOL_COUNT, '1');
  assert.notEqual(env.SDKWORK_DATABASE_URL, 'postgresql://discarded-runtime-identity');
});

test('resolves standalone and cloud surfaces from the self-contained v5 fixture', () => {
  const specPath = path.join(frameworkRoot, 'examples/sdkwork-drive/topology.spec.json');
  const spec = loadTopologySpec(specPath);
  assert.equal(spec.schemaVersion, 5);
  assert.equal(spec.archetype, 'application-http-gateway');
  const runtime = createTopologyRuntime(spec, frameworkRoot, specPath);
  const profile = runtime.loadProfile('standalone.development');
  assert.equal(
    runtime.resolveSurfaceHttpUrl(profile, 'application.public-ingress'),
    'http://127.0.0.1:3900',
  );
  assert.equal(
    runtime.resolveSurfaceHttpUrl(profile, 'platform.api-gateway'),
    undefined,
  );
  const cloudProfile = runtime.loadProfile('cloud.development');
  assert.equal(
    runtime.resolveSurfaceHttpUrl(cloudProfile, 'application.public-ingress'),
    'https://api.dev.sdkwork.com/drive',
  );
  assert.equal(
    runtime.resolveSurfaceHttpUrl(cloudProfile, 'platform.api-gateway'),
    'https://api.dev.sdkwork.com',
  );
  assert.deepEqual(
    runtime.resolvePlan('standalone.development', 'browser').localProcesses.map((entry) => entry.id),
    ['standalone-gateway'],
  );
  assert.deepEqual(
    runtime.resolvePlan('cloud.development', 'browser').localProcesses.map((entry) => entry.id),
    ['drive-browser'],
  );
});
