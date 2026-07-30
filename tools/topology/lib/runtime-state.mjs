import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RUNTIME_OWNER_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

function existingAbsoluteDirectory(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || !path.isAbsolute(normalized)) return null;
  try {
    return fs.statSync(normalized).isDirectory() ? path.resolve(normalized) : null;
  } catch {
    return null;
  }
}

export function canonicalRepositoryRoot(repoRoot, {
  platform = process.platform,
  realpath = fs.realpathSync.native,
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required for runtime state resolution');
  const canonical = realpath(path.resolve(repoRoot));
  return platform === 'win32' ? canonical.toLowerCase() : canonical;
}

export function repositoryRuntimeStateKey(repoRoot, options = {}) {
  return createHash('sha256')
    .update(canonicalRepositoryRoot(repoRoot, options))
    .digest('hex')
    .slice(0, 24);
}

export function resolveSdkworkRuntimeBaseDirectory({
  env = process.env,
  platform = process.platform,
  temporaryDirectory = os.tmpdir(),
} = {}) {
  const runnerTemp = existingAbsoluteDirectory(env.RUNNER_TEMP);
  if (runnerTemp) return runnerTemp;
  if (platform !== 'win32') {
    const xdgRuntime = existingAbsoluteDirectory(env.XDG_RUNTIME_DIR);
    if (xdgRuntime) return xdgRuntime;
  }
  const fallback = existingAbsoluteDirectory(temporaryDirectory);
  if (!fallback) throw new Error('an existing absolute OS temporary directory is required');
  return fallback;
}

export function resolveRepositoryRuntimeStateDirectory({
  repoRoot,
  owner,
  ...options
} = {}) {
  if (!RUNTIME_OWNER_PATTERN.test(String(owner ?? ''))) {
    throw new Error('runtime state owner must use lowercase kebab-case');
  }
  return path.join(
    resolveSdkworkRuntimeBaseDirectory(options),
    'sdkwork',
    owner,
    repositoryRuntimeStateKey(repoRoot, options),
  );
}

export function ensurePrivateRuntimeStateDirectory(options = {}) {
  const directory = resolveRepositoryRuntimeStateDirectory(options);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if ((options.platform ?? process.platform) !== 'win32') fs.chmodSync(directory, 0o700);
  return directory;
}

export function writePrivateJsonAtomically(filePath, value, {
  platform = process.platform,
} = {}) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') fs.chmodSync(directory, 0o700);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
    if (platform !== 'win32') fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

export function removeRuntimeStateFile(filePath) {
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  const directory = path.dirname(filePath);
  try {
    fs.rmdirSync(directory);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  }
}
