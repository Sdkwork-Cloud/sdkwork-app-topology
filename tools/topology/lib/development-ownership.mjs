import { spawnSync } from 'node:child_process';
import process from 'node:process';

export function parseTcpBinding(value, label = 'TCP binding') {
  const match = String(value ?? '').trim().match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/u);
  const port = Number(match?.[3]);
  if (!match || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must use <host>:<port>`);
  }
  return { host: match[1] ?? match[2], port, value: String(value).trim() };
}

export function resolveOwnedBindings(spec, profile, profileEnv) {
  const declarations = [];
  for (const [surfaceId, surface] of Object.entries(spec.surfaces ?? {})) {
    if (surface.bindEnv && profileEnv[surface.bindEnv]) {
      declarations.push({ id: surfaceId, bindEnv: surface.bindEnv });
    }
  }
  for (const processEntry of profile.processes ?? []) {
    if (processEntry.bindEnv && profileEnv[processEntry.bindEnv]) {
      declarations.push({ id: processEntry.id, bindEnv: processEntry.bindEnv });
    }
  }
  const seen = new Set();
  return declarations.flatMap((entry) => {
    const binding = parseTcpBinding(profileEnv[entry.bindEnv], entry.bindEnv);
    if (seen.has(binding.port)) return [];
    seen.add(binding.port);
    return [{ ...entry, ...binding }];
  });
}

export function windowsListeningPids(bindings, { run = spawnSync } = {}) {
  const ports = new Set(bindings.map((binding) => binding.port));
  if (ports.size === 0) return new Set();
  const result = run('netstat.exe', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`netstat failed (exit ${result.status ?? 1})`);
  const pids = new Set();
  for (const line of String(result.stdout ?? '').split(/\r?\n/u)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/u);
    if (match && ports.has(Number(match[1]))) pids.add(Number(match[2]));
  }
  return pids;
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function stopOwnedBindings(bindings, {
  platform = process.platform,
  listListeningPids = windowsListeningPids,
  terminate = (pid) => process.kill(pid, 'SIGTERM'),
} = {}) {
  if (bindings.length === 0 || platform !== 'win32') return new Set();
  const stopped = new Set();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pids = listListeningPids(bindings);
    if (pids.size === 0) break;
    for (const pid of pids) {
      if (pid === process.pid) continue;
      try {
        terminate(pid);
        stopped.add(pid);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    wait(50);
  }
  const remaining = listListeningPids(bindings);
  if (remaining.size > 0) {
    throw new Error(`owned TCP bindings remain occupied by PID(s): ${[...remaining].join(', ')}`);
  }
  return stopped;
}
