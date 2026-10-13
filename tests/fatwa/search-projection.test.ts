import { describe, expect, it } from 'vitest';

import type {
  FatwaPublicReaderPort,
  FatwaSearchRecord,
  FatwaTarget,
} from '../../packages/contracts/src/fatwa/index.ts';
import {
  SEARCH_BODY_MAX_LENGTH,
  SEARCH_SUMMARY_MAX_LENGTH,
  searchDocumentSourceSchema,
} from '../../packages/contracts/src/search/index.ts';
import {
  createFatwaSearchProjection,
  fatwaPath,
} from '../../apps/web/src/contexts/fatwa/index.ts';

/**
 * Phase 20 — Fatwa's search projection, over a fake public reader.
 *
 * WHAT IS PROVED: the published ruling is the one result and its CURRENT
 * published revision the one document — title, the anonymised public question
 * and the ruling, in the ruling's own language, and NOTHING ELSE (no asker, no
 * assignment, no draft, no note); the bounds cut by code point and add nothing;
 * a foreign enumeration cursor is refused; and only rulings the reader says are
 * public now resolve, at `/fatwa/{slug}`.
 *
 * Every string is a synthetic `NON_FATWA_FIXTURE_*` sentinel.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RULING = ID(1);
const TOPIC = ID(9);

const record = (overrides: Partial<FatwaSearchRecord> = {}): FatwaSearchRecord => ({
  fatwaId: RULING,
  slug: 'non-fatwa-fixture-ruling',
  title: 'NON_FATWA_FIXTURE_TITLE',
  publicQuestion: 'NON_FATWA_FIXTURE_PUBLIC_QUESTION',
  ruling: 'NON_FATWA_FIXTURE_RULING',
  language: 'ur',
  topicIds: [TOPIC],
  publishedAt: new Date('2026-09-01T00:00:00.000Z'),
  stamp: 'fixture-stamp-1',
  ...overrides,
});

function harness(options: {
  readonly record?: FatwaSearchRecord | null;
  readonly scopes?: readonly { readonly id: string; readonly stamp: string }[];
  readonly visible?: (ids: readonly string[]) => readonly FatwaTarget[];
}) {
  const asked: { readonly method: string; readonly args: readonly unknown[] }[] = [];
  const reader = {
    async searchRecord(id: string) {
      asked.push({ method: 'searchRecord', args: [id] });
      return options.record === undefined ? record() : options.record;
    },
    async searchScopes(after: string | null, limit: number) {
      asked.push({ method: 'searchScopes', args: [after, limit] });
      return options.scopes ?? [];
    },
    async publicTargets(ids: readonly string[]) {
      asked.push({ method: 'publicTargets', args: [ids] });
      return options.visible
        ? options.visible(ids)
        : ids.map((fatwaId) => ({ fatwaId, slug: 'non-fatwa-fixture-ruling' }));
    },
  } as unknown as FatwaPublicReaderPort;
  return { projection: createFatwaSearchProjection(reader), asked };
}

describe('project', () => {
  it('projects the current published revision as exactly one document of public fields', async () => {
    const { projection } = harness({});
    const projected = await projection.source.project(RULING);
    expect(projected).toEqual({
      stamp: 'fixture-stamp-1',
      documents: [
        {
          kind: 'fatwa',
          resourceId: RULING,
          textLanguage: 'ur',
          contentLanguage: 'ur',
          title: 'NON_FATWA_FIXTURE_TITLE',
          summary: 'NON_FATWA_FIXTURE_PUBLIC_QUESTION',
          body: 'NON_FATWA_FIXTURE_RULING',
          year: null,
          topicIds: [TOPIC],
        },
      ],
    });
    const [document] = projected?.documents ?? [];
    expect(searchDocumentSourceSchema.safeParse(document).success).toBe(true);
    expect(Object.keys(document ?? {}).sort()).toEqual(
      [
        'body',
        'contentLanguage',
        'kind',
        'resourceId',
        'summary',
        'textLanguage',
        'title',
        'topicIds',
        'year',
      ].sort(),
    );
  });

  it('carries an over-long public question into the body, cut by code point', async () => {
    const question = 'س'.repeat(SEARCH_SUMMARY_MAX_LENGTH + 5);
    const { projection } = harness({
      record: record({
        publicQuestion: question,
        ruling: 'ر'.repeat(SEARCH_BODY_MAX_LENGTH),
      }),
    });
    const [document] = (await projection.source.project(RULING))?.documents ?? [];
    expect([...(document?.summary ?? '')]).toHaveLength(SEARCH_SUMMARY_MAX_LENGTH);
    expect(document?.body.startsWith(question)).toBe(true);
    expect([...(document?.body ?? '')]).toHaveLength(SEARCH_BODY_MAX_LENGTH);
  });

  it('projects nothing for a ruling that is not public, and never asks about a malformed id', async () => {
    const absent = harness({ record: null });
    expect(await absent.projection.source.project(RULING)).toBeNull();

    const malformed = harness({});
    expect(await malformed.projection.source.project('not-an-id')).toBeNull();
    expect(malformed.asked).toEqual([]);
  });
});

describe('list', () => {
  it('enumerates the reader’s scopes after a ruling-id cursor', async () => {
    const { projection, asked } = harness({
      scopes: [{ id: ID(2), stamp: 'fixture-stamp-2' }],
    });
    expect(await projection.source.list({ after: RULING, limit: 50 })).toEqual([
      { id: ID(2), stamp: 'fixture-stamp-2' },
    ]);
    expect(await projection.source.list({ after: null, limit: 50 })).toHaveLength(1);
    expect(asked).toEqual([
      { method: 'searchScopes', args: [RULING, 50] },
      { method: 'searchScopes', args: [null, 50] },
    ]);
  });

  it('refuses a cursor that is not a ruling id', async () => {
    const { projection, asked } = harness({});
    await expect(
      projection.source.list({ after: 'not-an-id', limit: 50 }),
    ).rejects.toThrow(/cursor/u);
    expect(asked).toEqual([]);
  });
});

describe('target', () => {
  it('resolves only rulings public now, at /fatwa/{slug}, filtering malformed ids', async () => {
    const { projection, asked } = harness({
      visible: (ids) =>
        ids
          .filter((id) => id === RULING)
          .map((fatwaId) => ({ fatwaId, slug: 'non-fatwa-fixture-ruling' })),
    });
    const found = await projection.target([RULING, ID(3), 'not-an-id', RULING]);
    expect([...found.entries()]).toEqual([[RULING, '/fatwa/non-fatwa-fixture-ruling']]);
    expect(asked).toEqual([{ method: 'publicTargets', args: [[RULING, ID(3)]] }]);
  });

  it('asks nothing when no id is well formed', async () => {
    const { projection, asked } = harness({});
    expect((await projection.target(['x', 'y'])).size).toBe(0);
    expect(asked).toEqual([]);
  });

  it('encodes the slug into a locale-free path', () => {
    expect(fatwaPath({ slug: 'non-fatwa-fixture-ruling' })).toBe(
      '/fatwa/non-fatwa-fixture-ruling',
    );
  });
});
