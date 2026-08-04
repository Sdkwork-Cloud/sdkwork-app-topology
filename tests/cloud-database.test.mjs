import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_DEV_CLOUD_DATABASE,
  resolveCloudDatabaseEnv,
  resolveCloudDatabaseUrlFromEnv,
} from '../tools/topology/lib/cloud-database.mjs';
import { createIamDatabaseHelpers } from '../tools/topology/lib/iam-database.mjs';

test('resolveCloudDatabaseUrlFromEnv builds canonical development URL', () => {
  const url = resolveCloudDatabaseUrlFromEnv({
    SDKWORK_DATABASE_ENGINE: 'postgresql',
    SDKWORK_DATABASE_HOST: CANONICAL_DEV_CLOUD_DATABASE.host,
    SDKWORK_DATABASE_PORT: CANONICAL_DEV_CLOUD_DATABASE.port,
    SDKWORK_DATABASE_NAME: CANONICAL_DEV_CLOUD_DATABASE.name,
    SDKWORK_DATABASE_USERNAME: CANONICAL_DEV_CLOUD_DATABASE.username,
    SDKWORK_DATABASE_PASSWORD: CANONICAL_DEV_CLOUD_DATABASE.password,
    SDKWORK_DATABASE_SSL_MODE: CANONICAL_DEV_CLOUD_DATABASE.sslMode,
  });

  assert.equal(
    url,
    'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  );
});

test('resolveIamDatabaseEnv uses only the canonical workspace profile', () => {
  const iam = createIamDatabaseHelpers({
    appId: 'sdkwork-knowledgebase',
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

test('resolveCloudDatabaseEnv preserves a canonical direct URL without aliases', () => {
  const resolved = resolveCloudDatabaseEnv({
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
  const retiredKey = ['SDKWORK', 'CLOUD', 'DATABASE', 'URL'].join('_');
  assert.throws(
    () => resolveCloudDatabaseEnv({ [retiredKey]: 'postgresql://localhost/legacy' }),
    /is retired; use SDKWORK_DATABASE_\*/u,
  );
});
