import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  WEB_DEVICE_CLASSES,
  createAdaptiveWebServer,
  detectWebDeviceClass,
  matchCanonicalApiPath,
  resolveAvailableWebClient,
  webClientFallbackOrder,
} from '../tools/topology/lib/adaptive-web.mjs';

const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0';
const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 Chrome/136.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
];

test('classifies desktop and mobile user agents per the shared adaptive contract', () => {
  for (const userAgent of MOBILE_USER_AGENTS.slice(0, 2)) {
    assert.equal(detectWebDeviceClass({ userAgent }), WEB_DEVICE_CLASSES.MOBILE);
  }
  assert.equal(detectWebDeviceClass({ userAgent: DESKTOP_USER_AGENT }), WEB_DEVICE_CLASSES.DESKTOP);
  assert.equal(detectWebDeviceClass({}), WEB_DEVICE_CLASSES.DESKTOP);
});

test('iPad defaults to desktop unless the delivery maps tablets to h5', () => {
  const ipad = MOBILE_USER_AGENTS[2];
  assert.equal(detectWebDeviceClass({ userAgent: ipad }), WEB_DEVICE_CLASSES.DESKTOP);
  assert.equal(
    detectWebDeviceClass({ userAgent: ipad, tablet: 'h5' }),
    WEB_DEVICE_CLASSES.MOBILE,
  );
});

test('Sec-CH-UA-Mobile client hint selects mobile before the user agent', () => {
  assert.equal(
    detectWebDeviceClass({ userAgent: DESKTOP_USER_AGENT, secChUaMobile: '?1' }),
    WEB_DEVICE_CLASSES.MOBILE,
  );
  assert.equal(
    detectWebDeviceClass({ userAgent: DESKTOP_USER_AGENT, secChUaMobile: '?0' }),
    WEB_DEVICE_CLASSES.DESKTOP,
  );
});

test('declarative overrides win before every other detection rule', () => {
  const overrides = [{ pattern: 'SdkworkDesktopClient', deviceClass: 'mobile' }];
  assert.equal(
    detectWebDeviceClass({ userAgent: 'SdkworkDesktopClient/1.0', overrides }),
    WEB_DEVICE_CLASSES.MOBILE,
  );
  assert.equal(
    detectWebDeviceClass({ userAgent: DESKTOP_USER_AGENT, overrides }),
    WEB_DEVICE_CLASSES.DESKTOP,
  );
});

test('falls back in both directions when the preferred renderer is unavailable', () => {
  assert.equal(
    resolveAvailableWebClient({
      deviceClass: WEB_DEVICE_CLASSES.MOBILE,
      availableClients: ['pc-web'],
      clientArchitectures: ['pc-web', 'h5'],
    }),
    'pc-web',
  );
  assert.equal(
    resolveAvailableWebClient({
      deviceClass: WEB_DEVICE_CLASSES.DESKTOP,
      availableClients: ['h5'],
      clientArchitectures: ['pc-web', 'h5'],
    }),
    'h5',
  );
  assert.equal(
    resolveAvailableWebClient({
      deviceClass: WEB_DEVICE_CLASSES.MOBILE,
      availableClients: [],
      clientArchitectures: ['pc-web', 'h5'],
    }),
    undefined,
  );
  assert.deepEqual(
    webClientFallbackOrder(WEB_DEVICE_CLASSES.MOBILE, ['pc-web', 'h5']),
    ['h5', 'pc-web'],
  );
  assert.deepEqual(
    webClientFallbackOrder(WEB_DEVICE_CLASSES.DESKTOP, ['pc-web', 'h5']),
    ['pc-web', 'h5'],
  );
  assert.deepEqual(
    webClientFallbackOrder(WEB_DEVICE_CLASSES.MOBILE, ['pc-web']),
    ['pc-web'],
  );
});

test('recognizes canonical API paths before renderer routing', () => {
  for (const path of [
    '/api/health',
    '/app/v3/api/auth/sessions',
    '/backend/v2/api/conversations',
    '/im/v3/api/realtime/ws',
    '/open/v1/api/users',
    '/healthz',
    '/livez',
    '/readyz',
    '/metrics',
    '/openapi.json',
  ]) {
    assert.equal(matchCanonicalApiPath(path), true, path);
  }
  for (const path of ['/', '/workspace/inbox', '/chat/123', '/node_modules/.vite/deps/x.js']) {
    assert.equal(matchCanonicalApiPath(path), false, path);
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(new URL(`http://127.0.0.1:${address.port}`));
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function markerServer(marker) {
  return http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`${marker}:${request.url}`);
  });
}

function fetchText(origin, requestPath, userAgent, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(new URL(requestPath, origin), {
      headers: { 'user-agent': userAgent, ...extraHeaders },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: response.headers,
        statusCode: response.statusCode,
      }));
    });
    request.setTimeout(5_000, () => request.destroy(new Error('request timed out')));
    request.once('error', reject);
  });
}

function renderersByArchitecture(pcTarget, h5Target) {
  return new Map([
    ['pc-web', { architecture: 'pc-web', label: 'sdkwork-im-pc', ready: true, target: pcTarget }],
    ['h5', { architecture: 'h5', label: 'sdkwork-im-h5', ready: true, target: h5Target }],
  ]);
}

test('routes one browser origin by device class while keeping API paths on the application ingress', async (t) => {
  const pcServer = markerServer('pc');
  const h5Server = markerServer('h5');
  const apiServer = markerServer('api');
  const pcTarget = await listen(pcServer);
  const h5Target = await listen(h5Server);
  const apiTarget = await listen(apiServer);
  const renderers = renderersByArchitecture(pcTarget, h5Target);
  const ingress = createAdaptiveWebServer({
    apiTarget,
    renderers,
    deliveryLabel: 'test-adaptive',
  });
  const ingressOrigin = await listen(ingress);

  t.after(async () => Promise.all([
    close(ingress),
    close(pcServer),
    close(h5Server),
    close(apiServer),
  ]));

  const desktop = await fetchText(ingressOrigin, '/workspace/inbox', DESKTOP_USER_AGENT);
  assert.equal(desktop.body, 'pc:/workspace/inbox');
  assert.equal(desktop.headers.vary, 'user-agent');

  const mobile = await fetchText(ingressOrigin, '/workspace/inbox', 'iPhone Mobile');
  assert.equal(mobile.body, 'h5:/workspace/inbox');
  assert.equal(mobile.headers.vary, 'user-agent');

  const hinted = await fetchText(
    ingressOrigin,
    '/workspace/inbox',
    DESKTOP_USER_AGENT,
    { 'sec-ch-ua-mobile': '?1' },
  );
  assert.equal(hinted.body, 'h5:/workspace/inbox');

  const canonicalViteDependency = await fetchText(
    ingressOrigin,
    '/node_modules/.vite/sdkwork-im-pc/deps/dompurify.js?v=current',
    DESKTOP_USER_AGENT,
  );
  assert.equal(
    canonicalViteDependency.body,
    'pc:/node_modules/.vite/sdkwork-im-pc/deps/dompurify.js?v=current',
  );

  const staleViteDependency = await fetchText(
    ingressOrigin,
    '/node_modules/.vite/deps/dompurify.js?v=stale',
    DESKTOP_USER_AGENT,
  );
  assert.equal(staleViteDependency.statusCode, 410);
  assert.match(staleViteDependency.headers['content-type'], /^text\/plain/u);
  assert.equal(staleViteDependency.headers['cache-control'], 'no-store');
  assert.equal(staleViteDependency.headers.vary, 'user-agent');
  assert.doesNotMatch(staleViteDependency.body, /<html/u);

  // A Vite dependency cache URL is routed to the renderer that owns the cache
  // label, regardless of the device-preferred renderer: the browser module
  // graph may legitimately reference another renderer's cache (e.g. after a
  // renderer restart or while the preferred renderer is unavailable), and
  // hard-failing with 410 would leave the loaded page broken until reload.
  const desktopH5Cache = await fetchText(
    ingressOrigin,
    '/node_modules/.vite/sdkwork-im-h5/deps/zustand.js?v=current',
    DESKTOP_USER_AGENT,
  );
  assert.equal(
    desktopH5Cache.body,
    'h5:/node_modules/.vite/sdkwork-im-h5/deps/zustand.js?v=current',
  );

  const mobilePcCache = await fetchText(
    ingressOrigin,
    '/node_modules/.vite/sdkwork-im-pc/deps/react.js?v=current',
    'iPhone Mobile',
  );
  assert.equal(
    mobilePcCache.body,
    'pc:/node_modules/.vite/sdkwork-im-pc/deps/react.js?v=current',
  );

  const api = await fetchText(
    ingressOrigin,
    '/im/v3/api/realtime/ws?transport=polling',
    'iPhone Mobile',
  );
  assert.equal(api.body, 'api:/im/v3/api/realtime/ws?transport=polling');
  assert.equal(api.headers.vary, undefined);

  renderers.get('h5').ready = false;
  const mobileFallback = await fetchText(ingressOrigin, '/', 'iPhone Mobile');
  assert.equal(mobileFallback.body, 'pc:/');
  assert.equal(mobileFallback.headers.vary, 'user-agent');
});

test('survives a renderer resetting the connection mid-response', async (t) => {
  const resetServer = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.write('<html>partial');
    response.destroy();
  });
  const h5Server = markerServer('h5');
  const apiServer = markerServer('api');
  const resetTarget = await listen(resetServer);
  const h5Target = await listen(h5Server);
  const apiTarget = await listen(apiServer);
  const renderers = renderersByArchitecture(resetTarget, h5Target);
  const ingress = createAdaptiveWebServer({
    apiTarget,
    renderers,
    deliveryLabel: 'test-adaptive',
  });
  const ingressOrigin = await listen(ingress);

  t.after(async () => Promise.all([
    close(ingress),
    close(resetServer),
    close(h5Server),
    close(apiServer),
  ]));

  await fetchText(ingressOrigin, '/', DESKTOP_USER_AGENT).catch(() => undefined);
  const afterReset = await fetchText(ingressOrigin, '/', 'iPhone Mobile');
  assert.equal(afterReset.body, 'h5:/');
  assert.equal(afterReset.statusCode, 200);
});

test('falls back to H5 when a ready PC renderer becomes unreachable', async (t) => {
  const unavailableServer = markerServer('unavailable');
  const unavailableTarget = await listen(unavailableServer);
  await close(unavailableServer);

  const h5Server = markerServer('h5-fallback');
  const h5Target = await listen(h5Server);
  const apiServer = markerServer('api');
  const apiTarget = await listen(apiServer);
  const renderers = renderersByArchitecture(unavailableTarget, h5Target);
  const ingress = createAdaptiveWebServer({
    apiTarget,
    renderers,
    deliveryLabel: 'test-adaptive',
  });
  const ingressOrigin = await listen(ingress);

  t.after(async () => Promise.all([
    close(ingress),
    close(h5Server),
    close(apiServer),
  ]));

  const response = await fetchText(ingressOrigin, '/', DESKTOP_USER_AGENT);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'h5-fallback:/');
  assert.equal(response.headers.vary, 'user-agent');
});
