import { describe, expect, it } from 'vitest';

import type { CountryRecord } from '../../packages/contracts/src/global/index.ts';
import type {
  MigrationTargetRef,
  StagedCountryPayload,
} from '../../packages/contracts/src/migration/index.ts';
import {
  globalCountryTargetOver,
  type GlobalCountryOperations,
} from '../../apps/web/src/composition/migration-global-targets.ts';

/**
 * The `global.country` publication target (Phase 30-R) over a stateful fake of
 * Global Network's operations: a migrated Country is saved through Global's own
 * `saveCountry`, published, with the payload's code, slug and labels; a fresh
 * entry meeting an existing Country is left for a person; only a RESUMED one
 * adopts, and only an exact published match; a refresh re-saves at the
 * version Global holds; withdrawal archives at the recorded version.
 */

const ACTOR = { accountId: '00000000-0000-4000-8000-0000000000aa' };
const NOW = new Date('2026-10-29T00:00:00Z');
const noResolve = async (): Promise<MigrationTargetRef | null> => null;

const PAYLOAD: StagedCountryPayload = {
  kind: 'global.country',
  code: 'DK',
  slug: 'denmark',
  primaryLocale: 'en',
  labels: [{ locale: 'en', name: 'Denmark' }],
  legacyIdentifier: 'country-Denmark',
};

const refusal = (reason: string) => Object.assign(new Error(reason), { reason });

function fakeGlobal(options: { outage?: boolean } = {}) {
  const records = new Map<string, CountryRecord>();
  const saves: { id: string | null; expectedVersion: number | null; input: unknown }[] =
    [];
  let next = 0;
  const global = {
    async saveCountry(
      _actor: unknown,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      if (options.outage) throw new Error('socket hang up');
      saves.push({ id, expectedVersion, input: raw });
      const input = raw as Omit<CountryRecord, 'id' | 'version' | 'updatedAt'>;
      const clash = [...records.values()].find(
        (record) =>
          record.id !== id && (record.code === input.code || record.slug === input.slug),
      );
      if (clash !== undefined)
        throw refusal(clash.code === input.code ? 'duplicate-code' : 'duplicate-slug');
      if (id === null) {
        next += 1;
        const record: CountryRecord = {
          ...input,
          id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
          version: 1,
          updatedAt: NOW,
        };
        records.set(record.id, record);
        return record;
      }
      const held = records.get(id);
      if (held === undefined) throw refusal('not-found');
      if (held.version !== expectedVersion) throw refusal('conflict');
      const record: CountryRecord = { ...held, ...input, version: held.version + 1 };
      records.set(id, record);
      return record;
    },
    async country(_actor: unknown, id: string) {
      return records.get(id) ?? null;
    },
    async countries(_actor: unknown, raw: unknown = {}) {
      const query = raw as { offset?: number; text?: string | null };
      const text = (query.text ?? '').toLowerCase();
      const items = [...records.values()].filter(
        (record) =>
          record.code.toLowerCase().includes(text) ||
          record.labels.some((label) => label.name.toLowerCase().includes(text)),
      );
      const offset = query.offset ?? 0;
      return {
        items: items.slice(offset, offset + 25),
        hasMore: items.length > offset + 25,
      };
    },
  } as unknown as GlobalCountryOperations;
  return { global, records, saves };
}

const publish = (
  target: ReturnType<typeof globalCountryTargetOver>,
  payload: StagedCountryPayload = PAYLOAD,
  resumed = false,
) =>
  target.publish({
    kind: 'global.country',
    payload,
    topicIds: [],
    assets: [],
    resolve: noResolve,
    actor: ACTOR,
    resumed,
  });

describe('the global.country publication target', () => {
  it('serves global.country only', () => {
    const target = globalCountryTargetOver({ global: fakeGlobal().global });
    expect(target.supports('global.country')).toBe(true);
    expect(target.supports('editorial.page')).toBe(false);
  });

  it('saves a PUBLISHED Country with exactly the payload’s code, slug and labels', async () => {
    const fake = fakeGlobal();
    const target = globalCountryTargetOver({ global: fake.global });
    const result = await publish(target);
    const [record] = fake.records.values();
    expect(result).toEqual({
      status: 'published',
      target: { kind: 'global.country', id: record!.id },
      stage: 'public',
      version: 1,
      canonicalPath: '/global/countries/denmark',
    });
    expect(fake.saves).toEqual([
      {
        id: null,
        expectedVersion: null,
        input: {
          code: 'DK',
          slug: 'denmark',
          primaryLocale: 'en',
          state: 'published',
          labels: [{ locale: 'en', name: 'Denmark' }],
        },
      },
    ]);
  });

  it('leaves an existing Country for a person on a fresh entry, adopting only on resume', async () => {
    const fake = fakeGlobal();
    const target = globalCountryTargetOver({ global: fake.global });
    await publish(target);
    expect(await publish(target)).toEqual({ status: 'refused', reason: 'target-exists' });
    const adopted = await publish(target, PAYLOAD, true);
    expect(adopted).toMatchObject({ status: 'published', version: 1 });
    expect(fake.records.size).toBe(1);
    // Another country's words under the same code is no adoption.
    expect(
      await publish(
        target,
        { ...PAYLOAD, labels: [{ locale: 'en', name: 'Synthetic Danmark' }] },
        true,
      ),
    ).toEqual({ status: 'refused', reason: 'target-conflict' });
    // An archived one is not adopted either.
    const [record] = fake.records.values();
    fake.records.set(record!.id, { ...record!, state: 'archived' });
    expect(await publish(target, PAYLOAD, true)).toEqual({
      status: 'refused',
      reason: 'target-not-published',
    });
  });

  it('refreshes at the version Global holds, and is idempotent when nothing changed', async () => {
    const fake = fakeGlobal();
    const target = globalCountryTargetOver({ global: fake.global });
    await publish(target);
    const [record] = fake.records.values();
    const refresh = (payload: StagedCountryPayload) =>
      target.refresh({
        kind: 'global.country',
        target: { kind: 'global.country', id: record!.id },
        payload,
        topicIds: [],
        assets: [],
        resolve: noResolve,
        actor: ACTOR,
      });
    expect(await refresh(PAYLOAD)).toMatchObject({ status: 'published', version: 1 });
    expect(fake.saves).toHaveLength(1);
    const renamed = {
      ...PAYLOAD,
      labels: [{ locale: 'en' as const, name: 'Kingdom of Denmark' }],
    };
    expect(await refresh(renamed)).toMatchObject({ status: 'published', version: 2 });
    expect(fake.saves.at(-1)).toMatchObject({ id: record!.id, expectedVersion: 1 });
    fake.records.set(record!.id, { ...fake.records.get(record!.id)!, state: 'archived' });
    expect(await refresh(PAYLOAD)).toEqual({
      status: 'refused',
      reason: 'target-not-published',
    });
  });

  it('withdraws by archiving at the recorded version, changing nothing else', async () => {
    const fake = fakeGlobal();
    const target = globalCountryTargetOver({ global: fake.global });
    await publish(target);
    const [record] = fake.records.values();
    const withdraw = (expectedVersion: number) =>
      target.withdraw({
        target: { kind: 'global.country', id: record!.id },
        expectedVersion,
        actor: ACTOR,
      });
    expect(await withdraw(7)).toEqual({ status: 'refused', reason: 'conflict' });
    expect(await withdraw(1)).toEqual({ status: 'withdrawn', version: 2 });
    expect(fake.saves.at(-1)?.input).toEqual({
      code: 'DK',
      slug: 'denmark',
      primaryLocale: 'en',
      state: 'archived',
      labels: [{ locale: 'en', name: 'Denmark' }],
    });
    expect(
      await target.inspect({
        target: { kind: 'global.country', id: record!.id },
        actor: ACTOR,
      }),
    ).toEqual({ exists: true, version: 2, referencedByPeople: false });
  });

  it('turns an outage into unavailable, never a refusal', async () => {
    const target = globalCountryTargetOver({
      global: fakeGlobal({ outage: true }).global,
    });
    expect(await publish(target)).toEqual({ status: 'unavailable' });
  });
});
