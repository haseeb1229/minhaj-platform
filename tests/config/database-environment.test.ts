import { describe, expect, it } from 'vitest';

import {
  DatabaseConfigurationError,
  getDatabaseMigrationUrl,
  getDatabaseRuntimeUrl,
  parseDatabaseEnvironment,
} from '../../packages/database/src/config.ts';

const valid = {
  DATABASE_URL:
    'sqlserver://localhost:14330;database=master;user=sa;password=runtime-test-value;encrypt=true',
  DATABASE_MIGRATION_URL:
    'sqlserver://localhost:14330;database=master;user=sa;password=migration-test-value;encrypt=true',
};

describe('database environment', () => {
  it('keeps runtime and migration URLs separate', () => {
    const parsed = parseDatabaseEnvironment(valid);

    expect(parsed.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(parsed.DATABASE_MIGRATION_URL).toBe(valid.DATABASE_MIGRATION_URL);
  });

  it('does not require migration credentials in the runtime path', () => {
    expect(getDatabaseRuntimeUrl({ DATABASE_URL: valid.DATABASE_URL })).toBe(
      valid.DATABASE_URL,
    );
  });

  it('validates migration credentials independently', () => {
    expect(() => getDatabaseMigrationUrl({ DATABASE_URL: valid.DATABASE_URL })).toThrow(
      /DATABASE_MIGRATION_URL/,
    );
  });

  it('identifies invalid variables without echoing supplied values', () => {
    const suppliedValue = 'do-not-echo-this-test-value';

    expect(() =>
      parseDatabaseEnvironment({
        DATABASE_URL: suppliedValue,
        DATABASE_MIGRATION_URL: valid.DATABASE_MIGRATION_URL,
      }),
    ).toThrow(DatabaseConfigurationError);

    try {
      parseDatabaseEnvironment({
        DATABASE_URL: suppliedValue,
        DATABASE_MIGRATION_URL: valid.DATABASE_MIGRATION_URL,
      });
    } catch (error) {
      expect(String(error)).toContain('DATABASE_URL');
      expect(String(error)).not.toContain(suppliedValue);
    }
  });

  it('rejects missing database URLs with no default value', () => {
    expect(() => parseDatabaseEnvironment({})).toThrow(/DATABASE_MIGRATION_URL/);
    expect(() => parseDatabaseEnvironment({})).toThrow(/DATABASE_URL/);
  });
});
