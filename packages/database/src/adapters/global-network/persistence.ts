import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  GLOBAL_ADMIN_PAGE,
  GLOBAL_CHOICES,
  type CentreContact,
  type CentreDetail,
  type CentreRecord,
  type CityRecord,
  type CountryRecord,
  type GlobalChoice,
  type CentrePage,
  type CityPage,
  type CountryPage,
  type RegionPage,
  type GlobalPersistencePort,
  type RegionRecord,
} from '@minhaj/contracts/global';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  BY_SLUG,
  boundedOffset,
  centreLabels,
  changedFields,
  coordinatesOf,
  GlobalDataError,
  ID_BATCH,
  LABELS,
  localeOf,
  nameMatch,
  placeLabels,
  RECENTLY_CHANGED,
  refuse,
  stateOf,
  UNMATCHABLE_VERSION,
  type CentreLabelRow,
  type Client,
  type PlaceLabelRow,
} from './shared.ts';

/**
 * The Global Network persistence adapter's ADMINISTRATIVE half
 * (DOMAIN_MODEL.md §17.1; DELIVERY_PLAN.md Phase 16).
 *
 * OWNED BY THE GLOBAL NETWORK CONTEXT, hosted here. It reads and writes Global
 * tables only — never an Editorial table — and is reached only through the
 * Global service, which re-checks `global.read` or `global.administer` live.
 *
 * EVERY WRITE IS ONE TRANSACTION UNDER AN EXPECTED VERSION: the row, its
 * replaced labels, contacts or served Cities, its slug reservation (by trigger)
 * and its audit entry commit together or not at all. The conditional update
 * claims the version FIRST, before any dependent row is touched, so of two
 * operators acting on one record exactly one succeeds and the other is told.
 *
 * THE DATABASE DECIDES GEOGRAPHY. A parent from another Country, a Region
 * beside a City, a virtual Centre with a place, half a coordinate pair — each
 * is refused by a constraint whoever writes; this adapter reports it.
 */

const PLACE_LABELS = { select: { locale: true, name: true }, ...LABELS } as const;

const COUNTRY_SELECT = {
  id: true,
  code: true,
  slug: true,
  primaryLocale: true,
  state: true,
  version: true,
  updatedAt: true,
  labels: PLACE_LABELS,
} satisfies Prisma.CountrySelect;

const REGION_SELECT = {
  id: true,
  countryId: true,
  slug: true,
  primaryLocale: true,
  state: true,
  version: true,
  updatedAt: true,
  labels: PLACE_LABELS,
} satisfies Prisma.RegionSelect;

const CITY_SELECT = {
  id: true,
  countryId: true,
  regionId: true,
  slug: true,
  primaryLocale: true,
  state: true,
  version: true,
  updatedAt: true,
  labels: PLACE_LABELS,
} satisfies Prisma.CitySelect;

const CENTRE_SELECT = {
  id: true,
  slug: true,
  countryId: true,
  regionId: true,
  cityId: true,
  isVirtual: true,
  latitude: true,
  longitude: true,
  primaryLocale: true,
  state: true,
  version: true,
  updatedAt: true,
  labels: {
    select: { locale: true, name: true, description: true, address: true },
    ...LABELS,
  },
} satisfies Prisma.CentreSelect;

/*
 * The ROW SHAPES the mappings read, stated as plain interfaces rather than
 * derived from the generated client, so nothing this adapter returns carries a
 * Prisma type — the surface gate proves the boundary narrow (ARCHITECTURE.md
 * §4.1). Each select above is checked against the client by `satisfies`.
 */
interface PlaceRow {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly version: number;
  readonly updatedAt: Date;
  readonly labels: readonly PlaceLabelRow[];
}

interface CountryRow extends PlaceRow {
  readonly code: string;
}

interface RegionRow extends PlaceRow {
  readonly countryId: string;
}

interface CityRow extends PlaceRow {
  readonly countryId: string;
  readonly regionId: string | null;
}

/** A SQL decimal as the client returns it: exact, read back as fixed-place text. */
interface DecimalValue {
  toFixed(places: number): string;
}

interface CentreRow {
  readonly id: string;
  readonly slug: string;
  readonly countryId: string;
  readonly regionId: string | null;
  readonly cityId: string | null;
  readonly isVirtual: boolean;
  readonly latitude: DecimalValue | null;
  readonly longitude: DecimalValue | null;
  readonly primaryLocale: string;
  readonly state: string;
  readonly version: number;
  readonly updatedAt: Date;
  readonly labels: readonly CentreLabelRow[];
}

interface CentreDetailRow extends CentreRow {
  readonly contacts: readonly { readonly channel: string; readonly value: string }[];
  readonly serves: readonly { readonly city: CityRow }[];
}

function toCountry(row: CountryRow): CountryRecord {
  return {
    id: row.id,
    code: row.code,
    slug: row.slug,
    primaryLocale: localeOf(row.primaryLocale),
    state: stateOf(row.state),
    labels: placeLabels(row.labels),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function toRegion(row: RegionRow): RegionRecord {
  return {
    id: row.id,
    countryId: row.countryId,
    slug: row.slug,
    primaryLocale: localeOf(row.primaryLocale),
    state: stateOf(row.state),
    labels: placeLabels(row.labels),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function toCity(row: CityRow): CityRecord {
  return {
    id: row.id,
    countryId: row.countryId,
    regionId: row.regionId,
    slug: row.slug,
    primaryLocale: localeOf(row.primaryLocale),
    state: stateOf(row.state),
    labels: placeLabels(row.labels),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function toCentre(row: CentreRow): CentreRecord {
  return {
    id: row.id,
    slug: row.slug,
    countryId: row.countryId,
    regionId: row.regionId,
    cityId: row.cityId,
    isVirtual: row.isVirtual,
    coordinates: coordinatesOf(row.latitude, row.longitude),
    primaryLocale: localeOf(row.primaryLocale),
    state: stateOf(row.state),
    labels: centreLabels(row.labels),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/** The rows of one administrative page, and whether another follows. */
function pageOf<R>(rows: readonly R[]): {
  readonly rows: readonly R[];
  readonly hasMore: boolean;
} {
  return {
    rows: rows.slice(0, GLOBAL_ADMIN_PAGE),
    hasMore: rows.length > GLOBAL_ADMIN_PAGE,
  };
}

function countryPage(rows: readonly CountryRow[]): CountryPage {
  const { rows: items, hasMore } = pageOf(rows);
  return { items: items.map(toCountry), hasMore };
}

function regionPage(rows: readonly RegionRow[]): RegionPage {
  const { rows: items, hasMore } = pageOf(rows);
  return { items: items.map(toRegion), hasMore };
}

function cityPage(rows: readonly CityRow[]): CityPage {
  const { rows: items, hasMore } = pageOf(rows);
  return { items: items.map(toCity), hasMore };
}

function centrePage(rows: readonly CentreRow[]): CentrePage {
  const { rows: items, hasMore } = pageOf(rows);
  return { items: items.map(toCentre), hasMore };
}

function choice(
  row: {
    readonly id: string;
    readonly slug: string;
    readonly state: string;
    readonly primaryLocale: string;
    readonly labels: readonly { readonly locale: string; readonly name: string }[];
  },
  countryId: string,
  regionId: string | null,
): GlobalChoice {
  return {
    id: row.id,
    slug: row.slug,
    state: stateOf(row.state),
    primaryLocale: localeOf(row.primaryLocale),
    labels: placeLabels(row.labels),
    countryId,
    regionId,
  };
}

const CENTRE_DETAIL_SELECT = {
  ...CENTRE_SELECT,
  contacts: { select: { channel: true, value: true }, orderBy: { position: 'asc' } },
  serves: {
    select: { city: { select: CITY_SELECT } },
    orderBy: { city: { slug: 'asc' } },
  },
} satisfies Prisma.CentreSelect;

/** A Centre with its ordered contacts and served Cities, read with the caller's client. */
function loadCentre(db: Client, id: string): Promise<CentreDetailRow | null> {
  return db.centre.findFirst({ where: { id }, select: CENTRE_DETAIL_SELECT });
}

function centreDetailOf(row: CentreDetailRow): CentreDetail {
  return {
    ...toCentre(row),
    contacts: row.contacts.map((contact) => ({
      channel: contact.channel as CentreContact['channel'],
      value: contact.value,
    })),
    servedCities: row.serves.map((served) => toCity(served.city)),
  };
}

/** The facts an audit entry names as changed — never their values. */
function placeFacts(value: {
  readonly slug: string;
  readonly state: string;
  readonly primaryLocale: string;
  readonly labels: readonly unknown[];
}) {
  return {
    slug: value.slug,
    state: value.state,
    primaryLocale: value.primaryLocale,
    labels: value.labels,
  };
}

/**
 * The audit entry for one Global save: actor, action, target, version and
 * state, and WHICH fields changed by name. No name, address, coordinate or
 * contact value is ever written here.
 */
function auditSave(
  tx: Client,
  input: {
    readonly actorId: string;
    readonly level: 'country' | 'region' | 'city' | 'centre';
    readonly id: string;
    readonly previous: { readonly version: number; readonly state: string } | null;
    readonly version: number;
    readonly state: string;
    readonly changed: string;
  },
) {
  return tx.auditLog.create({
    data: auditRow({
      actorType: 'user',
      actorId: input.actorId,
      action: `global.${input.level}.${input.previous === null ? 'created' : 'updated'}`,
      targetType: input.level,
      targetId: input.id,
      ...(input.previous === null
        ? {}
        : {
            before: {
              version: String(input.previous.version),
              state: input.previous.state,
            },
          }),
      after: {
        version: String(input.version),
        state: input.state,
        changed: input.changed,
      },
      authorisingSource: 'global.administer',
    }),
  });
}

/**
 * Claims a record's expected version — the lock every write takes before it
 * touches anything else. A stale or missing version is a conflict.
 */
async function claim(
  update: (where: { id: string; version: number }) => Promise<{ count: number }>,
  id: string,
  expectedVersion: number | null,
): Promise<void> {
  const changed = await update({ id, version: expectedVersion ?? UNMATCHABLE_VERSION });
  if (changed.count !== 1) throw new GlobalDataError('conflict');
}

export function createGlobalPersistence(): GlobalPersistencePort {
  const db = getDatabaseClient();

  return {
    /* ---- Country ------------------------------------------------------- */

    async countries(query) {
      const rows = await db.country.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...(query.text === null
            ? {}
            : {
                OR: [
                  { code: { contains: query.text } },
                  ...((nameMatch(query.text) as { OR: object[] }).OR ?? []),
                ],
              }),
        },
        select: COUNTRY_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: GLOBAL_ADMIN_PAGE + 1,
      });
      return countryPage(rows);
    },

    async country(id) {
      const row = await db.country.findFirst({ where: { id }, select: COUNTRY_SELECT });
      return row === null ? null : toCountry(row);
    },

    async saveCountry({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const countryId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.country.findFirst({ where: { id }, select: COUNTRY_SELECT });
          if (id !== null && previous === null) throw new GlobalDataError('conflict');

          const data = {
            code: value.code,
            slug: value.slug,
            primaryLocale: value.primaryLocale,
            state: value.state,
            updatedAt: new Date(),
          };
          if (id !== null)
            await claim(
              (where) =>
                tx.country.updateMany({
                  where,
                  data: { ...data, version: { increment: 1 } },
                }),
              id,
              expectedVersion,
            );
          // The slug trigger reserves the new slug in this same transaction.
          else await tx.country.create({ data: { ...data, id: countryId } });

          await tx.countryLabel.deleteMany({ where: { countryId } });
          await tx.countryLabel.createMany({
            data: value.labels.map((label) => ({ countryId, ...label })),
          });

          const row = await tx.country.findFirst({
            where: { id: countryId },
            select: COUNTRY_SELECT,
          });
          if (row === null) throw new GlobalDataError('conflict');
          await auditSave(tx, {
            actorId,
            level: 'country',
            id: countryId,
            previous,
            version: row.version,
            state: row.state,
            changed: changedFields(
              previous === null
                ? null
                : { code: previous.code, ...placeFacts(toCountry(previous)) },
              { code: value.code, ...placeFacts(value) },
            ),
          });
          return toCountry(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Region -------------------------------------------------------- */

    async regions(query) {
      const rows = await db.region.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...(query.countryId === null ? {} : { countryId: query.countryId }),
          ...nameMatch(query.text),
        },
        select: REGION_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: GLOBAL_ADMIN_PAGE + 1,
      });
      return regionPage(rows);
    },

    async region(id) {
      const row = await db.region.findFirst({ where: { id }, select: REGION_SELECT });
      return row === null ? null : toRegion(row);
    },

    async saveRegion({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const regionId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.region.findFirst({ where: { id }, select: REGION_SELECT });
          if (id !== null && previous === null) throw new GlobalDataError('conflict');
          // A Region never leaves its Country; its slug reservations (keyed by
          // Country) would refuse it too, but the operator is told why.
          if (previous !== null && previous.countryId !== value.countryId)
            throw new GlobalDataError('country-fixed');

          const data = {
            slug: value.slug,
            primaryLocale: value.primaryLocale,
            state: value.state,
            updatedAt: new Date(),
          };
          if (id !== null)
            await claim(
              (where) =>
                tx.region.updateMany({
                  where,
                  data: { ...data, version: { increment: 1 } },
                }),
              id,
              expectedVersion,
            );
          else
            await tx.region.create({
              data: { ...data, id: regionId, countryId: value.countryId },
            });

          await tx.regionLabel.deleteMany({ where: { regionId } });
          await tx.regionLabel.createMany({
            data: value.labels.map((label) => ({ regionId, ...label })),
          });

          const row = await tx.region.findFirst({
            where: { id: regionId },
            select: REGION_SELECT,
          });
          if (row === null) throw new GlobalDataError('conflict');
          await auditSave(tx, {
            actorId,
            level: 'region',
            id: regionId,
            previous,
            version: row.version,
            state: row.state,
            changed: changedFields(
              previous === null ? null : placeFacts(toRegion(previous)),
              placeFacts(value),
            ),
          });
          return toRegion(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- City ---------------------------------------------------------- */

    async cities(query) {
      const rows = await db.city.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...(query.countryId === null ? {} : { countryId: query.countryId }),
          ...nameMatch(query.text),
        },
        select: CITY_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: GLOBAL_ADMIN_PAGE + 1,
      });
      return cityPage(rows);
    },

    async city(id) {
      const row = await db.city.findFirst({ where: { id }, select: CITY_SELECT });
      return row === null ? null : toCity(row);
    },

    /**
     * RE-PARENTING WITHIN A COUNTRY IS ONE ROW. A City's Centres store no
     * Region of their own, so moving the City to another Region of its Country
     * moves them with it — there is nothing else to rewrite, and nothing that
     * could be left contradicting it. Leaving the Country is refused.
     */
    async saveCity({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const cityId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.city.findFirst({ where: { id }, select: CITY_SELECT });
          if (id !== null && previous === null) throw new GlobalDataError('conflict');
          if (previous !== null && previous.countryId !== value.countryId)
            throw new GlobalDataError('country-fixed');

          const data = {
            regionId: value.regionId,
            slug: value.slug,
            primaryLocale: value.primaryLocale,
            state: value.state,
            updatedAt: new Date(),
          };
          if (id !== null)
            await claim(
              (where) =>
                tx.city.updateMany({
                  where,
                  data: { ...data, version: { increment: 1 } },
                }),
              id,
              expectedVersion,
            );
          else
            await tx.city.create({
              data: { ...data, id: cityId, countryId: value.countryId },
            });

          await tx.cityLabel.deleteMany({ where: { cityId } });
          await tx.cityLabel.createMany({
            data: value.labels.map((label) => ({ cityId, ...label })),
          });

          const row = await tx.city.findFirst({
            where: { id: cityId },
            select: CITY_SELECT,
          });
          if (row === null) throw new GlobalDataError('conflict');
          await auditSave(tx, {
            actorId,
            level: 'city',
            id: cityId,
            previous,
            version: row.version,
            state: row.state,
            changed: changedFields(
              previous === null
                ? null
                : { regionId: previous.regionId, ...placeFacts(toCity(previous)) },
              { regionId: value.regionId, ...placeFacts(value) },
            ),
          });
          return toCity(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Centre -------------------------------------------------------- */

    async centres(query) {
      const rows = await db.centre.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...(query.countryId === null ? {} : { countryId: query.countryId }),
          ...nameMatch(query.text),
        },
        select: CENTRE_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: GLOBAL_ADMIN_PAGE + 1,
      });
      return centrePage(rows);
    },

    async centre(id) {
      const row = await loadCentre(db, id);
      return row === null ? null : centreDetailOf(row);
    },

    /**
     * A Centre that changes Country must not leave served Cities behind in the
     * old one: the composite foreign key would refuse it, and the operator is
     * told to clear them first rather than having them silently dropped.
     */
    async saveCentre({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const centreId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.centre.findFirst({ where: { id }, select: CENTRE_SELECT });
          if (id !== null && previous === null) throw new GlobalDataError('conflict');

          const data = {
            slug: value.slug,
            countryId: value.countryId,
            regionId: value.regionId,
            cityId: value.cityId,
            isVirtual: value.isVirtual,
            latitude: value.coordinates?.latitude ?? null,
            longitude: value.coordinates?.longitude ?? null,
            primaryLocale: value.primaryLocale,
            state: value.state,
            updatedAt: new Date(),
          };
          // Asked first so the operator is told why; the composite foreign key
          // refuses the same change if a served City arrives in between.
          if (
            previous !== null &&
            previous.countryId !== value.countryId &&
            (await tx.centreServiceCity.count({ where: { centreId } })) > 0
          )
            throw new GlobalDataError('served-cities');
          if (id !== null)
            await claim(
              (where) =>
                tx.centre.updateMany({
                  where,
                  data: { ...data, version: { increment: 1 } },
                }),
              id,
              expectedVersion,
            );
          else await tx.centre.create({ data: { ...data, id: centreId } });

          await tx.centreLabel.deleteMany({ where: { centreId } });
          await tx.centreLabel.createMany({
            data: value.labels.map((label) => ({ centreId, ...label })),
          });

          const row = await tx.centre.findFirst({
            where: { id: centreId },
            select: CENTRE_SELECT,
          });
          if (row === null) throw new GlobalDataError('conflict');
          const facts = (centre: {
            readonly countryId: string;
            readonly regionId: string | null;
            readonly cityId: string | null;
            readonly isVirtual: boolean;
            readonly coordinates: unknown;
          }) => ({
            country: centre.countryId,
            region: centre.regionId,
            city: centre.cityId,
            virtual: centre.isVirtual,
            coordinates: centre.coordinates,
          });
          await auditSave(tx, {
            actorId,
            level: 'centre',
            id: centreId,
            previous,
            version: row.version,
            state: row.state,
            changed: changedFields(
              previous === null
                ? null
                : { ...facts(toCentre(previous)), ...placeFacts(toCentre(previous)) },
              { ...facts(value), ...placeFacts(value) },
            ),
          });
          return toCentre(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async setCentreContacts({ actorId, centreId, expectedVersion, contacts, change }) {
      try {
        return await db.$transaction(async (tx) => {
          await claim(
            (where) =>
              tx.centre.updateMany({
                where,
                data: { version: { increment: 1 }, updatedAt: new Date() },
              }),
            centreId,
            expectedVersion,
          );
          await tx.centreContact.deleteMany({ where: { centreId } });
          if (contacts.length > 0)
            await tx.centreContact.createMany({
              data: contacts.map((contact, position) => ({
                centreId,
                position,
                channel: contact.channel,
                value: contact.value,
              })),
            });
          const loaded = await loadCentre(tx, centreId);
          if (loaded === null) throw new GlobalDataError('conflict');
          const detail = centreDetailOf(loaded);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'global.centre.contacts.changed',
              targetType: 'centre',
              targetId: centreId,
              before: { version: String(expectedVersion) },
              // The channel mix and the change — never a number, address or URL.
              after: {
                version: String(detail.version),
                change,
                channels: contacts.map((contact) => contact.channel).join(','),
              },
              authorisingSource: 'global.administer',
            }),
          });
          return detail;
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Each served City carries the CENTRE'S Country, read inside the claimed
     * version, so a City of another Country is refused by the composite foreign
     * key — not by this code.
     */
    async setCentreServedCities({ actorId, centreId, expectedVersion, cityIds, change }) {
      try {
        return await db.$transaction(async (tx) => {
          await claim(
            (where) =>
              tx.centre.updateMany({
                where,
                data: { version: { increment: 1 }, updatedAt: new Date() },
              }),
            centreId,
            expectedVersion,
          );
          const centre = await tx.centre.findFirst({
            where: { id: centreId },
            select: { countryId: true },
          });
          if (centre === null) throw new GlobalDataError('conflict');
          await tx.centreServiceCity.deleteMany({ where: { centreId } });
          if (cityIds.length > 0)
            await tx.centreServiceCity.createMany({
              data: cityIds.map((cityId) => ({
                centreId,
                cityId,
                countryId: centre.countryId,
              })),
            });
          const loaded = await loadCentre(tx, centreId);
          if (loaded === null) throw new GlobalDataError('conflict');
          const detail = centreDetailOf(loaded);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'global.centre.served-cities.changed',
              targetType: 'centre',
              targetId: centreId,
              before: { version: String(expectedVersion) },
              after: {
                version: String(detail.version),
                change,
                cities: String(cityIds.length),
              },
              authorisingSource: 'global.administer',
            }),
          });
          return detail;
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Choices -------------------------------------------------------- */

    async countryChoices() {
      const rows = await db.country.findMany({
        select: { ...COUNTRY_SELECT },
        orderBy: [...BY_SLUG],
        take: GLOBAL_CHOICES,
      });
      return rows.map((row) => choice(row, row.id, null));
    },

    async regionChoices(countryId) {
      const rows = await db.region.findMany({
        where: { countryId },
        select: REGION_SELECT,
        orderBy: [...BY_SLUG],
        take: GLOBAL_CHOICES,
      });
      return rows.map((row) => choice(row, row.countryId, row.id));
    },

    async cityChoices(countryId, text) {
      const rows = await db.city.findMany({
        where: { countryId, ...nameMatch(text) },
        select: CITY_SELECT,
        orderBy: [...BY_SLUG],
        take: GLOBAL_CHOICES,
      });
      return rows.map((row) => choice(row, row.countryId, row.regionId));
    },

    async choicesByIds(level, ids) {
      const where = { id: { in: [...ids].slice(0, ID_BATCH) } };
      if (level === 'country') {
        const rows = await db.country.findMany({ where, select: COUNTRY_SELECT });
        return rows.map((row) => choice(row, row.id, null));
      }
      if (level === 'region') {
        const rows = await db.region.findMany({ where, select: REGION_SELECT });
        return rows.map((row) => choice(row, row.countryId, row.id));
      }
      const rows = await db.city.findMany({ where, select: CITY_SELECT });
      return rows.map((row) => choice(row, row.countryId, row.regionId));
    },
  };
}
