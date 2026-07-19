import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PUBLIC_LIFECYCLE_COMMANDS = Object.freeze([
  'build', 'test', 'check', 'verify', 'clean', 'stop',
]);

function facadeCommand(value, command) {
  return new RegExp(`sdkwork-app(?:\\.mjs)?\\s+${command.replaceAll(':', '\\:')}(?:\\s|$)`, 'u').test(String(value ?? ''));
}

export function validateLifecyclePackage(packageManifest) {
  const scripts = packageManifest?.scripts ?? {};
  const issues = [];
  if (!/^(?:pnpm\s+(?:run\s+)?dev:standalone)$/u.test(String(scripts.dev ?? '').trim())) {
    issues.push('scripts.dev must delegate exactly to pnpm dev:standalone');
  }
  if (!facadeCommand(scripts['dev:standalone'], 'dev') || !/--deployment-profile\s+standalone/u.test(scripts['dev:standalone'])) {
    issues.push('scripts.dev:standalone must use sdkwork-app dev --deployment-profile standalone');
  }
  if (!facadeCommand(scripts['dev:cloud'], 'dev') || !/--deployment-profile\s+cloud/u.test(scripts['dev:cloud'])) {
    issues.push('scripts.dev:cloud must use sdkwork-app dev --deployment-profile cloud');
  }
  for (const command of PUBLIC_LIFECYCLE_COMMANDS) {
    if (!facadeCommand(scripts[command], command)) issues.push(`scripts.${command} must use sdkwork-app ${command}`);
  }
  if ((scripts['_sdkwork:dev:standalone'] || scripts['_sdkwork:dev:cloud']) && !scripts['_sdkwork:stop']) {
    issues.push('private _sdkwork:dev hooks require a scoped _sdkwork:stop hook');
  }
  return issues;
}

export function privateLifecycleScript(command, deploymentProfile) {
  if (command === 'dev') return `_sdkwork:dev:${deploymentProfile}`;
  return `_sdkwork:${command}`;
}

export function resolveProcessInvocation(process) {
  if (process.script) return { command: 'pnpm', args: ['run', process.script] };
  if (process.command) return { command: process.command, args: process.args ?? [] };
  if (process.crate) {
    return {
      command: 'cargo',
      args: ['run', '-p', process.crate, ...(process.binary ? ['--bin', process.binary] : [])],
    };
  }
  return null;
}

export function platformLifecycleInvocation(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  if (platform !== 'win32' || command !== 'pnpm') return { command, args };
  const candidates = [
    env.npm_execpath,
    env.PNPM_HOME ? path.join(env.PNPM_HOME, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs') : null,
    path.join(path.dirname(nodeExecutable), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
  ].filter((candidate) => typeof candidate === 'string'
    && /(?:^|[\\/])pnpm(?:\.c)?js$/iu.test(candidate)
    && fs.existsSync(candidate));
  if (candidates.length === 0) {
    throw new Error('cannot resolve pnpm.cjs for shell-free Windows lifecycle execution');
  }
  return { command: nodeExecutable, args: [candidates[0], ...args] };
}

export function spawnLifecycleCommand(command, args, options = {}) {
  const invocation = platformLifecycleInvocation(command, args, { env: options.env });
  return spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? 'inherit',
    shell: false,
    windowsHide: true,
  });
}

export async function runPrivateLifecycleScript(repoRoot, packageManifest, scriptName, args = [], options = {}) {
  if (!packageManifest.scripts?.[scriptName]) return null;
  const child = spawnLifecycleCommand('pnpm', ['run', scriptName, ...(args.length > 0 ? ['--', ...args] : [])], {
    cwd: repoRoot,
    env: options.env ?? process.env,
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

export function loadPackageManifest(repoRoot) {
  const packagePath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packagePath)) throw new Error(`missing ${packagePath}`);
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}
