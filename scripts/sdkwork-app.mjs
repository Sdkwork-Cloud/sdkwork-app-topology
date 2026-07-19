#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createTopologyRuntime,
  loadTopologySpec,
  waitForHttpHealthy,
} from '../tools/topology/lib/index.mjs';
import {
  loadPackageManifest,
  privateLifecycleScript,
  resolveProcessInvocation,
  runPrivateLifecycleScript,
  spawnLifecycleCommand,
  validateLifecyclePackage,
} from '../tools/topology/lib/lifecycle.mjs';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ROOT = path.resolve(FRAMEWORK_ROOT, '..');
const DEFAULT_WORKFLOW_CLI = path.join(WORKSPACE_ROOT, 'sdkwork-github-workflow', 'scripts', 'sdkwork-workflow.mjs');
const DEFAULT_DEPLOY_CLI = path.join(WORKSPACE_ROOT, 'sdkwork-specs', 'tools', 'deployctl.mjs');
const DEFAULT_APP_MANIFEST_CHECK_CLI = path.join(WORKSPACE_ROOT, 'sdkwork-specs', 'tools', 'check-app-manifest-standard.mjs');
const DEFAULT_SOURCE_CONFIG_CHECK_CLI = path.join(WORKSPACE_ROOT, 'sdkwork-specs', 'tools', 'check-source-config-standard.mjs');
const DEVELOPMENT_SESSION_RELATIVE_PATH = path.join('.runtime', 'sdkwork-app', 'development-session.json');
const DEVELOPMENT_SESSION_HEARTBEAT_MS = 2000;
const DEVELOPMENT_SESSION_STALE_MS = 15000;

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function frameworkCliPath(environmentKey, fallback) {
  return path.resolve(process.env[environmentKey] ?? fallback);
}

function passthroughArgs(args, excluded) {
  const out = [];
  for (let index = 0; index < args.length; index += 1) {
    if (excluded.has(args[index])) {
      index += 1;
      continue;
    }
    out.push(args[index]);
  }
  return out;
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

async function runCommand(command, args, cwd, env = process.env) {
  const result = await waitForChild(spawnLifecycleCommand(command, args, { cwd, env }));
  if (result.code !== 0) throw new Error(`${command} exited with code ${result.code}`);
}

function developmentSessionPath(repoRoot) {
  return path.join(repoRoot, DEVELOPMENT_SESSION_RELATIVE_PATH);
}

function writeDevelopmentSession(repoRoot, session) {
  const sessionPath = developmentSessionPath(repoRoot);
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  const temporaryPath = `${sessionPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({
    ...session,
    heartbeatAt: session.heartbeatAt ?? new Date().toISOString(),
  }, null, 2)}\n`);
  fs.renameSync(temporaryPath, sessionPath);
}

function removeDevelopmentSession(repoRoot) {
  const sessionPath = developmentSessionPath(repoRoot);
  if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { force: true });
}

function readDevelopmentSession(repoRoot) {
  const sessionPath = developmentSessionPath(repoRoot);
  if (!fs.existsSync(sessionPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  } catch {
    throw new Error(`invalid development session registry: ${sessionPath}`);
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopManagedDevelopmentSession(repoRoot) {
  const session = readDevelopmentSession(repoRoot);
  if (!session) return false;
  const heartbeatAt = Date.parse(session.heartbeatAt ?? '');
  const expectedRoot = path.resolve(repoRoot);
  if (path.resolve(session.repoRoot ?? '') !== expectedRoot) {
    throw new Error('development session registry belongs to another repository');
  }
  if (!Number.isFinite(heartbeatAt) || Date.now() - heartbeatAt > DEVELOPMENT_SESSION_STALE_MS) {
    removeDevelopmentSession(repoRoot);
    throw new Error('development session registry is stale; no process was terminated');
  }
  if (!processIsAlive(session.supervisorPid)) {
    removeDevelopmentSession(repoRoot);
    return false;
  }
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(session.supervisorPid), '/T', '/F'], {
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    if (result.status !== 0 && processIsAlive(session.supervisorPid)) {
      const ownedPids = [
        ...(Array.isArray(session.childPids) ? session.childPids : []),
        session.supervisorPid,
      ].filter((pid, index, values) => Number.isSafeInteger(pid) && pid > 0 && values.indexOf(pid) === index);
      for (const pid of ownedPids) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch (error) {
          if (error.code !== 'ESRCH') {
            throw new Error(`failed to stop managed development process ${pid}: ${error.message}`);
          }
        }
      }
    }
    removeDevelopmentSession(repoRoot);
  } else {
    process.kill(session.supervisorPid, 'SIGTERM');
  }
  return true;
}

function loadRuntime(repoRoot) {
  const specPath = path.join(repoRoot, 'specs', 'topology.spec.json');
  const spec = loadTopologySpec(specPath);
  const runtime = createTopologyRuntime(spec, repoRoot, specPath);
  if (runtime.schemaVersion !== 5) throw new Error('sdkwork-app requires topology schemaVersion 5');
  return runtime;
}

async function waitForPlanHealth(plan, runtime) {
  for (const check of plan.healthChecks) {
    if (!check.url) throw new Error(`missing health URL for ${check.surfaceId}`);
    const surface = runtime.spec.surfaces[check.surfaceId] ?? {};
    const healthy = await waitForHttpHealthy(check.url, {
      path: surface.healthPath ?? '/healthz',
      attempts: surface.healthAttempts ?? 30,
      intervalMs: surface.healthIntervalMs ?? 1000,
      timeoutMs: surface.healthTimeoutMs ?? 2000,
    });
    if (!healthy) throw new Error(`health check failed for ${check.surfaceId}: ${check.url}`);
  }
}

async function runGenericDevelopment(repoRoot, runtime, plan, env, dryRun) {
  const early = plan.localProcesses.filter((entry) => entry.role !== 'client');
  const clients = plan.localProcesses.filter((entry) => entry.role === 'client');
  const resolved = plan.localProcesses.map((entry) => ({ entry, invocation: resolveProcessInvocation(entry) }));
  const missing = resolved.filter((item) => !item.invocation).map((item) => item.entry.id);
  if (missing.length > 0) throw new Error(`process commands are unresolved: ${missing.join(', ')}`);
  if (dryRun) {
    console.log(JSON.stringify({ plan, invocations: resolved }, null, 2));
    return;
  }
  const children = [];
  const launch = (entry) => {
    const invocation = resolveProcessInvocation(entry);
    const child = spawnLifecycleCommand(invocation.command, invocation.args, {
      cwd: path.resolve(repoRoot, entry.cwd ?? '.'),
      env: { ...env, ...(entry.env ?? {}) },
    });
    children.push(child);
    refreshSession();
  };
  const terminate = () => children.forEach((child) => {
    if (!child.killed) child.kill('SIGTERM');
  });
  const session = {
    schemaVersion: 1,
    repoRoot: path.resolve(repoRoot),
    supervisorPid: process.pid,
    profileId: plan.activeProfile,
    runtimeTarget: plan.runtimeTarget,
    startedAt: new Date().toISOString(),
  };
  const refreshSession = () => writeDevelopmentSession(repoRoot, {
    ...session,
    childPids: children.map((child) => child.pid).filter((pid) => Number.isSafeInteger(pid) && pid > 0),
  });
  let resolveSignal;
  const signalReceived = new Promise((resolve) => { resolveSignal = resolve; });
  const onSignal = () => {
    terminate();
    resolveSignal(true);
  };
  refreshSession();
  const heartbeat = setInterval(refreshSession, DEVELOPMENT_SESSION_HEARTBEAT_MS);
  heartbeat.unref();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    early.forEach(launch);
    const stoppedDuringHealthCheck = await Promise.race([
      waitForPlanHealth(plan, runtime).then(() => false),
      signalReceived,
    ]);
    if (stoppedDuringHealthCheck) return;
    clients.forEach(launch);
    if (children.length === 0) throw new Error('development plan has no local processes; declare a client process or private _sdkwork:dev hook');
    const first = await Promise.race([
      ...children.map(waitForChild),
      signalReceived.then(() => ({ code: 0, signal: 'SIGTERM' })),
    ]);
    if (first.code !== 0) throw new Error(`development process exited with code ${first.code}`);
  } finally {
    clearInterval(heartbeat);
    terminate();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    removeDevelopmentSession(repoRoot);
  }
}

async function runDevelopment(repoRoot, packageManifest, args) {
  const deploymentProfile = option(args, '--deployment-profile', 'standalone');
  const environment = option(args, '--environment', 'development');
  const runtimeTarget = option(args, '--runtime-target', 'browser');
  const clientArchitecture = option(args, '--client-architecture');
  const dryRun = args.includes('--dry-run');
  const runtime = loadRuntime(repoRoot);
  const plan = runtime.resolvePlan(`${deploymentProfile}.${environment}`, runtimeTarget, clientArchitecture);
  if (plan.forbiddenProcesses.length > 0) throw new Error(`forbidden local processes: ${plan.forbiddenProcesses.join(', ')}`);
  const env = runtime.applyProfileEnv(plan.activeProfile, [process.env, runtime.loadProfile(plan.activeProfile)]);
  console.log(`[sdkwork-app] ${plan.appId} ${plan.activeProfile} runtimeTarget=${runtimeTarget} clientArchitecture=${plan.clientArchitecture ?? 'none'}`);
  const privateScript = privateLifecycleScript('dev', deploymentProfile);
  if (packageManifest.scripts?.[privateScript] && !dryRun) {
    const result = await runPrivateLifecycleScript(repoRoot, packageManifest, privateScript, [
      '--deployment-profile', deploymentProfile,
      '--environment', environment,
      '--runtime-target', runtimeTarget,
    ], { env });
    if (result.code !== 0) throw new Error(`${privateScript} exited with code ${result.code}`);
    return;
  }
  await runGenericDevelopment(repoRoot, runtime, plan, env, dryRun);
}

async function runWorkflow(repoRoot, command, args) {
  const workflowCli = frameworkCliPath('SDKWORK_GITHUB_WORKFLOW_CLI', DEFAULT_WORKFLOW_CLI);
  if (!fs.existsSync(workflowCli)) {
    throw new Error(`missing workflow framework: ${workflowCli}; set SDKWORK_GITHUB_WORKFLOW_CLI for a non-workspace installation`);
  }
  const config = path.join(repoRoot, 'sdkwork.workflow.json');
  if (!fs.existsSync(config)) throw new Error('sdkwork.workflow.json is required');
  await runCommand(process.execPath, [workflowCli, command, '--config', config, ...args], repoRoot);
}

async function runRelease(repoRoot, packageManifest, command, args) {
  const phase = command.split(':')[1];
  if (phase === 'plan') {
    await runWorkflow(repoRoot, 'matrix', args);
    return;
  }
  const workflowPhases = new Set(['preflight', 'build', 'stage', 'package', 'sign', 'sbom', 'validate', 'publish']);
  if (!workflowPhases.has(phase)) throw new Error(`unsupported release phase ${phase}`);
  if (!option(args, '--target-id')) throw new Error(`${command} requires --target-id`);
  await runWorkflow(repoRoot, 'lifecycle', ['--phase', phase, '--run', ...args]);
}

async function runDeploy(repoRoot, command, args) {
  const deployCli = frameworkCliPath('SDKWORK_DEPLOY_CLI', DEFAULT_DEPLOY_CLI);
  if (!fs.existsSync(deployCli)) {
    throw new Error(`missing deploy framework: ${deployCli}; set SDKWORK_DEPLOY_CLI for a non-workspace installation`);
  }
  const phase = command.split(':')[1];
  if (phase === 'validate' || phase === 'plan') {
    await runCommand(process.execPath, [deployCli, phase, '--root', repoRoot, ...args], repoRoot);
  } else if (phase === 'apply' || phase === 'rollback') {
    await runCommand(process.execPath, [deployCli, phase, '--root', repoRoot, ...args], repoRoot);
  } else throw new Error(`unsupported deploy phase ${phase}`);
}

async function runStandardCheck(repoRoot, environmentKey, fallback) {
  const cli = frameworkCliPath(environmentKey, fallback);
  if (!fs.existsSync(cli)) {
    throw new Error(`missing standards validator: ${cli}; set ${environmentKey} for a non-workspace installation`);
  }
  await runCommand(process.execPath, [cli, '--root', repoRoot], repoRoot);
}

async function runStop(repoRoot, packageManifest, args) {
  const privateScript = privateLifecycleScript('stop');
  const privateResult = await runPrivateLifecycleScript(repoRoot, packageManifest, privateScript, args);
  if (privateResult) {
    if (privateResult.code !== 0) throw new Error(`${privateScript} exited with code ${privateResult.code}`);
    return;
  }
  if (!stopManagedDevelopmentSession(repoRoot)) {
    console.log(`[sdkwork-app] no active managed development session: ${repoRoot}`);
    return;
  }
  console.log(`[sdkwork-app] stop requested for managed development session: ${repoRoot}`);
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log('Usage: sdkwork-app <dev|stop|build|test|check|verify|clean|doctor|topology:plan|topology:validate|release:<phase>|deploy:validate|deploy:plan|deploy:apply|deploy:rollback> [options]');
    return;
  }
  const repoRoot = path.resolve(option(args, '--root', process.cwd()));
  const forwarded = passthroughArgs(args, new Set(['--root']));
  const packageManifest = loadPackageManifest(repoRoot);
  if (command === 'doctor') {
    const issues = validateLifecyclePackage(packageManifest);
    if (issues.length > 0) throw new Error(`lifecycle contract failed: ${issues.join('; ')}`);
    await runStandardCheck(repoRoot, 'SDKWORK_APP_MANIFEST_CHECK_CLI', DEFAULT_APP_MANIFEST_CHECK_CLI);
    await runStandardCheck(repoRoot, 'SDKWORK_SOURCE_CONFIG_CHECK_CLI', DEFAULT_SOURCE_CONFIG_CHECK_CLI);
    loadRuntime(repoRoot);
    if (fs.existsSync(path.join(repoRoot, 'sdkwork.workflow.json'))) {
      await runWorkflow(repoRoot, 'validate', []);
    }
    if (fs.existsSync(path.join(repoRoot, 'deployments', 'deploy.yaml'))) {
      await runDeploy(repoRoot, 'deploy:validate', []);
    }
    console.log(`[sdkwork-app] lifecycle contract ok: ${repoRoot}`);
    return;
  }
  if (command === 'dev') return runDevelopment(repoRoot, packageManifest, forwarded);
  if (command === 'stop') return runStop(repoRoot, packageManifest, forwarded);
  if (command === 'topology:validate') {
    loadRuntime(repoRoot);
    console.log(`[sdkwork-app] topology v5 valid: ${repoRoot}`);
    return;
  }
  if (command === 'topology:plan') {
    const runtime = loadRuntime(repoRoot);
    const profile = `${option(forwarded, '--deployment-profile', 'standalone')}.${option(forwarded, '--environment', 'development')}`;
    console.log(JSON.stringify(runtime.resolvePlan(
      profile,
      option(forwarded, '--runtime-target', 'browser'),
      option(forwarded, '--client-architecture'),
    ), null, 2));
    return;
  }
  if (['build', 'test', 'check', 'verify', 'clean'].includes(command)) {
    const script = privateLifecycleScript(command);
    const result = await runPrivateLifecycleScript(repoRoot, packageManifest, script, forwarded);
    if (!result) throw new Error(`missing private lifecycle hook ${script}`);
    if (result.code !== 0) throw new Error(`${script} exited with code ${result.code}`);
    return;
  }
  if (command.startsWith('release:')) return runRelease(repoRoot, packageManifest, command, forwarded);
  if (command.startsWith('deploy:')) return runDeploy(repoRoot, command, forwarded);
  throw new Error(`unsupported lifecycle command ${command}`);
}

function sameModulePath(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

const invokedPath = process.argv[1] ? process.argv[1] : null;
if (invokedPath && sameModulePath(invokedPath, fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`[sdkwork-app] ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  developmentSessionPath,
  frameworkCliPath,
  main,
  passthroughArgs,
  readDevelopmentSession,
  removeDevelopmentSession,
  sameModulePath,
  stopManagedDevelopmentSession,
  writeDevelopmentSession,
};
