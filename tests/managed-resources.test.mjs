import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileManagedResources } from '../tools/topology/lib/managed-resources.mjs';

const resource = {
  id: 'postgres-proxy',
  driver: 'windows-wsl-tcp-portproxy',
  enabledEnv: 'PROXY_ENABLED',
  listenAddressEnv: 'DB_HOST',
  listenPortEnv: 'DB_PORT',
  distributionEnv: 'WSL_DISTRO',
};
const environment = {
  PROXY_ENABLED: 'true',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  WSL_DISTRO: 'Ubuntu-22.04',
};

test('managed WSL portproxy provision is centralized and deterministic', () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (command === 'wsl.exe') return { status: 0, stdout: '172.23.14.27  ' };
    return { status: 0, stdout: '' };
  };
  assert.deepEqual(
    reconcileManagedResources([resource], environment, 'provision', { platform: 'win32', run }),
    ['postgres-proxy'],
  );
  assert.deepEqual(calls.map(([command]) => command), ['netsh.exe', 'wsl.exe', 'netsh.exe']);
  assert.ok(calls[2][1].includes('connectaddress=172.23.14.27'));
});

test('managed WSL portproxy removal is idempotent when absent', () => {
  const calls = [];
  const changed = reconcileManagedResources([resource], environment, 'remove', {
    platform: 'win32',
    run: (command, args) => {
      calls.push([command, args]);
      return { status: 0, stdout: '' };
    },
  });
  assert.deepEqual(changed, []);
  assert.equal(calls.length, 1);
});

test('managed WSL portproxy rejects non-loopback exposure', () => {
  assert.throws(
    () => reconcileManagedResources([resource], { ...environment, DB_HOST: '0.0.0.0' }, 'provision', {
      platform: 'win32',
      run: () => ({ status: 0, stdout: '' }),
    }),
    /must use a loopback listen address/u,
  );
});
