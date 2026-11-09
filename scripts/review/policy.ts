import { createHash } from 'node:crypto';

import { CommandError } from '../migration/cli.ts';

/**
 * The staging host review's OWN rules (Rebaseline R2;
 * OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP) — what the operator command
 * adds on top of the services it calls, and nothing the services decide.
 *
 * PICTURES. The owner's standing rule for the pre-adoption staging build: only
 * pictures on FIRST-PARTY Minhaj-ul-Quran International hosts are decided
 * public, and that decision names the R2 attestation that admits them
 * (`OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS`,
 * OPEN_DECISIONS.md §3.7, §3.9). A picture on any other host stays restricted
 * unless the operator repeats that exact host in an explicit argument. The
 * licence, the evidence and the rights holder are always the operator's
 * explicit arguments — nothing here supplies one. Migration's own service then
 * admits only restricted acquisitions on a host the run's source registers,
 * whose source stated organisational ownership with evidence, with a public
 * copy, and decides and audits each one on its own.
 *
 * CONFIRMATION. An act runs only over the exact set a preview printed: its
 * size and fingerprint. Migration's run-wide acts are confirmed by the
 * service itself; the Editorial queue page is confirmed here, in the same
 * shape — the SHA-256 of every item's `id:version`, in order, one per line —
 * so the operator reads one kind of confirmation, and each item still carries
 * the version shown, which Editorial's workflow re-checks.
 */

/** The owner attestation every first-party picture decision names. */
export const R2_ATTESTATION =
  'OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS';

/**
 * Minhaj-ul-Quran International's own domains — every host of a catalogued
 * authorised source and the first-party asset hosts they name
 * (`scripts/migration/sources/catalogue.ts`; MIGRATION_STRATEGY.md §18–19).
 * A host is first-party when it IS one of these or a subdomain of one.
 */
export const FIRST_PARTY_MINHAJ_DOMAINS: readonly string[] = Object.freeze([
  'minhaj.org',
  'minhaj.net',
  'minhaj.info',
  'minhaj.tv',
  'minhajbooks.com',
  'minhajoverseas.com',
  'irfan-ul-quran.com',
  'thefatwa.com',
]);

/** A lower-case DNS host name, as Migration's own schema shapes one. */
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;

export function isFirstPartyMinhajHost(host: string): boolean {
  if (!HOST.test(host)) return false;
  return FIRST_PARTY_MINHAJ_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

export interface RightsDecision {
  readonly host: string;
  readonly licence: string;
  readonly licenceEvidence: string;
  readonly rightsHolder: string;
  /** The `--decide-non-first-party-host` value: the same host, or absent. */
  readonly nonFirstPartyHost: string | null;
}

/**
 * Refuses a picture decision the standing rule does not admit, before any
 * service is asked: a non-first-party host the operator did not name again
 * explicitly, a first-party decision whose evidence does not name the R2
 * attestation, and a repeat that names another host. Returns whether the host
 * is first-party.
 */
export function assertRightsPolicy(decision: RightsDecision): {
  readonly firstParty: boolean;
} {
  const firstParty = isFirstPartyMinhajHost(decision.host);
  if (decision.nonFirstPartyHost !== null && decision.nonFirstPartyHost !== decision.host)
    throw new CommandError(
      '--decide-non-first-party-host must repeat --host exactly; nothing was decided',
    );
  if (firstParty) {
    if (decision.nonFirstPartyHost !== null)
      throw new CommandError(
        'the host is first-party; --decide-non-first-party-host does not apply; nothing was decided',
      );
    if (!decision.licenceEvidence.includes(R2_ATTESTATION))
      throw new CommandError(
        `a first-party picture decision must name ${R2_ATTESTATION} in --evidence; nothing was decided`,
      );
  } else if (decision.nonFirstPartyHost === null) {
    throw new CommandError(
      'the host is not a first-party Minhaj host, so its pictures stay restricted unless --decide-non-first-party-host repeats it; nothing was decided',
    );
  }
  return { firstParty };
}

/** The size and fingerprint of an ordered set of `id:version` keys. */
export function selectionConfirmation(
  keys: readonly { readonly id: string; readonly version: number }[],
): { readonly count: number; readonly fingerprint: string } {
  return {
    count: keys.length,
    fingerprint: createHash('sha256')
      .update(keys.map((key) => `${key.id}:${String(key.version)}`).join('\n'), 'utf8')
      .digest('hex'),
  };
}
