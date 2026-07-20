import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatNetworkAccessLines,
  formatNetworkUrlHost,
  formatResolvedNetworkAccessLines,
  resolveNetworkAccessSummary,
  resolveNetworkAccessUrls,
  resolveNetworkInterfaceSnapshot,
  resolveNonLoopbackIpAddresses,
  resolveNonLoopbackIpv4Addresses,
  resolveNonLoopbackIpv6Addresses,
} from '../tools/topology/lib/index.mjs';

const networkInterfaces = {
  Ethernet: [
    { family: 'IPv4', address: '198.18.0.1', internal: false },
    { family: 'IPv4', address: '192.168.31.110', internal: false },
    { family: 'IPv4', address: '127.0.0.1', internal: true },
    { family: 'IPv6', address: 'fe80::1', internal: false },
  ],
  WiFi: [
    { family: 4, address: '169.254.23.73', internal: false },
    { family: 'IPv4', address: '169.254.30.58', internal: false },
  ],
  Virtual: [
    { family: 'IPv4', address: '172.23.0.1', internal: false },
    { family: 'IPv4', address: '198.18.0.1', internal: false },
    { family: 6, address: 'fd00::4', internal: false },
    { family: 'IPv6', address: 'fe80::1', internal: false },
    { family: 'IPv6', address: '::1', internal: true },
  ],
};

test('formats IPv4 and IPv6 addresses as URL hosts', () => {
  assert.equal(formatNetworkUrlHost('192.168.31.110'), '192.168.31.110');
  assert.equal(formatNetworkUrlHost('fd00::4'), '[fd00::4]');
  assert.equal(formatNetworkUrlHost('[fd00::4]'), '[fd00::4]');
});

test('normalizes function and snapshot network interface inputs', () => {
  let reads = 0;
  assert.equal(resolveNetworkInterfaceSnapshot(() => {
    reads += 1;
    return networkInterfaces;
  }), networkInterfaces);
  assert.equal(reads, 1);
  assert.equal(resolveNetworkInterfaceSnapshot(networkInterfaces), networkInterfaces);
  assert.deepEqual(resolveNetworkInterfaceSnapshot(() => undefined), {});
});

test('resolves every unique non-loopback IPv4 address in stable order', () => {
  assert.deepEqual(resolveNonLoopbackIpv4Addresses(networkInterfaces), [
    '169.254.23.73',
    '169.254.30.58',
    '172.23.0.1',
    '192.168.31.110',
    '198.18.0.1',
  ]);
});

test('resolves IPv6 and selected address families through the shared scanner', () => {
  assert.deepEqual(resolveNonLoopbackIpv6Addresses(() => networkInterfaces), [
    'fd00::4',
    'fe80::1',
  ]);
  assert.deepEqual(resolveNonLoopbackIpAddresses(networkInterfaces, {
    families: [4, 'IPv6'],
  }), [
    '169.254.23.73',
    '169.254.30.58',
    '172.23.0.1',
    '192.168.31.110',
    '198.18.0.1',
    'fd00::4',
    'fe80::1',
  ]);
});

test('resolves local and network access URLs for a non-loopback listener', () => {
  assert.deepEqual(resolveNetworkAccessUrls({
    host: '0.0.0.0',
    port: 3001,
    pathname: '/',
    networkInterfaces,
  }), [
    'http://127.0.0.1:3001/',
    'http://169.254.23.73:3001/',
    'http://169.254.30.58:3001/',
    'http://172.23.0.1:3001/',
    'http://192.168.31.110:3001/',
    'http://198.18.0.1:3001/',
  ]);
});

test('formats IPv6 network URLs when the caller explicitly enables IPv6', () => {
  assert.deepEqual(resolveNetworkAccessUrls({
    addressFamilies: ['IPv4', 6],
    host: '::',
    port: 3001,
    networkInterfaces: {
      Ethernet: [
        { family: 'IPv4', address: '192.168.31.110', internal: false },
        { family: 'IPv6', address: 'fd00::4', internal: false },
      ],
    },
  }), [
    'http://127.0.0.1:3001',
    'http://192.168.31.110:3001',
    'http://[fd00::4]:3001',
  ]);
});

test('does not advertise network URLs for a loopback-only listener', () => {
  assert.deepEqual(resolveNetworkAccessUrls({
    host: 'localhost',
    port: '3001',
    networkInterfaces,
  }), ['http://127.0.0.1:3001']);
  assert.deepEqual(resolveNetworkAccessUrls({ port: 0, networkInterfaces }), []);
});

test('returns structured local and network access details', () => {
  assert.deepEqual(resolveNetworkAccessSummary({
    host: '0.0.0.0',
    port: 3001,
    pathname: '/',
    networkInterfaces,
  }), {
    allUrls: [
      'http://127.0.0.1:3001/',
      'http://169.254.23.73:3001/',
      'http://169.254.30.58:3001/',
      'http://172.23.0.1:3001/',
      'http://192.168.31.110:3001/',
      'http://198.18.0.1:3001/',
    ],
    listenerScope: 'network',
    localUrl: 'http://127.0.0.1:3001/',
    networkUrls: [
      'http://169.254.23.73:3001/',
      'http://169.254.30.58:3001/',
      'http://172.23.0.1:3001/',
      'http://192.168.31.110:3001/',
      'http://198.18.0.1:3001/',
    ],
  });
});

test('formats every access URL as a stable standalone line', () => {
  assert.deepEqual(formatNetworkAccessLines({
    host: '0.0.0.0',
    port: 3001,
    pathname: '/',
    networkInterfaces,
    prefix: '[app]   ',
  }), [
    '[app]   Local: http://127.0.0.1:3001/',
    '[app]   Network: http://169.254.23.73:3001/',
    '[app]   Network: http://169.254.30.58:3001/',
    '[app]   Network: http://172.23.0.1:3001/',
    '[app]   Network: http://192.168.31.110:3001/',
    '[app]   Network: http://198.18.0.1:3001/',
  ]);
});

test('formats a configurable unavailable line for loopback-only listeners', () => {
  assert.deepEqual(formatNetworkAccessLines({
    host: '127.0.0.1',
    port: 3001,
    pathname: '/',
    networkInterfaces,
    networkLabel: 'LAN',
    prefix: '[app]   ',
    unavailableText: 'unavailable',
  }), [
    '[app]   Local: http://127.0.0.1:3001/',
    '[app]   LAN: unavailable',
  ]);
  assert.deepEqual(formatNetworkAccessLines({ port: 0 }), []);
});

test('can format network-only lines when an application prints local access elsewhere', () => {
  assert.deepEqual(formatNetworkAccessLines({
    host: '0.0.0.0',
    includeLocal: false,
    port: 3001,
    pathname: '/',
    networkInterfaces: {
      WiFi: [{ family: 'IPv4', address: '192.168.31.110', internal: false }],
    },
    prefix: '[app]   ',
  }), [
    '[app]   Network: http://192.168.31.110:3001/',
  ]);
});

test('formats an application-owned access summary without duplicating product policy', () => {
  assert.deepEqual(formatResolvedNetworkAccessLines({
    localUrl: 'http://localhost:4188',
    networkUrls: [
      'http://10.8.0.4:4188',
      'http://[fd00::4]:4188',
    ],
  }, {
    prefix: '[app] ',
    unavailableText: 'unavailable',
  }), [
    '[app] Local: http://localhost:4188',
    '[app] Network: http://10.8.0.4:4188',
    '[app] Network: http://[fd00::4]:4188',
  ]);
});
