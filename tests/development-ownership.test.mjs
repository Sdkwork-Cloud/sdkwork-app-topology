import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseTcpBinding,
  resolveOwnedBindings,
  stopOwnedBindings,
  windowsListeningPids,
} from '../tools/topology/lib/development-ownership.mjs';

test('resolves surface and process bindings as one deduplicated ownership set', () => {
  const bindings = resolveOwnedBindings({
    surfaces: { ingress: { bindEnv: 'APP_BIND' } },
  }, {
    processes: [
      { id: 'gateway', bindEnv: 'APP_BIND' },
      { id: 'client', bindEnv: 'CLIENT_BIND' },
    ],
  }, {
    APP_BIND: '127.0.0.1:18092',
    CLIENT_BIND: '0.0.0.0:5190',
  });

  assert.deepEqual(bindings.map(({ id, bindEnv, port }) => ({ id, bindEnv, port })), [
    { id: 'ingress', bindEnv: 'APP_BIND', port: 18092 },
    { id: 'client', bindEnv: 'CLIENT_BIND', port: 5190 },
  ]);
  assert.deepEqual(parseTcpBinding('[::1]:5190'), { host: '::1', port: 5190, value: '[::1]:5190' });
});

test('Windows listener discovery selects only declared ports', () => {
  const pids = windowsListeningPids([{ port: 5190 }, { port: 18092 }], {
    run: () => ({ status: 0, stdout: [
      '  TCP    0.0.0.0:5190    0.0.0.0:0    LISTENING    101',
      '  TCP    127.0.0.1:18092    0.0.0.0:0    LISTENING    102',
      '  TCP    127.0.0.1:3000    0.0.0.0:0    LISTENING    103',
    ].join('\r\n') }),
  });
  assert.deepEqual([...pids], [101, 102]);
});

test('binding cleanup terminates every owned listener and verifies release', () => {
  const snapshots = [new Set([101, 102]), new Set(), new Set()];
  const terminated = [];
  const stopped = stopOwnedBindings([{ port: 5190 }, { port: 18092 }], {
    platform: 'win32',
    listListeningPids: () => snapshots.shift() ?? new Set(),
    terminate: (pid) => terminated.push(pid),
  });
  assert.deepEqual([...stopped], [101, 102]);
  assert.deepEqual(terminated, [101, 102]);
});
