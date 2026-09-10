import { loadLocalDatabaseEnvironment } from '../../packages/database/src/lifecycle/local-environment.ts';

/**
 * Applies the ignored local `docker/.env` for the live database tests.
 *
 * The `db:*` commands take a RESOLVED record and pass it explicitly, but a test
 * runner cannot: the suites read configuration through module-level helpers
 * defaulting to `process.env`, so the run has to be configured once, here.
 *
 * It delegates to the same loader those commands use, so the test run and
 * `npm run db:migrate:test` cannot resolve different configuration. The file is
 * OPTIONAL at this level — a machine without the container still runs the whole
 * offline suite, and the live suites skip themselves when configuration is
 * absent. It is the COMMANDS that require the file, because they are the ones
 * that would otherwise mutate a database chosen by an ambient shell variable.
 *
 * A malformed file fails the entire run rather than partly configuring it,
 * which is the intended behaviour: there is no half-resolved state to test in.
 */
loadLocalDatabaseEnvironment(process.env, { requireLocalFile: false });
