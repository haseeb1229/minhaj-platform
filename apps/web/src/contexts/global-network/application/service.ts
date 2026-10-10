import 'server-only';

import { z } from 'zod';

import {
  applyContactChange,
  applyServedCityChange,
  centreInputSchema,
  cityInputSchema,
  contactChangeSchema,
  countryInputSchema,
  globalAdminQuerySchema,
  globalIdSchema,
  globalVersionSchema,
  regionInputSchema,
  servedCityChangeSchema,
  type GlobalActor,
  type GlobalAuthorityPort,
  type GlobalPersistencePort,
} from '@minhaj/contracts/global';

import { GlobalRefusal } from './refusal.ts';

/**
 * The Global Network administrative service — Country, Region, City, Centre and
 * its contacts and served Cities (DOMAIN_MODEL.md §17.1; DELIVERY_PLAN.md
 * Phase 16).
 *
 * TWO AUTHORITIES, RE-CHECKED LIVE ON EVERY CALL. `global.read` opens a record;
 * `global.administer` is what every change requires. The check is a read of the
 * principal's CURRENT permission set through the authority port, so a revoked
 * role refuses the next action rather than the next sign-in. No profile, no role
 * NAME and no `content.*` key is consulted: only these two keys grant anything.
 *
 * EVERY INPUT IS PARSED HERE, by strict schemas. A field nobody named is a
 * refusal, an expected version is compared rather than trusted, and a parent
 * the operator picked is checked against the record's Country before the
 * database refuses it a second time.
 *
 * NO EDITORIAL. Global never reads, writes or decides News; a Centre's News is
 * Editorial's, composed beside this at Layer 4.
 */

export function createGlobalService(deps: {
  readonly persistence: GlobalPersistencePort;
  readonly authority: GlobalAuthorityPort;
}) {
  const store = deps.persistence;

  async function permit(actor: GlobalActor, key: 'global.read' | 'global.administer') {
    if (!actor?.accountId || !(await deps.authority.permits(actor.accountId, key)))
      throw new GlobalRefusal('denied');
  }

  /** An edit names a record and its expected version; a create names neither. */
  function edit(id: string | null, version: number | null): void {
    if (id !== null) {
      globalIdSchema.parse(id);
      globalVersionSchema.parse(version);
    } else if (version !== null) throw new GlobalRefusal('invalid');
  }

  const text = (value: string | null) =>
    z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullable()
      .parse(value === '' ? null : value);

  /** The parents an operator picked, read in ANY state, so they can be checked. */
  async function parentsOf(input: {
    readonly countryId: string;
    readonly regionId: string | null;
    readonly cityId: string | null;
  }) {
    const [countries, regions, cities] = await Promise.all([
      store.choicesByIds('country', [input.countryId]),
      input.regionId === null
        ? Promise.resolve([])
        : store.choicesByIds('region', [input.regionId]),
      input.cityId === null
        ? Promise.resolve([])
        : store.choicesByIds('city', [input.cityId]),
    ]);
    if (
      countries.length !== 1 ||
      (input.regionId !== null && regions[0]?.countryId !== input.countryId) ||
      (input.cityId !== null && cities[0]?.countryId !== input.countryId)
    )
      throw new GlobalRefusal('invalid');
  }

  return {
    /* ---- Country ------------------------------------------------------- */

    async countries(actor: GlobalActor, raw: unknown = {}) {
      await permit(actor, 'global.read');
      return store.countries(globalAdminQuerySchema.parse(raw));
    },

    async country(actor: GlobalActor, id: string) {
      await permit(actor, 'global.read');
      return store.country(globalIdSchema.parse(id));
    },

    async saveCountry(
      actor: GlobalActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'global.administer');
      edit(id, expectedVersion);
      const value = countryInputSchema.parse(raw);
      return store.saveCountry({ actorId: actor.accountId, id, expectedVersion, value });
    },

    /* ---- Region -------------------------------------------------------- */

    async regions(actor: GlobalActor, raw: unknown = {}) {
      await permit(actor, 'global.read');
      return store.regions(globalAdminQuerySchema.parse(raw));
    },

    async region(actor: GlobalActor, id: string) {
      await permit(actor, 'global.read');
      return store.region(globalIdSchema.parse(id));
    },

    async saveRegion(
      actor: GlobalActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'global.administer');
      edit(id, expectedVersion);
      const value = regionInputSchema.parse(raw);
      await parentsOf({ countryId: value.countryId, regionId: null, cityId: null });
      return store.saveRegion({ actorId: actor.accountId, id, expectedVersion, value });
    },

    /* ---- City ---------------------------------------------------------- */

    async cities(actor: GlobalActor, raw: unknown = {}) {
      await permit(actor, 'global.read');
      return store.cities(globalAdminQuerySchema.parse(raw));
    },

    async city(actor: GlobalActor, id: string) {
      await permit(actor, 'global.read');
      return store.city(globalIdSchema.parse(id));
    },

    async saveCity(
      actor: GlobalActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'global.administer');
      edit(id, expectedVersion);
      const value = cityInputSchema.parse(raw);
      await parentsOf({
        countryId: value.countryId,
        regionId: value.regionId,
        cityId: null,
      });
      return store.saveCity({ actorId: actor.accountId, id, expectedVersion, value });
    },

    /* ---- Centre -------------------------------------------------------- */

    async centres(actor: GlobalActor, raw: unknown = {}) {
      await permit(actor, 'global.read');
      return store.centres(globalAdminQuerySchema.parse(raw));
    },

    async centre(actor: GlobalActor, id: string) {
      await permit(actor, 'global.read');
      return store.centre(globalIdSchema.parse(id));
    },

    async saveCentre(
      actor: GlobalActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'global.administer');
      edit(id, expectedVersion);
      const value = centreInputSchema.parse(raw);
      await parentsOf(value);
      return store.saveCentre({ actorId: actor.accountId, id, expectedVersion, value });
    },

    /**
     * One named change to a Centre's ordered contacts, applied to the contacts
     * the operator was shown — the version they were shown at is what the write
     * claims, so a stale page cannot overwrite a newer list.
     */
    async changeContacts(
      actor: GlobalActor,
      centreId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      await permit(actor, 'global.administer');
      globalIdSchema.parse(centreId);
      globalVersionSchema.parse(expectedVersion);
      const change = contactChangeSchema.parse(raw);
      const current = await store.centre(centreId);
      if (current === null) throw new GlobalRefusal('not-found');
      if (current.version !== expectedVersion) throw new GlobalRefusal('conflict');
      const next = applyContactChange(current.contacts, change);
      if ('refusal' in next) throw new GlobalRefusal(next.refusal);
      return store.setCentreContacts({
        actorId: actor.accountId,
        centreId,
        expectedVersion,
        contacts: next.contacts,
        change: change.op,
      });
    },

    /**
     * One named change to the Cities a Centre serves. A City must belong to the
     * Centre's Country — asked here so the operator is told, and refused by the
     * composite foreign key whoever writes.
     */
    async changeServedCities(
      actor: GlobalActor,
      centreId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      await permit(actor, 'global.administer');
      globalIdSchema.parse(centreId);
      globalVersionSchema.parse(expectedVersion);
      const change = servedCityChangeSchema.parse(raw);
      const current = await store.centre(centreId);
      if (current === null) throw new GlobalRefusal('not-found');
      if (current.version !== expectedVersion) throw new GlobalRefusal('conflict');
      if (change.op === 'add') {
        const [city] = await store.choicesByIds('city', [change.cityId]);
        if (city === undefined || city.countryId !== current.countryId)
          throw new GlobalRefusal('invalid');
      }
      const next = applyServedCityChange(
        current.servedCities.map((city) => city.id),
        change,
      );
      if ('refusal' in next) throw new GlobalRefusal(next.refusal);
      return store.setCentreServedCities({
        actorId: actor.accountId,
        centreId,
        expectedVersion,
        cityIds: next.cityIds,
        change: change.op,
      });
    },

    /* ---- Selector choices ---------------------------------------------- */

    async countryChoices(actor: GlobalActor) {
      await permit(actor, 'global.read');
      return store.countryChoices();
    },

    async regionChoices(actor: GlobalActor, countryId: string) {
      await permit(actor, 'global.read');
      return store.regionChoices(globalIdSchema.parse(countryId));
    },

    async cityChoices(
      actor: GlobalActor,
      countryId: string,
      query: string | null = null,
    ) {
      await permit(actor, 'global.read');
      return store.cityChoices(globalIdSchema.parse(countryId), text(query));
    },

    async choicesByIds(
      actor: GlobalActor,
      level: 'country' | 'region' | 'city',
      ids: readonly string[],
    ) {
      await permit(actor, 'global.read');
      return store.choicesByIds(
        z.enum(['country', 'region', 'city']).parse(level),
        z.array(globalIdSchema).max(50).parse(ids),
      );
    },
  };
}

export type GlobalService = ReturnType<typeof createGlobalService>;
