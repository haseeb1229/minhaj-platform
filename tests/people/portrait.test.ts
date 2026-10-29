import { describe, expect, it } from 'vitest';

import type {
  PeoplePersistencePort,
  PeopleReaderPort,
} from '../../packages/contracts/src/people/index.ts';
import { personPortraitSchema } from '../../packages/contracts/src/people/index.ts';
import {
  createPeopleService,
  createPortraitAssetPolicy,
} from '../../apps/web/src/contexts/people-contributors/index.ts';

/**
 * Phase 30-R — a contributor's PORTRAIT, over fake ports.
 *
 * Proved here: a portrait is ONE typed asset reference with a bounded box and
 * an optional credit; it is recorded only when Storage says the asset is a
 * servable still image right now, with the audit vocabulary People owns; and
 * the byte policy allows exactly the portrait of a published Person.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { accountId: ID(100), permission: 'people.administer' };
const portrait = { assetId: ID(7), width: 400, height: 533, credit: null };

function harness(images: ReadonlySet<string>) {
  const calls: { method: string; input: unknown }[] = [];
  const people = new Proxy({} as PeoplePersistencePort, {
    get(_target, method: string) {
      return async (input: unknown) => {
        calls.push({ method, input });
        return { id: ID(1) };
      };
    },
  });
  const service = createPeopleService({
    reader: {} as PeopleReaderPort,
    people,
    accounts: {
      capabilities: async () => {
        throw new Error('not asked');
      },
      closedAccounts: async () => [],
    } as never,
    images: {
      servableImages: async (ids) => new Set(ids.filter((id) => images.has(id))),
    },
  });
  return { service, calls };
}

describe('a portrait as input', () => {
  it('is a typed asset with a bounded box and an optional credit', () => {
    expect(personPortraitSchema.parse(portrait)).toEqual(portrait);
    expect(personPortraitSchema.parse({ ...portrait, credit: 'MQI' }).credit).toBe('MQI');
    for (const bad of [
      { ...portrait, assetId: 'x' },
      { ...portrait, width: 0 },
      { ...portrait, height: 16_385 },
      { ...portrait, credit: '' },
      { ...portrait, credit: 'x'.repeat(201) },
      { ...portrait, url: 'https://minhaj.net/images-db10/x.jpg' },
    ])
      expect(personPortraitSchema.safeParse(bad).success).toBe(false);
  });
});

describe('recording a portrait', () => {
  it('records a servable still image under the People audit vocabulary', async () => {
    const { service, calls } = harness(new Set([portrait.assetId]));
    const result = await service.setPortrait(actor, { personId: ID(1), portrait });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('setPersonPortrait');
    expect(calls[0]?.input).toMatchObject({
      personId: ID(1),
      portrait,
      auditAction: 'people.person.portrait-changed',
      authorisingSource: 'people.administer',
    });
  });

  it('refuses an asset Storage does not serve as an image, and writes nothing', async () => {
    const { service, calls } = harness(new Set());
    expect(await service.setPortrait(actor, { personId: ID(1), portrait })).toEqual({
      ok: false,
      failure: 'portrait-unusable',
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses a malformed portrait before asking anybody', async () => {
    const { service, calls } = harness(new Set([portrait.assetId]));
    const result = await service.setPortrait(actor, {
      personId: ID(1),
      portrait: { ...portrait, width: -1 },
    });
    expect(result).toEqual({ ok: false, failure: 'portrait-unusable' });
    expect(calls).toHaveLength(0);
  });

  it('clears a portrait without asking Storage', async () => {
    const { service, calls } = harness(new Set());
    const result = await service.setPortrait(actor, { personId: ID(1), portrait: null });
    expect(result.ok).toBe(true);
    expect(calls[0]?.input).toMatchObject({ portrait: null });
  });
});

describe('the portrait byte policy', () => {
  const asset = (assetId: string, mediaType = 'image/jpeg') => ({
    assetId,
    mediaType,
    byteSize: 1,
    checksum: '0'.repeat(64),
  });
  // A published Person ID(1) whose portrait is ID(7); nothing else is public.
  const relations = {
    isPublicPortrait: async (personId: string, assetId: string) =>
      personId === ID(1) && assetId === ID(7),
  };
  const decide = (
    request: { personId: string; assetId: string },
    resolved = asset(request.assetId),
  ) => createPortraitAssetPolicy({ relations, request }).decide(resolved);

  it("allows exactly a published Person's recorded portrait", async () => {
    expect(await decide({ personId: ID(1), assetId: ID(7) })).toBe('allow');
  });

  it('denies another asset, another Person, a non-image and malformed identifiers', async () => {
    expect(await decide({ personId: ID(1), assetId: ID(8) })).toBe('deny');
    expect(await decide({ personId: ID(2), assetId: ID(7) })).toBe('deny');
    expect(
      await decide({ personId: ID(1), assetId: ID(7) }, asset(ID(7), 'application/pdf')),
    ).toBe('deny');
    expect(await decide({ personId: ID(1), assetId: ID(7) }, asset(ID(8)))).toBe('deny');
    expect(await decide({ personId: 'not-an-id', assetId: ID(7) })).toBe('deny');
  });
});
