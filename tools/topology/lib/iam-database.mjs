import { ensurePostgresDevEnvFile, loadEnvFile, normalizeText } from './env-file.mjs';
import { isTcpPortReachable } from './postgres.mjs';
import {
  buildPostgresDatabaseUrl,
  resolveClawDatabaseEnv,
  resolveClawDatabaseUrlFromEnv,
} from './claw-database.mjs';

export function createIamDatabaseHelpers(spec) {
  const databaseKeys = spec.database ?? {};
  const appPrefix = databaseKeys.appPrefix ?? 'SDKWORK_APP';

  function resolveIamDatabaseEnv(env) {
    const merged = resolveClawDatabaseEnv({ ...env });

    const existingUrl = normalizeText(merged.SDKWORK_IAM_DATABASE_URL)
      || normalizeText(merged.SDKWORK_CLAW_DATABASE_URL)
      || normalizeText(merged.SDKWORK_DATABASE_URL)
      || normalizeText(merged.DATABASE_URL);
    if (existingUrl) {
      merged.SDKWORK_IAM_DATABASE_URL = merged.SDKWORK_IAM_DATABASE_URL || existingUrl;
      merged.SDKWORK_CLAW_DATABASE_URL = merged.SDKWORK_CLAW_DATABASE_URL || existingUrl;
      merged.SDKWORK_DATABASE_URL = merged.SDKWORK_DATABASE_URL || existingUrl;
      return merged;
    }

    const clawUrl = resolveClawDatabaseUrlFromEnv(merged);
    if (clawUrl) {
      merged.SDKWORK_IAM_DATABASE_URL = clawUrl;
      merged.SDKWORK_CLAW_DATABASE_URL = clawUrl;
      merged.SDKWORK_DATABASE_URL = clawUrl;
      return merged;
    }

    const appUrlKey = databaseKeys.url ?? `${appPrefix}_DATABASE_URL`;
    const appUrl = normalizeText(merged[appUrlKey]);
    if (appUrl && (appUrl.startsWith('postgres://') || appUrl.startsWith('postgresql://'))) {
      merged.SDKWORK_IAM_DATABASE_URL = appUrl;
      merged.SDKWORK_DATABASE_URL = appUrl;
      merged.SDKWORK_CLAW_DATABASE_URL = appUrl;
      return merged;
    }

    const engineKey = databaseKeys.engine ?? `${appPrefix}_DATABASE_ENGINE`;
    const engine = normalizeText(merged[engineKey])?.toLowerCase();
    if (engine === 'postgresql' || engine === 'postgres') {
      const host = normalizeText(merged[databaseKeys.host ?? `${appPrefix}_DATABASE_HOST`]);
      const database = normalizeText(merged[databaseKeys.name ?? `${appPrefix}_DATABASE_NAME`]);
      const username = normalizeText(merged[databaseKeys.username ?? `${appPrefix}_DATABASE_USERNAME`]);
      const password = merged[databaseKeys.password ?? `${appPrefix}_DATABASE_PASSWORD`];
      if (host && database && username && password !== undefined) {
        const port = normalizeText(merged[databaseKeys.port ?? `${appPrefix}_DATABASE_PORT`]) || '5432';
        const sslMode = normalizeText(merged[databaseKeys.sslMode ?? `${appPrefix}_DATABASE_SSL_MODE`]) || 'disable';
        const url = buildPostgresDatabaseUrl({
          host,
          port,
          database,
          username,
          password: password ?? '',
          sslMode,
        });
        merged.SDKWORK_IAM_DATABASE_URL = url;
        merged.SDKWORK_DATABASE_URL = url;
        merged.SDKWORK_CLAW_DATABASE_URL = url;
      }
    }

    return merged;
  }

  function describeIamDatabaseTarget(env) {
    const url = normalizeText(env.SDKWORK_IAM_DATABASE_URL)
      || normalizeText(env.SDKWORK_CLAW_DATABASE_URL)
      || normalizeText(env.SDKWORK_DATABASE_URL);
    if (url) {
      try {
        const parsed = new URL(url);
        const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
        return `${parsed.hostname}:${parsed.port || '5432'}/${database}`;
      } catch {
        return url;
      }
    }

    const host = normalizeText(env.SDKWORK_CLAW_DATABASE_HOST)
      || normalizeText(env[databaseKeys.host ?? `${appPrefix}_DATABASE_HOST`]);
    const port = normalizeText(env.SDKWORK_CLAW_DATABASE_PORT)
      || normalizeText(env[databaseKeys.port ?? `${appPrefix}_DATABASE_PORT`])
      || '5432';
    const database = normalizeText(env.SDKWORK_CLAW_DATABASE_NAME)
      || normalizeText(env[databaseKeys.name ?? `${appPrefix}_DATABASE_NAME`]);
    if (host && database) {
      return `${host}:${port}/${database}`;
    }
    return 'unknown';
  }

  function applicationBootstrapEnvAliases(repoRoot, env = {}) {
    if (!repoRoot) {
      return {};
    }

    const resolvedAppRoot = normalizeText(env.SDKWORK_APP_ROOT) || repoRoot;
    const aliases = {
      SDKWORK_APP_ROOT: resolvedAppRoot,
      SDKWORK_IAM_APP_ROOT: normalizeText(env.SDKWORK_IAM_APP_ROOT) || resolvedAppRoot,
    };

    const appId = normalizeText(spec.appId);
    if (appId) {
      const slug = appId.startsWith('sdkwork-') ? appId.slice('sdkwork-'.length) : appId;
      const aliasKey = `SDKWORK_${slug.replace(/-/g, '_').toUpperCase()}_APP_ROOT`;
      if (!normalizeText(env[aliasKey])) {
        aliases[aliasKey] = resolvedAppRoot;
      }
    }

    return aliases;
  }

  async function assertPostgresReachableForIam(env, options = {}) {
    const url = normalizeText(env.SDKWORK_IAM_DATABASE_URL)
      || normalizeText(env.SDKWORK_CLAW_DATABASE_URL)
      || normalizeText(env.SDKWORK_DATABASE_URL);
    if (!url) {
      throw new Error(
        options.missingDatabaseMessage
          ?? 'IAM requires PostgreSQL for dev login. Configure .env.postgres with SDKWORK_CLAW_DATABASE_* and start PostgreSQL.',
      );
    }

    let host = '127.0.0.1';
    let port = 5432;
    try {
      const parsed = new URL(url);
      host = parsed.hostname || host;
      port = Number(parsed.port || '5432');
    } catch {
      // keep defaults
    }

    if (!(await isTcpPortReachable(port, host))) {
      throw new Error(
        options.unreachableDatabaseMessage
          ?? `PostgreSQL is not reachable at ${host}:${port} (IAM database).`,
      );
    }
  }

  function resolveIamDevEnv(env = process.env, repoRoot, options = {}) {
    const postgresFile = options.postgresEnvFile ?? '.env.postgres';
    if (options.ensurePostgresEnvFile !== false) {
      ensurePostgresDevEnvFile(repoRoot, {
        envFile: postgresFile,
        stdout: options.stdout,
      });
    }
    const postgresEnv = loadEnvFile(postgresFile, repoRoot);

    const runtimeWithoutDatabase = { ...env };
    for (const key of Object.keys(runtimeWithoutDatabase)) {
      const processDatabaseControl = key.startsWith('SDKWORK_DATABASE_TEMPORARY_');
      if (
        !processDatabaseControl
        && (
          key.startsWith('SDKWORK_CLAW_DATABASE_')
          || key.startsWith('SDKWORK_IAM_DATABASE_')
          || key.startsWith('SDKWORK_DATABASE_')
          || /^SDKWORK_[A-Z0-9_]+_DATABASE_/u.test(key)
        )
      ) {
        delete runtimeWithoutDatabase[key];
      }
    }

    return resolveIamDatabaseEnv({
      ...postgresEnv,
      ...applicationBootstrapEnvAliases(repoRoot, env),
      ...runtimeWithoutDatabase,
    });
  }

  return {
    resolveIamDatabaseEnv,
    describeIamDatabaseTarget,
    assertPostgresReachableForIam,
    resolveIamDevEnv,
  };
}
