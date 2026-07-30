import { normalizeText } from './env-file.mjs';

function encodePostgresPath(databaseName) {
  return encodeURIComponent(databaseName).replaceAll('%2F', '/');
}

export function buildPostgresDatabaseUrl({
  host,
  port,
  database,
  username,
  password,
  sslMode,
}) {
  const credentials = `${encodeURIComponent(username)}:${encodeURIComponent(password ?? '')}`;
  const authority = `${credentials}@${host}${port ? `:${port}` : ''}`;
  const params = new URLSearchParams();
  const normalizedSslMode = normalizeText(sslMode);
  if (normalizedSslMode) {
    params.set('sslmode', normalizedSslMode);
  }
  const query = params.toString();
  return `postgresql://${authority}/${encodePostgresPath(database)}${query ? `?${query}` : ''}`;
}

export function resolveClawDatabaseUrlFromEnv(env) {
  const retiredKey = Object.keys(env).find(
    (key) => /^SDKWORK_(?!DATABASE_)[A-Z0-9_]+_DATABASE_/u.test(key),
  );
  if (retiredKey) {
    throw new Error(`${retiredKey} is retired; use SDKWORK_DATABASE_*`);
  }

  const directUrl = normalizeText(env.SDKWORK_DATABASE_URL);
  if (directUrl) {
    return directUrl;
  }

  const engine = normalizeText(env.SDKWORK_DATABASE_ENGINE)?.toLowerCase();
  if (engine !== 'postgresql' && engine !== 'postgres') {
    return undefined;
  }

  const host = normalizeText(env.SDKWORK_DATABASE_HOST);
  const database = normalizeText(env.SDKWORK_DATABASE_NAME);
  const username = normalizeText(env.SDKWORK_DATABASE_USERNAME);
  const password = env.SDKWORK_DATABASE_PASSWORD;
  if (!host || !database || !username || password === undefined) {
    return undefined;
  }

  const port = normalizeText(env.SDKWORK_DATABASE_PORT) || '5432';
  const sslMode = normalizeText(env.SDKWORK_DATABASE_SSL_MODE) || 'disable';
  return buildPostgresDatabaseUrl({
    host,
    port,
    database,
    username,
    password: password ?? '',
    sslMode,
  });
}

export function resolveClawDatabaseEnv(env) {
  const merged = { ...env };
  const databaseUrl = resolveClawDatabaseUrlFromEnv(merged);
  if (!databaseUrl) {
    return merged;
  }

  merged.SDKWORK_DATABASE_URL = merged.SDKWORK_DATABASE_URL || databaseUrl;
  return merged;
}

export const CANONICAL_DEV_CLAW_DATABASE = {
  engine: 'postgresql',
  host: '127.0.0.1',
  port: '5432',
  name: 'sdkwork_ai_dev',
  schema: 'sdkwork_ai_dev',
  username: 'sdkwork_ai_dev',
  password: 'sdkworkdev123',
  sslMode: 'disable',
  maxConnections: '10',
};

export const CANONICAL_PRODUCTION_CLAW_DATABASE = {
  engine: 'postgresql',
  name: 'sdkwork_ai_prod',
  schema: 'sdkwork_ai_prod',
  username: 'sdkwork_ai_prod',
  sslMode: 'require',
};
