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
    SDKWORK_CLAW_DATABASE_ENGINE: 'postgresql',
    SDKWORK_CLAW_DATABASE_HOST: CANONICAL_DEV_CLAW_DATABASE.host,
    SDKWORK_CLAW_DATABASE_PORT: CANONICAL_DEV_CLAW_DATABASE.port,
    SDKWORK_CLAW_DATABASE_NAME: CANONICAL_DEV_CLAW_DATABASE.name,
    SDKWORK_CLAW_DATABASE_USERNAME: CANONICAL_DEV_CLAW_DATABASE.username,
    SDKWORK_CLAW_DATABASE_PASSWORD: CANONICAL_DEV_CLAW_DATABASE.password,
    SDKWORK_CLAW_DATABASE_SSL_MODE: CANONICAL_DEV_CLAW_DATABASE.sslMode,
  });

  assert.equal(
    url,
    'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  );
});

test('resolveIamDatabaseEnv prefers claw profile over per-app database fields', () => {
  const iam = createIamDatabaseHelpers({
    database: { appPrefix: 'SDKWORK_KNOWLEDGEBASE' },
  });

  const resolved = iam.resolveIamDatabaseEnv({
    SDKWORK_CLAW_DATABASE_ENGINE: 'postgresql',
    SDKWORK_CLAW_DATABASE_HOST: '127.0.0.1',
    SDKWORK_CLAW_DATABASE_PORT: '5432',
    SDKWORK_CLAW_DATABASE_NAME: 'sdkwork_ai_dev',
    SDKWORK_CLAW_DATABASE_USERNAME: 'sdkwork_ai_dev',
    SDKWORK_CLAW_DATABASE_PASSWORD: 'sdkworkdev123',
    SDKWORK_CLAW_DATABASE_SSL_MODE: 'disable',
    SDKWORK_KNOWLEDGEBASE_DATABASE_ENGINE: 'postgresql',
    SDKWORK_KNOWLEDGEBASE_DATABASE_HOST: '127.0.0.1',
    SDKWORK_KNOWLEDGEBASE_DATABASE_PORT: '5432',
    SDKWORK_KNOWLEDGEBASE_DATABASE_NAME: 'sdkwork_ai_dev',
    SDKWORK_KNOWLEDGEBASE_DATABASE_USERNAME: 'sdkworkdev',
    SDKWORK_KNOWLEDGEBASE_DATABASE_PASSWORD: 'sdkwork_dev_password',
    SDKWORK_KNOWLEDGEBASE_DATABASE_SSL_MODE: 'disable',
  });

  assert.equal(
    resolved.SDKWORK_IAM_DATABASE_URL,
    'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  );
});

test('resolveClawDatabaseEnv mirrors claw URL into IAM and generic database env', () => {
  const resolved = resolveClawDatabaseEnv({
    SDKWORK_CLAW_DATABASE_URL:
      'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  });

  assert.equal(
    resolved.SDKWORK_IAM_DATABASE_URL,
    'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  );
  assert.equal(
    resolved.SDKWORK_DATABASE_URL,
    'postgresql://sdkwork_ai_dev:sdkworkdev123@127.0.0.1:5432/sdkwork_ai_dev?sslmode=disable',
  );
});
