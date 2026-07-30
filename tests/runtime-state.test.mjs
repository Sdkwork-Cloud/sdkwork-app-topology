import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalRepositoryRoot,
  ensurePrivateRuntimeStateDirectory,
  removeRuntimeStateFile,
  repositoryRuntimeStateKey,
  resolveRepositoryRuntimeStateDirectory,
  resolveSdkworkRuntimeBaseDirectory,
  writePrivateJsonAtomically,
} from '../tools/topology/lib/runtime-state.mjs';

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('resolves stable isolated state outside the repository', () => {
  const tempRoot = temporaryDirectory('sdkwork-runtime-state-root-');
  const repoRoot = temporaryDirectory('sdkwork-runtime-state-repo-');
  const options = {
    repoRoot,
    owner: 'sdkwork-app',
    env: {},
    temporaryDirectory: tempRoot,
  };
  const directory = resolveRepositoryRuntimeStateDirectory(options);
  assert.equal(directory.startsWith(path.join(tempRoot, 'sdkwork', 'sdkwork-app')), true);
  assert.equal(path.relative(repoRoot, directory).startsWith('..'), true);
  assert.equal(path.basename(directory), repositoryRuntimeStateKey(repoRoot));
});

test('canonicalizes repository links before hashing', () => {
  const parent = temporaryDirectory('sdkwork-runtime-state-link-');
  const repoRoot = path.join(parent, 'repository');
  const link = path.join(parent, 'repository-link');
  fs.mkdirSync(repoRoot);
  fs.symlinkSync(repoRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(canonicalRepositoryRoot(link), canonicalRepositoryRoot(repoRoot));
  assert.equal(repositoryRuntimeStateKey(link), repositoryRuntimeStateKey(repoRoot));
});

test('prefers runner temp and then Linux XDG runtime state', () => {
  const runnerTemp = temporaryDirectory('sdkwork-runner-temp-');
  const xdgRuntime = temporaryDirectory('sdkwork-xdg-runtime-');
  assert.equal(resolveSdkworkRuntimeBaseDirectory({
    env: { RUNNER_TEMP: runnerTemp, XDG_RUNTIME_DIR: xdgRuntime },
    platform: 'linux',
  }), runnerTemp);
  assert.equal(resolveSdkworkRuntimeBaseDirectory({
    env: { XDG_RUNTIME_DIR: xdgRuntime },
    platform: 'linux',
  }), xdgRuntime);
});

test('creates private directories and atomically replaces JSON', () => {
  const tempRoot = temporaryDirectory('sdkwork-runtime-private-');
  const repoRoot = temporaryDirectory('sdkwork-runtime-private-repo-');
  const directory = ensurePrivateRuntimeStateDirectory({
    repoRoot,
    owner: 'sdkwork-app',
    env: {},
    temporaryDirectory: tempRoot,
  });
  const filePath = path.join(directory, 'state.json');
  writePrivateJsonAtomically(filePath, { version: 1 });
  writePrivateJsonAtomically(filePath, { version: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { version: 2 });
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.tmp')), false);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  }
  removeRuntimeStateFile(filePath);
  assert.equal(fs.existsSync(directory), false);
});

test('rejects owner path traversal', () => {
  const repoRoot = temporaryDirectory('sdkwork-runtime-owner-');
  assert.throws(
    () => resolveRepositoryRuntimeStateDirectory({ repoRoot, owner: '../escape' }),
    /lowercase kebab-case/u,
  );
});
