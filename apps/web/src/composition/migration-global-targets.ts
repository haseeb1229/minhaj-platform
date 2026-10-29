import 'server-only';

import type { CountryRecord, GlobalActor } from '@minhaj/contracts/global';
import type {
  MigrationActor,
  MigrationContentKind,
  MigrationPublicationTargetPort,
  StagedCountryPayload,
  TargetPublication,
} from '@minhaj/contracts/migration';

import { globalFailure, type GlobalService } from '../contexts/global-network/index.ts';
import {
  ADOPTION_PAGES,
  askerOf,
  publishing,
  refusal,
  withdrawalRefusal,
  withdrawing,
} from './migration-target-support.ts';

/**
 * The `global.country` publication target — Layer 4 (Phase 30-R;
 * MIGRATION_STRATEGY.md §4.12, §7).
 *
 * THROUGH GLOBAL NETWORK'S PUBLIC SERVICE. A migrated Country is saved by
 * `saveCountry` exactly as an operator's is — Global's strict schema, its live
 * `global.administer`, its own audit — PUBLISHED, with the ISO code and the
 * name the organisation's own page uses. No Region, City or Centre is made:
 * the source states presence in a country, never an address.
 *
 * ADOPTION ONLY ON RESUME, ONLY FOR AN EXACT MATCH: a resumed entry meeting a
 * taken code or slug adopts a PUBLISHED Country with exactly this code, slug
 * and labels; anything else is left for a person. A refresh re-saves the
 * payload's labels at the version Global holds, keeping its state.
 *
 * WITHDRAWAL archives at the recorded version. Nothing personal can name a
 * Country, so it is never held.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

export type GlobalCountryOperations = Pick<
  GlobalService,
  'saveCountry' | 'country' | 'countries'
>;

/** Global's administrative directory page size. */
const DIRECTORY_PAGE = 25;

const ask = askerOf(globalFailure);
const asGlobal = (actor: MigrationActor): GlobalActor => ({ accountId: actor.accountId });
const canonicalPath = (slug: string) => `/global/countries/${slug}`;

function countryInput(payload: StagedCountryPayload, state: 'published' | 'archived') {
  return {
    code: payload.code,
    slug: payload.slug,
    primaryLocale: payload.primaryLocale,
    state,
    labels: payload.labels.map((label) => ({ locale: label.locale, name: label.name })),
  };
}

function published(record: CountryRecord): TargetPublication {
  return {
    status: 'published',
    target: { kind: 'global.country', id: record.id },
    stage: 'public',
    version: record.version,
    canonicalPath: canonicalPath(record.slug),
  };
}

/** Whether a Country Global holds carries exactly this payload's words. */
function sameCountry(record: CountryRecord, payload: StagedCountryPayload): boolean {
  return (
    record.code === payload.code &&
    record.slug === payload.slug &&
    record.labels.length === payload.labels.length &&
    payload.labels.every((label) =>
      record.labels.some(
        (held) => held.locale === label.locale && held.name === label.name.trim(),
      ),
    )
  );
}

export function globalCountryTargetOver(deps: {
  readonly global: GlobalCountryOperations;
}): MigrationPublicationTargetPort {
  const { global } = deps;
  const supports = (kind: MigrationContentKind) => kind === 'global.country';

  async function adopt(
    actor: GlobalActor,
    payload: StagedCountryPayload,
  ): Promise<TargetPublication> {
    for (let page = 0; page < ADOPTION_PAGES; page += 1) {
      const listing = await ask(() =>
        global.countries(actor, {
          offset: page * DIRECTORY_PAGE,
          text: payload.labels[0]?.name ?? payload.code,
        }),
      );
      if (!listing.ok) return refusal(listing.reason);
      const match = listing.value.items.find(
        (item) => item.code === payload.code || item.slug === payload.slug,
      );
      if (match !== undefined) {
        if (!sameCountry(match, payload)) return refusal('target-conflict');
        if (match.state !== 'published') return refusal('target-not-published');
        return published(match);
      }
      if (!listing.value.hasMore) break;
    }
    return refusal('target-conflict');
  }

  return {
    supports,

    async publish({ kind, payload, actor, resumed }) {
      if (!supports(kind) || payload.kind !== 'global.country')
        return refusal('unsupported-kind');
      const globalActor = asGlobal(actor);
      return publishing(async () => {
        const saved = await ask(() =>
          global.saveCountry(globalActor, null, null, countryInput(payload, 'published')),
        );
        if (saved.ok) return published(saved.value);
        if (saved.reason === 'duplicate-code' || saved.reason === 'duplicate-slug')
          return resumed ? adopt(globalActor, payload) : refusal('target-exists');
        return refusal(saved.reason);
      });
    },

    async refresh({ kind, target, payload, actor }) {
      if (!supports(kind) || payload.kind !== 'global.country' || target.kind !== kind)
        return refusal('unsupported-kind');
      const globalActor = asGlobal(actor);
      return publishing(async () => {
        const found = await ask(() => global.country(globalActor, target.id));
        if (!found.ok) return refusal(found.reason);
        const record = found.value;
        if (record === null) return refusal('not-found');
        if (record.state !== 'published') return refusal('target-not-published');
        if (sameCountry(record, payload)) return published(record);
        const saved = await ask(() =>
          global.saveCountry(
            globalActor,
            record.id,
            record.version,
            countryInput(payload, 'published'),
          ),
        );
        return saved.ok ? published(saved.value) : refusal(saved.reason);
      });
    },

    async inspect({ target, actor }) {
      if (!supports(target.kind)) return null;
      const record = await global.country(asGlobal(actor), target.id);
      if (record === null)
        return { exists: false, version: 0, referencedByPeople: false };
      return { exists: true, version: record.version, referencedByPeople: false };
    },

    async withdraw({ target, expectedVersion, actor }) {
      if (!supports(target.kind)) return withdrawalRefusal('unsupported-kind');
      const globalActor = asGlobal(actor);
      return withdrawing(async () => {
        const found = await ask(() => global.country(globalActor, target.id));
        if (!found.ok) return withdrawalRefusal(found.reason);
        const record = found.value;
        if (record === null) return withdrawalRefusal('not-found');
        if (record.version !== expectedVersion) return withdrawalRefusal('conflict');
        const archived = await ask(() =>
          global.saveCountry(globalActor, record.id, expectedVersion, {
            code: record.code,
            slug: record.slug,
            primaryLocale: record.primaryLocale,
            state: 'archived',
            labels: record.labels.map((label) => ({
              locale: label.locale,
              name: label.name,
            })),
          }),
        );
        if (!archived.ok) return withdrawalRefusal(archived.reason);
        return { status: 'withdrawn', version: archived.value.version };
      });
    },
  };
}
