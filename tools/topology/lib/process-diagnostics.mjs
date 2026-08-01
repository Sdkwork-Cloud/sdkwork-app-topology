import fs from 'node:fs';
import path from 'node:path';

function environmentValue(environment, name, platform = process.platform) {
  if (platform !== 'win32') return environment?.[name];
  const key = Object.keys(environment ?? {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? environment[key] : undefined;
}

function executableExtensions(environment, platform) {
  if (platform !== 'win32') return [''];
  const configured = environmentValue(environment, 'PATHEXT', platform);
  return String(configured ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean);
}

function executableCandidates(command, cwd, environment, platform) {
  const extensions = executableExtensions(environment, platform);
  const hasExtension = path.extname(command) !== '';
  const names = hasExtension ? [command] : [command, ...extensions.map((extension) => `${command}${extension}`)];
  if (command.includes('/') || command.includes('\\')) {
    return names.map((name) => path.resolve(cwd, name));
  }
  const searchPath = String(environmentValue(environment, 'PATH', platform) ?? '');
  return searchPath
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => path.join(directory, name)));
}

function resolveExecutable(command, cwd, environment, platform = process.platform) {
  return executableCandidates(command, cwd, environment, platform)
    .find((candidate) => fs.existsSync(candidate));
}

function quoteArgument(value) {
  const text = String(value);
  if (text !== '' && !/[\s"']/u.test(text)) return text;
  return JSON.stringify(text);
}

function formatCommand(command, args = []) {
  return [command, ...args].map(quoteArgument).join(' ');
}

function processFailureDiagnosis(error, details) {
  if (error?.code !== 'ENOENT') return undefined;
  if (!fs.existsSync(details.cwd)) {
    return `working directory does not exist: ${details.cwd}`;
  }
  if (!details.resolvedExecutable) {
    return `executable "${details.command}" was not found on PATH`;
  }
  return `executable resolved to ${details.resolvedExecutable}, but the operating system could not start it; check its interpreter and file permissions`;
}

export class LifecycleProcessError extends Error {
  constructor(message, details, cause) {
    super(message, { cause });
    this.name = 'LifecycleProcessError';
    this.details = Object.freeze({ ...details });
    if (cause?.code !== undefined) this.code = cause.code;
  }
}

export function createProcessLaunchError(error, invocation, options = {}) {
  if (error instanceof LifecycleProcessError) return error;
  const environment = invocation.environment ?? process.env;
  const cwd = path.resolve(invocation.cwd ?? process.cwd());
  const details = {
    processId: invocation.processId,
    processRole: invocation.processRole,
    command: invocation.command,
    args: [...(invocation.args ?? [])],
    effectiveCommand: invocation.effectiveCommand ?? invocation.command,
    effectiveArgs: [...(invocation.effectiveArgs ?? invocation.args ?? [])],
    cwd,
    path: String(environmentValue(environment, 'PATH', options.platform ?? process.platform) ?? ''),
    resolvedExecutable: resolveExecutable(
      invocation.effectiveCommand ?? invocation.command,
      cwd,
      environment,
      options.platform ?? process.platform,
    ),
  };
  details.diagnosis = processFailureDiagnosis(error, details);
  const identity = details.processRole === 'lifecycle-hook'
    ? `lifecycle hook ${details.processId}`
    : details.processId ? `process ${details.processId}` : 'lifecycle process';
  return new LifecycleProcessError(
    `failed to start ${identity}: ${formatCommand(details.command, details.args)}`,
    details,
    error,
  );
}

function appendErrorProperties(lines, error, indentation) {
  for (const key of ['code', 'errno', 'syscall', 'path']) {
    if (error?.[key] !== undefined) lines.push(`${indentation}${key}: ${error[key]}`);
  }
  if (Array.isArray(error?.spawnargs)) {
    lines.push(`${indentation}spawnargs: ${JSON.stringify(error.spawnargs)}`);
  }
}

function errorChain(error) {
  const chain = [];
  const visited = new Set();
  let current = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

export function formatLifecycleError(error, {
  prefix = '[sdkwork-app]',
  summary = 'lifecycle command failed',
} = {}) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const lines = [`${prefix} ${summary}`];
  if (normalized instanceof LifecycleProcessError) {
    const details = normalized.details;
    if (details.processId) lines.push(`${prefix}   process: ${details.processId}`);
    if (details.processRole) lines.push(`${prefix}   role: ${details.processRole}`);
    lines.push(`${prefix}   command: ${formatCommand(details.command, details.args)}`);
    if (details.effectiveCommand !== details.command || details.effectiveArgs.join('\0') !== details.args.join('\0')) {
      lines.push(`${prefix}   effective command: ${formatCommand(details.effectiveCommand, details.effectiveArgs)}`);
    }
    lines.push(`${prefix}   cwd: ${details.cwd}`);
    lines.push(`${prefix}   resolved executable: ${details.resolvedExecutable ?? 'not found'}`);
    lines.push(`${prefix}   PATH: ${details.path || '<empty>'}`);
    if (details.diagnosis) lines.push(`${prefix}   diagnosis: ${details.diagnosis}`);
  }
  lines.push(`${prefix} error chain:`);
  for (const [index, item] of errorChain(normalized).entries()) {
    lines.push(`${prefix}   ${index + 1}. ${item.name ?? 'Error'}: ${item.message ?? String(item)}`);
    appendErrorProperties(lines, item, `${prefix}      `);
    if (item.stack) {
      lines.push(`${prefix}      stack:`);
      for (const stackLine of item.stack.split(/\r?\n/u)) {
        lines.push(`${prefix}        ${stackLine}`);
      }
    }
  }
  return lines.join('\n');
}

export { formatCommand, resolveExecutable };
