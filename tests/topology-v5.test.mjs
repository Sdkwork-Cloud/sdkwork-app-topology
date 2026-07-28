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
          processes: [
            { id: 'standalone-gateway', role: 'api-standalone-gateway', crate: 'sdkwork-demo-standalone-gateway' },
            {
              id: 'web-client',
              role: 'client',
              script: '_sdkwork:client',
              bindEnv: 'WEB_BIND',
              runtimeTargets: ['browser'],
              clientArchitectures: ['pc-web'],
            },
          ],
          browserDeliveries: [
            {
              id: 'web-client',
              applicationRoot: 'apps/sdkwork-demo-pc',
              clientArchitectures: ['pc-web'],
              originMode: 'same-origin',
              deliveryMode: 'dev-server-proxy',
              apiSurfaceId: 'application.public-ingress',
              clientProcessId: 'web-client',
              preserveCanonicalPaths: true,
            },
          ],
          accessEndpoints: [
            {
              id: 'application-ui',
              kind: 'user-interface',
              source: { processId: 'web-client' },
              path: '/',
              primary: true,
              runtimeTargets: ['browser'],
              clientArchitectures: ['pc-web'],
            },
            {
              id: 'application-api-reference',
              kind: 'api-reference',
              source: { surfaceId: 'application.public-ingress' },
              path: '/openapi.json',
              runtimeTargets: ['browser'],
            },
          ],
          healthSurfaces: ['application.public-ingress'],
        },
        'cloud.development': {
          processes: [
            { id: 'web-client', role: 'client', script: '_sdkwork:client', runtimeTargets: ['browser'], clientArchitectures: ['pc-web'] },
            { id: 'h5-client', role: 'client', script: '_sdkwork:h5', runtimeTargets: ['browser'], clientArchitectures: ['h5'] },
            { id: 'desktop-client', role: 'client', script: '_sdkwork:desktop', runtimeTargets: ['desktop'], clientArchitectures: ['tauri'] },
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
    'WEB_BIND=0.0.0.0:4173',
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

test('resolves declared process and surface access endpoints into the runtime plan', () => {
  const { root, spec, specPath } = fixture();
  const runtime = createTopologyRuntime(spec, root, specPath);
  const plan = runtime.resolvePlan('standalone.development', 'browser');

  assert.deepEqual(plan.accessEndpoints.map((endpoint) => ({
    id: endpoint.id,
    kind: endpoint.kind,
    primary: endpoint.primary,
    url: endpoint.url,
    binding: endpoint.binding?.value ?? null,
  })), [
    {
      id: 'application-ui',
      kind: 'user-interface',
      primary: true,
      url: 'http://127.0.0.1:4173/',
      binding: '0.0.0.0:4173',
    },
    {
      id: 'application-api-reference',
      kind: 'api-reference',
      primary: false,
      url: 'http://127.0.0.1:8080/openapi.json',
      binding: null,
    },
  ]);
  assert.equal(plan.primaryAccessEndpoint.id, 'application-ui');
  assert.deepEqual(plan.browserDeliveries, [
    {
      id: 'web-client',
      applicationRoot: 'apps/sdkwork-demo-pc',
      clientArchitectures: ['pc-web'],
      originMode: 'same-origin',
      deliveryMode: 'dev-server-proxy',
      apiSurfaceId: 'application.public-ingress',
      browserVisibleOrigin: 'http://127.0.0.1:4173',
      apiTargetOrigin: 'http://127.0.0.1:8080',
      clientProcessId: 'web-client',
      preserveCanonicalPaths: true,
    },
  ]);
});

test('resolves gateway-static browser delivery to the application ingress origin', () => {
  const { root, spec, specPath } = fixture();
  spec.profileFiles['standalone.production'] = 'etc/topology/standalone.production.env';
  spec.orchestration.profiles['standalone.production'] = {
    processes: [
      { id: 'standalone-gateway', role: 'api-standalone-gateway' },
    ],
    browserDeliveries: [
      {
        id: 'web-client',
        applicationRoot: 'apps/sdkwork-demo-pc',
        clientArchitectures: ['pc-web'],
        originMode: 'same-origin',
        deliveryMode: 'gateway-static',
        apiSurfaceId: 'application.public-ingress',
        hostProcessId: 'standalone-gateway',
        buildOutput: 'apps/sdkwork-demo-pc/dist',
        runtimeRootEnv: 'SDKWORK_DEMO_PC_STATIC_ROOT',
        mountPath: '/',
        spaFallback: '/index.html',
      },
    ],
  };
  fs.writeFileSync(path.join(root, 'etc', 'topology', 'standalone.production.env'), [
    'SDKWORK_DEMO_PROFILE_ID=standalone.production',
    'APP_URL=https://demo.example.com',
    'SDKWORK_DEMO_PC_STATIC_ROOT=share/sdkwork/demo-pc',
    '',
  ].join('\n'));

  validateTopologySpec(spec, specPath);
  const runtime = createTopologyRuntime(spec, root, specPath);
  assert.deepEqual(runtime.resolvePlan('standalone.production', 'browser').browserDeliveries, [
    {
      id: 'web-client',
      applicationRoot: 'apps/sdkwork-demo-pc',
      clientArchitectures: ['pc-web'],
      originMode: 'same-origin',
      deliveryMode: 'gateway-static',
      apiSurfaceId: 'application.public-ingress',
      browserVisibleOrigin: 'https://demo.example.com',
      apiTargetOrigin: 'https://demo.example.com',
      hostProcessId: 'standalone-gateway',
      buildOutput: 'apps/sdkwork-demo-pc/dist',
      runtimeRootEnv: 'SDKWORK_DEMO_PC_STATIC_ROOT',
      runtimeRoot: 'share/sdkwork/demo-pc',
      mountPath: '/',
      spaFallback: '/index.html',
    },
  ]);
});

test('rejects a dev browser delivery whose architecture drifts from its client process', () => {
  const { spec, specPath } = fixture();
  spec.orchestration.profiles['standalone.development'].browserDeliveries[0].clientArchitectures = ['h5'];
  assert.throws(
    () => validateTopologySpec(spec, specPath),
    /clientArchitectures must match its client process/u,
  );
});

test('rejects browser delivery modes that conflict with the standalone lifecycle profile', () => {
  const development = fixture();
  development.spec.orchestration.profiles['standalone.development']
    .browserDeliveries[0].deliveryMode = 'gateway-static';
  assert.throws(
    () => validateTopologySpec(development.spec, development.specPath),
    /standalone\.development browser delivery .* must use dev-server-proxy/u,
  );

  const production = fixture();
  production.spec.profileFiles['standalone.production'] =
    'etc/topology/standalone.production.env';
  production.spec.orchestration.profiles['standalone.production'] = {
    processes: [
      { id: 'standalone-gateway', role: 'api-standalone-gateway' },
    ],
    browserDeliveries: [
      {
        id: 'web-client',
        applicationRoot: 'apps/sdkwork-demo-pc',
        clientArchitectures: ['pc-web'],
        originMode: 'same-origin',
        deliveryMode: 'dev-server-proxy',
        apiSurfaceId: 'application.public-ingress',
        clientProcessId: 'web-client',
        preserveCanonicalPaths: true,
      },
    ],
  };
  assert.throws(
    () => validateTopologySpec(production.spec, production.specPath),
    /standalone\.production browser delivery .* must use gateway-static/u,
  );
});

test('rejects non-HTTP application ingress origins in resolved browser deliveries', () => {
  const { root, spec, specPath } = fixture();
  const runtime = createTopologyRuntime(spec, root, specPath);
  const profileEnv = runtime.loadProfile('standalone.development');
  assert.throws(
    () => runtime.resolvePlan('standalone.development', 'browser', 'pc-web', {
      profileEnv: { ...profileEnv, APP_URL: 'file:///tmp/sdkwork-web' },
    }),
    /API target must resolve to an absolute HTTP\(S\) URL/u,
  );
});

test('resolves access endpoints from the effective profile environment', () => {
  const { root, spec, specPath } = fixture();
  const runtime = createTopologyRuntime(spec, root, specPath);
  const profileEnv = runtime.loadProfile('standalone.development');
  const plan = runtime.resolvePlan('standalone.development', 'browser', 'pc-web', {
    profileEnv: { ...profileEnv, WEB_BIND: '127.0.0.1:4199' },
  });

  assert.equal(plan.primaryAccessEndpoint.url, 'http://127.0.0.1:4199/');
  assert.equal(plan.primaryAccessEndpoint.binding.value, '127.0.0.1:4199');
});

test('validates access endpoint references and selected primary uniqueness', () => {
  const { root, spec, specPath } = fixture();
  spec.orchestration.profiles['standalone.development'].accessEndpoints[0].source = {
    processId: 'missing-client',
  };
  assert.throws(
    () => validateTopologySpec(spec, specPath),
    /references unknown process missing-client/u,
  );

  spec.orchestration.profiles['standalone.development'].accessEndpoints[0].source = {
    processId: 'web-client',
  };
  spec.orchestration.profiles['standalone.development'].accessEndpoints[1].primary = true;
  const runtime = createTopologyRuntime(spec, root, specPath);
  assert.throws(
    () => runtime.resolvePlan('standalone.development', 'browser'),
    /multiple primary access endpoints/u,
  );
});

test('filters browser clients by selected client architecture', () => {
  const { root, spec, specPath } = fixture();
  const runtime = createTopologyRuntime(spec, root, specPath);
  assert.deepEqual(
    runtime.resolvePlan('cloud.development', 'browser', 'h5').localProcesses.map((process) => process.id),
    ['h5-client'],
  );
  spec.orchestration.profiles['cloud.development'].processes[1].clientArchitectures = ['unknown'];
  assert.throws(() => validateTopologySpec(spec, specPath), /canonical client architectures/u);
});

test('accepts declared edge runtimes only outside cloud development', () => {
  const { spec, specPath } = fixture();
  const edgeRuntime = {
    id: 'edge.device-ingress',
    role: 'edge-runtime',
    script: '_sdkwork:runtime:device-edge',
    decisionRef: 'docs/architecture/decisions/ADR-001-device-edge.md',
  };
  spec.orchestration.profiles['standalone.development'].processes.push(edgeRuntime);
  assert.doesNotThrow(() => validateTopologySpec(spec, specPath));

  spec.orchestration.profiles['standalone.development'].processes.pop();
  spec.orchestration.profiles['cloud.development'].processes.push(edgeRuntime);
  assert.throws(
    () => validateTopologySpec(spec, specPath),
    /cloud\.development forbids local process role edge-runtime/u,
  );
});

test('rejects retired api-listener roles and ambiguous edge runtime declarations', () => {
  const { spec, specPath } = fixture();
  spec.orchestration.profiles['standalone.development'].processes.push({
    id: 'legacy-api',
    role: 'api-listener',
  });
  assert.throws(() => validateTopologySpec(spec, specPath), /requires a canonical role/u);

  spec.orchestration.profiles['standalone.development'].processes.pop();
  spec.orchestration.profiles['standalone.development'].processes.push({
    id: 'edge.device-ingress',
    role: 'edge-runtime',
    script: '_sdkwork:gateway:device-edge',
  });
  assert.throws(
    () => validateTopologySpec(spec, specPath),
    /requires an _sdkwork:runtime:\* script/u,
  );
});

test('rejects retired service layouts and allows independent remote surface origins', () => {
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
  const plan = runtime.resolvePlan('cloud.development', 'browser');
  assert.equal(plan.resolvedBaseUrls['application.public-ingress'], 'https://app.dev.sdkwork.com');
  assert.equal(plan.resolvedBaseUrls['platform.api-gateway'], 'https://api.dev.sdkwork.com');
});

test('rejects platform gateway URLs from standalone profiles', () => {
  const { root, spec, specPath } = fixture();
  fs.writeFileSync(path.join(root, 'etc', 'topology', 'standalone.development.env'), [
    'SDKWORK_DEMO_PROFILE_ID=standalone.development',
    'APP_URL=http://127.0.0.1:8080',
    'PLATFORM_URL=http://127.0.0.1:3900',
    '',
  ].join('\n'));
  const runtime = createTopologyRuntime(spec, root, specPath);
  assert.throws(
    () => runtime.resolvePlan('standalone.development', 'server'),
    /standalone\.development forbids platform\.api-gateway URL key PLATFORM_URL/u,
  );
});

test('bundled topology v5 schema stays aligned with the canonical standards schema', () => {
  const bundled = JSON.parse(fs.readFileSync(path.resolve('specs/topology.schema.v5.json'), 'utf8'));
  const canonical = JSON.parse(fs.readFileSync(path.resolve('../sdkwork-specs/schemas/sdkwork.app.topology.schema.v5.json'), 'utf8'));
  assert.deepEqual(bundled, canonical);
});
