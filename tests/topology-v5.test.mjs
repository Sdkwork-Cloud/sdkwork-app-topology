import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTopologyRuntime, validateTopologySpec } from '../tools/topology/lib/index.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdkwork-topology-v5-'));
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'etc', 'topology'), { recursive: true });
  const spec = {
    schemaVersion: 5,
    kind: 'sdkwork.app.topology',
    appId: 'sdkwork-demo',
    archetype: 'application-http-gateway',
    vocabulary: {
      deploymentProfile: { allowed: ['standalone', 'cloud'] },
      environment: { allowed: ['development', 'production'] },
    },
    cloudIngress: { strategy: 'platform-collapsed', platformGateway: 'sdkwork-api-cloud-gateway' },
    profileFiles: {
      'standalone.development': 'etc/topology/standalone.development.env',
      'cloud.development': 'etc/topology/cloud.development.env',
    },
    envKeys: {
      deploymentProfile: 'SDKWORK_DEMO_DEPLOYMENT_PROFILE',
      environment: 'SDKWORK_DEMO_ENVIRONMENT',
      profileId: 'SDKWORK_DEMO_PROFILE_ID',
    },
    surfaces: {
      'application.public-ingress': {
        connectivityPlane: 'application', bindEnv: 'APP_BIND', httpUrlEnv: 'APP_URL',
      },
      'platform.api-gateway': {
        connectivityPlane: 'platform', httpUrlEnv: 'PLATFORM_URL',
      },
    },
    orchestration: {
      profiles: {
        'standalone.development': {
          processes: [{ id: 'standalone-gateway', role: 'standalone-gateway', crate: 'sdkwork-demo-standalone-gateway' }],
          healthSurfaces: ['application.public-ingress'],
        },
        'cloud.development': {
          processes: [
            { id: 'web-client', role: 'client', script: '_sdkwork:client', runtimeTargets: ['browser'] },
            { id: 'desktop-client', role: 'client', script: '_sdkwork:desktop', runtimeTargets: ['desktop'] },
          ],
          healthSurfaces: ['application.public-ingress', 'platform.api-gateway'],
        },
      },
    },
  };
  const specPath = path.join(root, 'specs', 'topology.spec.json');
  fs.writeFileSync(specPath, JSON.stringify(spec));
  fs.writeFileSync(path.join(root, 'etc', 'topology', 'standalone.development.env'), [
    'SDKWORK_DEMO_PROFILE_ID=standalone.development',
    'APP_URL=http://127.0.0.1:8080',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'etc', 'topology', 'cloud.development.env'), [
    'SDKWORK_DEMO_PROFILE_ID=cloud.development',
    'APP_URL=https://api.dev.sdkwork.com/app',
    'PLATFORM_URL=https://api.dev.sdkwork.com',
    '',
  ].join('\n'));
  return { root, spec, specPath };
}

test('validates topology v5 and resolves a cloud development plan', () => {
  const { root, spec, specPath } = fixture();
  validateTopologySpec(spec, specPath);
  const runtime = createTopologyRuntime(spec, root, specPath);
  const plan = runtime.resolvePlan('cloud.development', 'browser');
  assert.equal(runtime.schemaVersion, 5);
  assert.equal(plan.localGateway, null);
  assert.deepEqual(plan.localProcesses.map((process) => process.id), ['web-client']);
  assert.deepEqual(plan.forbiddenProcesses, []);
  assert.deepEqual(plan.remoteSurfaces, ['application.public-ingress', 'platform.api-gateway']);
});

test('filters local processes by the selected runtime target', () => {
  const { root, spec, specPath } = fixture();
  const runtime = createTopologyRuntime(spec, root, specPath);
  const plan = runtime.resolvePlan('cloud.development', 'desktop');
  assert.deepEqual(plan.localProcesses.map((process) => process.id), ['desktop-client']);
  spec.orchestration.profiles['cloud.development'].processes[0].runtimeTargets = ['unknown'];
  assert.throws(() => validateTopologySpec(spec, specPath), /canonical runtime targets/u);
});

test('rejects retired service layouts and different collapsed origins', () => {
  const { root, spec, specPath } = fixture();
  spec.vocabulary.serviceLayout = { allowed: ['split-services'] };
  assert.throws(() => validateTopologySpec(spec, specPath), /retired/u);
  delete spec.vocabulary.serviceLayout;
  fs.writeFileSync(path.join(root, 'etc', 'topology', 'cloud.development.env'), [
    'SDKWORK_DEMO_PROFILE_ID=cloud.development',
    'APP_URL=https://app.dev.sdkwork.com',
    'PLATFORM_URL=https://api.dev.sdkwork.com',
    '',
  ].join('\n'));
  const runtime = createTopologyRuntime(spec, root, specPath);
  assert.throws(() => runtime.resolvePlan('cloud.development', 'browser'), /share one origin/u);
});

test('bundled topology v5 schema stays aligned with the canonical standards schema', () => {
  const bundled = JSON.parse(fs.readFileSync(path.resolve('specs/topology.schema.v5.json'), 'utf8'));
  const canonical = JSON.parse(fs.readFileSync(path.resolve('../sdkwork-specs/schemas/sdkwork.app.topology.schema.v5.json'), 'utf8'));
  assert.deepEqual(bundled, canonical);
});
