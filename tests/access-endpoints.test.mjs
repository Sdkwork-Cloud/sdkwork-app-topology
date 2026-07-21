import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatAccessEndpointCatalogLines,
  formatPrimaryAccessLines,
  resolveAccessEndpointReports,
} from '../tools/topology/lib/access-endpoints.mjs';

const plan = {
  accessEndpoints: [
    {
      id: 'application-ui',
      kind: 'user-interface',
      primary: true,
      path: '/',
      url: 'http://127.0.0.1:4173/',
      binding: { host: '0.0.0.0', port: 4173, value: '0.0.0.0:4173' },
    },
    {
      id: 'application-api-reference',
      kind: 'api-reference',
      primary: false,
      path: '/openapi.json',
      url: 'https://api.example.com/openapi.json',
      binding: null,
    },
  ],
};

const networkInterfaces = {
  Ethernet: [
    { family: 'IPv4', address: '192.168.50.12', internal: false },
    { family: 'IPv4', address: '127.0.0.1', internal: true },
  ],
};

test('projects declared access endpoints to deterministic local and network URLs', () => {
  const reports = resolveAccessEndpointReports(plan, { networkInterfaces });
  assert.deepEqual(reports[0].allUrls, [
    'http://127.0.0.1:4173/',
    'http://192.168.50.12:4173/',
  ]);
  assert.deepEqual(reports[1].allUrls, [
    'https://api.example.com/openapi.json',
  ]);
});

test('formats the primary access endpoint without application-specific inference', () => {
  assert.deepEqual(formatPrimaryAccessLines(plan, {
    networkInterfaces,
    prefix: '[demo] ',
    statusText: 'application started successfully',
  }), [
    '[demo] application started successfully',
    '[demo] Access URLs',
    '[demo]   Local: http://127.0.0.1:4173/',
    '[demo]   Network: http://192.168.50.12:4173/',
  ]);
});

test('formats a typed endpoint catalog from the resolved plan', () => {
  assert.deepEqual(formatAccessEndpointCatalogLines(plan, { prefix: '[demo] ' }), [
    '[demo] Access Endpoints',
    '[demo]   Application: http://127.0.0.1:4173/',
    '[demo]   API Reference: https://api.example.com/openapi.json',
  ]);
});

test('formats a remote primary surface as one URL without local-network claims', () => {
  assert.deepEqual(formatPrimaryAccessLines({
    accessEndpoints: [{
      id: 'cloud-ui',
      kind: 'user-interface',
      primary: true,
      path: '/',
      url: 'https://app.example.com/',
      binding: null,
    }],
  }, { prefix: '[demo] ' }), [
    '[demo] Access URLs',
    '[demo]   URL: https://app.example.com/',
  ]);
});
