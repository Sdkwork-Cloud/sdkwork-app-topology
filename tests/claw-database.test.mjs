import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_DEV_CLAW_DATABASE,
  resolveClawDatabaseEnv,
  resolveClawDatabaseUrlFromEnv,
} from '../tools/topology/lib/claw-database.mjs';
import { createIamDatabaseHelpers } from '../tools/topology/lib/iam-database.mjs';

test('resolveClawDatabaseUrlFromEnv builds canonical development URL', () => {
  const url = resolveClawDatabaseUrlFromEnv({
    SDKWORK_DATABASE_ENGINE: 'postgresql',
    SDKWORK_DATABASE_HOST: CANONICAL_DEV_CLAW_DATABASE.host,
    SDKWORK_DATABASE_PORT: CANONICAL_DEV_CLAW_DATABASE.port,
    SDKWORK_DATABASE_NAME: CANONICAL_DEV_CLAW_DATABASE.name,
    SDKWORK_DATABASE_USERNAME: CANONICAL_DEV_CLAW_DATABASE.username,
    SDKWORK_DATABASE_PASSWORD: CANONICAL_DEV_CLAW_DATABASE.password,
    SDKWORK_DATABASE_SSL_MODE: CANONICAL_DEV_CLAW_DATABASE.sslMode,
  });

  assert.equal(
    url,
    'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  );
});

test('resolveIamDatabaseEnv uses only the canonical workspace profile', () => {
  const iam = createIamDatabaseHelpers({
    database: { appPrefix: 'SDKWORK_KNOWLEDGEBASE' },
  });

  const resolved = iam.resolveIamDatabaseEnv({
    SDKWORK_DATABASE_ENGINE: 'postgresql',
    SDKWORK_DATABASE_HOST: '127.0.0.1',
    SDKWORK_DATABASE_PORT: '5432',
    SDKWORK_DATABASE_NAME: 'sdkwork_ai_dev',
    SDKWORK_DATABASE_USERNAME: 'sdkwork_ai_dev',
    SDKWORK_DATABASE_PASSWORD: 'sdkworkdev123',
    SDKWORK_DATABASE_SSL_MODE: 'disable',
  });

  assert.equal(
    resolved.SDKWORK_DATABASE_URL,
    'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  );
});

test('resolveClawDatabaseEnv preserves a canonical direct URL without aliases', () => {
  const resolved = resolveClawDatabaseEnv({
    SDKWORK_DATABASE_URL:
      'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  });

  assert.equal(
    resolved.SDKWORK_DATABASE_URL,
    'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  );
  assert.deepEqual(Object.keys(resolved), ['SDKWORK_DATABASE_URL']);
});

test('database helpers reject module-scoped aliases', () => {
  const retiredKey = ['SDKWORK', 'CLAW', 'DATABASE', 'URL'].join('_');
  assert.throws(
    () => resolveClawDatabaseEnv({ [retiredKey]: 'postgresql://localhost/legacy' }),
    /is retired; use SDKWORK_DATABASE_\*/u,
  );
});
