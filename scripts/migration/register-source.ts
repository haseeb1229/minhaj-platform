import { composeMigrationRunner } from '../../apps/web/src/composition/migration-runner.ts';
import { argument, CommandError, required, runCommand } from './cli.ts';
import { authorisedSource } from './sources/catalogue.ts';

/**
 * `npm run migration:register-source -- --source <key> --operator <accountId>
 *    --authorisation-reference <reference> --authorised-on <YYYY-MM-DD>
 *    [--licensing-evidence <text>] [--activate]`
 *
 * Registers ONE authorised source from the committed catalogue
 * (`./sources/catalogue.ts`) as the named operator, whose
 * `migration.administer` is read live. The source is created INACTIVE; with
 * `--activate` it is then activated — two audited acts.
 *
 * THE AUTHORISATION IS THE OPERATOR'S STATEMENT. The written reference and its
 * date are recorded on the source and audited; the platform checks their
 * shape, not the organisational decision behind them (OPEN_DECISIONS.md
 * §3.1.1). Nothing secret belongs in either value.
 *
 * IDEMPOTENT. Re-running for a registered key changes nothing unless it must
 * activate; a registered source whose kind, base or page hosts differ from the
 * catalogue is refused, never altered — those never change.
 *
 * ASSET HOSTS (Phase 30-R). A source registered before the catalogue named an
 * asset host is given each missing one as its own audited, append-only act,
 * carrying the catalogue's first-party evidence; an asset host the catalogue
 * does not name is refused, never removed.
 */

const USAGE =
  'migration:register-source -- --source <key> --operator <accountId> ' +
  '--authorisation-reference <reference> --authorised-on <YYYY-MM-DD> ' +
  '[--licensing-evidence <text>] [--activate]';

await runCommand('migration:register-source', async () => {
  const key = required('--source', USAGE);
  const operator = required('--operator', USAGE);
  const reference = required('--authorisation-reference', USAGE);
  const authorisedOn = required('--authorised-on', USAGE);
  const licensingEvidence = argument('--licensing-evidence') ?? null;
  const activate = process.argv.includes('--activate');

  const definition = authorisedSource(key);
  if (definition === null)
    throw new CommandError(`'${key}' is not in the source catalogue`);

  const runner = composeMigrationRunner();
  const actor = { accountId: operator };
  let source = await runner.sources.sourceByKey(actor, key);
  let registered = false;
  if (source === null) {
    source = await runner.sources.registerAuthorised(actor, {
      key: definition.key,
      name: definition.name,
      contentKind: definition.contentKind,
      accessMethod: 'http',
      baseUrl: definition.baseUrl,
      hosts: [...definition.hosts],
      assetHosts: [...definition.assetHosts],
      defaultLanguageCode: definition.defaultLanguageCode,
      policy: definition.policy,
      authorisationReference: reference,
      authorisedOn,
      licensingEvidence,
      policyNotes: definition.policyNotes,
    });
    registered = true;
  } else if (
    source.authorityKind !== 'authorised' ||
    source.contentKind !== definition.contentKind ||
    source.baseUrl !== definition.baseUrl ||
    [...source.hosts].sort().join(' ') !== [...definition.hosts].sort().join(' ')
  ) {
    throw new CommandError(`'${key}' is registered with another kind, base or host list`);
  }

  if (source.assetHosts.some((host) => !definition.assetHosts.includes(host)))
    throw new CommandError(`'${key}' has an asset host the catalogue does not name`);
  let assetHostsAdded = 0;
  for (const host of definition.assetHosts) {
    if (source.assetHosts.includes(host)) continue;
    if (definition.assetHostEvidence === null)
      throw new CommandError(`'${key}' names an asset host without evidence`);
    source = await runner.sources.addAssetHost(actor, {
      sourceId: source.id,
      expectedVersion: source.version,
      host,
      evidence: definition.assetHostEvidence,
    });
    assetHostsAdded += 1;
  }

  let activated = false;
  if (activate && source.state !== 'active') {
    source = await runner.sources.update(actor, {
      id: source.id,
      expectedVersion: source.version,
      name: source.name,
      state: 'active',
      defaultLanguageCode: source.defaultLanguageCode,
      policy: source.policy,
      licensingEvidence: source.licensingEvidence,
      policyNotes: source.policyNotes,
    });
    activated = true;
  }

  return {
    source: source.key,
    contentKind: source.contentKind,
    hosts: source.hosts.length,
    assetHosts: source.assetHosts.length,
    assetHostsAdded,
    state: source.state,
    registered,
    activated,
  };
});
