import { loadLocalDatabaseEnvironment } from '../../packages/database/src/lifecycle/local-environment.ts';

/**
 * Applies the ignored local `docker/.env` for the live database tests.
 *
 * Vitest does not apply Node's `--env-file-if-exists`, which the `db:*`
 * commands rely on, so without this the live lifecycle tests would silently
 * skip during `npm test` — passing while proving nothing.
 *
 * It delegates to the same loader the lifecycle scripts use, so the test run
 * and `npm run db:migrate:test` cannot resolve different configuration. An
 * earlier revision kept its own copy of this parsing, with the opposite
 * precedence: it deferred to whatever the shell already had, which is the
 * behaviour that let two terminals disagree.
 */
loadLocalDatabaseEnvironment();
