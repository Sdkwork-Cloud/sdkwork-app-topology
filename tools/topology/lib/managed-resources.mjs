import { spawnSync } from 'node:child_process';
import process from 'node:process';

export const MANAGED_RESOURCE_DRIVERS = Object.freeze([
  'windows-wsl-tcp-portproxy',
]);

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function envValue(environment, key, fallback) {
  return key ? (environment[key] || fallback) : fallback;
}

function runChecked(run, command, args, options, label) {
  const result = run(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status ?? 1})`);
  return result;
}

function resolveWindowsWslPortProxy(resource, environment) {
  const listenAddress = envValue(environment, resource.listenAddressEnv, resource.listenAddress ?? '127.0.0.1');
  const listenPort = String(envValue(environment, resource.listenPortEnv, resource.listenPort ?? ''));
  const distribution = envValue(environment, resource.distributionEnv, resource.distribution ?? 'Ubuntu-22.04');
  if (!['127.0.0.1', 'localhost'].includes(listenAddress)) {
    throw new Error(`${resource.id} must use a loopback listen address`);
  }
  if (!/^\d{1,5}$/u.test(listenPort) || Number(listenPort) < 1 || Number(listenPort) > 65535) {
    throw new Error(`${resource.id} requires a valid listen port`);
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(distribution)) {
    throw new Error(`${resource.id} distribution contains unsupported characters`);
  }
  return { listenAddress, listenPort, distribution };
}

function showWindowsPortProxies(run) {
  return runChecked(
    run,
    'netsh.exe',
    ['interface', 'portproxy', 'show', 'v4tov4'],
    { encoding: 'utf8', windowsHide: true },
    'Windows portproxy query',
  ).stdout ?? '';
}

function ownsWindowsPortProxy(output, listenAddress, listenPort) {
  return String(output).split(/\r?\n/u).some((line) => {
    const columns = line.trim().split(/\s+/u);
    return columns[0] === listenAddress && columns[1] === listenPort;
  });
}

function removeWindowsWslPortProxy(resource, environment, run) {
  const { listenAddress, listenPort } = resolveWindowsWslPortProxy(resource, environment);
  if (!ownsWindowsPortProxy(showWindowsPortProxies(run), listenAddress, listenPort)) return false;
  runChecked(
    run,
    'netsh.exe',
    ['interface', 'portproxy', 'delete', 'v4tov4', `listenaddress=${listenAddress}`, `listenport=${listenPort}`],
    { stdio: 'inherit', windowsHide: true },
    `${resource.id} removal`,
  );
  return true;
}

function provisionWindowsWslPortProxy(resource, environment, run) {
  const { listenAddress, listenPort, distribution } = resolveWindowsWslPortProxy(resource, environment);
  removeWindowsWslPortProxy(resource, environment, run);
  const addressResult = runChecked(
    run,
    'wsl.exe',
    ['-d', distribution, '--', 'sh', '-lc', 'hostname -I'],
    { encoding: 'utf8', windowsHide: true },
    `${resource.id} WSL address resolution`,
  );
  const targetAddress = String(addressResult.stdout ?? '').split(/\s+/u)
    .find((value) => /^\d+\.\d+\.\d+\.\d+$/u.test(value));
  if (!targetAddress) throw new Error(`${resource.id} WSL distribution did not report an IPv4 address`);
  runChecked(
    run,
    'netsh.exe',
    [
      'interface', 'portproxy', 'add', 'v4tov4',
      `listenaddress=${listenAddress}`, `listenport=${listenPort}`,
      `connectaddress=${targetAddress}`, `connectport=${listenPort}`,
    ],
    { stdio: 'inherit', windowsHide: true },
    `${resource.id} provisioning`,
  );
  console.log(`[sdkwork-app] ${resource.id}: ${listenAddress}:${listenPort} -> ${targetAddress}:${listenPort}`);
  return true;
}

export function reconcileManagedResources(resources, environment, phase, {
  platform = process.platform,
  run = spawnSync,
} = {}) {
  if (!['provision', 'remove'].includes(phase)) {
    throw new Error(`unsupported managed resource phase ${phase}`);
  }
  const changed = [];
  for (const resource of resources ?? []) {
    if (resource.enabledEnv && !enabled(environment[resource.enabledEnv])) continue;
    if (resource.driver === 'windows-wsl-tcp-portproxy') {
      if (platform !== 'win32') continue;
      const didChange = phase === 'provision'
        ? provisionWindowsWslPortProxy(resource, environment, run)
        : removeWindowsWslPortProxy(resource, environment, run);
      if (didChange) changed.push(resource.id);
      continue;
    }
    throw new Error(`unsupported managed resource driver ${resource.driver}`);
  }
  return changed;
}
