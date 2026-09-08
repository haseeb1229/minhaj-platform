import 'server-only';

import { z } from 'zod';

const sqlServerUrl = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.startsWith('sqlserver://'));

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: sqlServerUrl,
  DATABASE_MIGRATION_URL: sqlServerUrl,
});

const databaseRuntimeEnvironmentSchema = databaseEnvironmentSchema.pick({
  DATABASE_URL: true,
});

const databaseMigrationEnvironmentSchema = databaseEnvironmentSchema.pick({
  DATABASE_MIGRATION_URL: true,
});

export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;

export class DatabaseConfigurationError extends Error {
  constructor(variableNames: readonly string[]) {
    super(`Invalid database configuration: ${variableNames.join(', ')}`);
    this.name = 'DatabaseConfigurationError';
  }
}

function invalidVariableNames(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0])))].sort();
}

export function parseDatabaseEnvironment(
  source: Record<string, string | undefined> = process.env,
): DatabaseEnvironment {
  const result = databaseEnvironmentSchema.safeParse(source);
  if (result.success) return result.data;

  throw new DatabaseConfigurationError(invalidVariableNames(result.error));
}

export function getDatabaseRuntimeUrl(
  source: Record<string, string | undefined> = process.env,
): string {
  const result = databaseRuntimeEnvironmentSchema.safeParse(source);
  if (result.success) return result.data.DATABASE_URL;

  throw new DatabaseConfigurationError(invalidVariableNames(result.error));
}

export function getDatabaseMigrationUrl(
  source: Record<string, string | undefined> = process.env,
): string {
  const result = databaseMigrationEnvironmentSchema.safeParse(source);
  if (result.success) return result.data.DATABASE_MIGRATION_URL;

  throw new DatabaseConfigurationError(invalidVariableNames(result.error));
}
