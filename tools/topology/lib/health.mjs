import net from 'node:net';

import http from 'node:http';
import https from 'node:https';

export function isHttpHealthy(url, path = '/healthz', timeoutMs = 2000, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let parsed;
    try {
      parsed = new URL(path, url);
    } catch {
      resolve(false);
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (healthy) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      resolve(healthy);
    };
    const request = transport.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        finish(response.statusCode >= 200 && response.statusCode < 300);
      },
    );
    const abort = () => {
      request.destroy();
      finish(false);
    };
    signal?.addEventListener('abort', abort, { once: true });
    request.on('error', () => finish(false));
    request.on('timeout', () => {
      request.destroy();
      finish(false);
    });
  });
}

function waitForRetry(intervalMs, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      resolve(completed);
    };
    const timeout = setTimeout(() => finish(true), intervalMs);
    const abort = () => finish(false);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function isTcpPortOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function waitForHttpHealthy(url, options = {}) {
  const {
    path = '/healthz',
    timeoutMs = 2000,
    attempts = 90,
    intervalMs = 1000,
    signal,
  } = options;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) return false;
    if (await isHttpHealthy(url, path, timeoutMs, signal)) {
      return true;
    }
    if (attempt + 1 < attempts && !await waitForRetry(intervalMs, signal)) return false;
  }
  return false;
}
