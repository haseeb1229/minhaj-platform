import { describe, expect, it } from 'vitest';

import type { MediaPublicReaderPort } from '../../packages/contracts/src/media/index.ts';
import { createMediaReadService } from '../../apps/web/src/contexts/media/index.ts';

/**
 * Watch Part 2 — the groupings' and the speakers' reads at their trust
 * boundary. Every value a visitor's address could shape — the kind of a
 * directory, the grouping a page names, the page it asks for — is parsed by
 * Media's public read service BEFORE any read: a malformed, unknown or
 * out-of-range value reaches no adapter, and an accepted one reaches it with
 * every default stated. The speakers' directory takes nothing at all.
 */

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

function recording() {
  const seen: { method: string; query: unknown }[] = [];
  const reader = {
    groupDirectory: async (query: unknown) => {
      seen.push({ method: 'groupDirectory', query });
      return { items: [], hasMore: false };
    },
    groupSummary: async (query: unknown) => {
      seen.push({ method: 'groupSummary', query });
      return null;
    },
    groupEpisodes: async (query: unknown) => {
      seen.push({ method: 'groupEpisodes', query });
      return { items: [], total: 0, hasMore: false };
    },
    speakerDirectory: async () => {
      seen.push({ method: 'speakerDirectory', query: null });
      return { items: [], hasMore: false, series: [] };
    },
  } as unknown as MediaPublicReaderPort;
  return { service: createMediaReadService(reader), seen };
}

describe('Media’s public groupings and speakers reads', () => {
  it('asks for a directory of each of the three kinds, and of no other', async () => {
    const { service, seen } = recording();
    for (const kind of ['series', 'program', 'playlist'])
      await service.groupDirectory(kind);
    expect(seen.map((entry) => entry.query)).toEqual(['series', 'program', 'playlist']);
    for (const kind of ['', 'programme', 'Series', 'audio', null, undefined, 3])
      expect(() => service.groupDirectory(kind), String(kind)).toThrow();
    expect(seen).toHaveLength(3);
  });

  it('names a grouping only by its aggregate and identifier', async () => {
    const { service, seen } = recording();
    await service.groupSummary({ of: 'series', id: ID });
    await service.groupSummary({ of: 'playlist', id: ID });
    expect(seen.map((entry) => entry.query)).toEqual([
      { of: 'series', id: ID },
      { of: 'playlist', id: ID },
    ]);
    for (const raw of [
      {},
      { of: 'program', id: ID },
      { of: 'series' },
      { of: 'series', id: 'a-series' },
      { of: 'playlist', id: ID, state: 'draft' },
      ID,
    ])
      expect(() => service.groupSummary(raw), JSON.stringify(raw)).toThrow();
    expect(seen).toHaveLength(2);
  });

  it('states the first page of a grouping’s Videos, and refuses any other shape', async () => {
    const { service, seen } = recording();
    await service.groupEpisodes({ group: { of: 'series', id: ID } });
    await service.groupEpisodes({
      group: { of: 'playlist', id: ID },
      offset: 48,
      limit: 24,
    });
    expect(seen.map((entry) => entry.query)).toEqual([
      { group: { of: 'series', id: ID }, offset: 0, limit: 24 },
      { group: { of: 'playlist', id: ID }, offset: 48, limit: 24 },
    ]);
    for (const raw of [
      {},
      { group: { of: 'series', id: ID }, offset: -1 },
      { group: { of: 'series', id: ID }, offset: 25_001 },
      { group: { of: 'series', id: ID }, offset: 1.5 },
      { group: { of: 'series', id: ID }, limit: 0 },
      { group: { of: 'series', id: ID }, limit: 25 },
      { group: { of: 'series', id: 'nope' } },
      { group: { of: 'gallery', id: ID } },
      { group: { of: 'series', id: ID }, sort: 'title' },
    ])
      expect(() => service.groupEpisodes(raw), JSON.stringify(raw)).toThrow();
    expect(seen).toHaveLength(2);
  });

  it('reads the speakers’ directory with nothing a visitor could shape', async () => {
    const { service, seen } = recording();
    expect(await service.speakerDirectory()).toEqual({
      items: [],
      hasMore: false,
      series: [],
    });
    expect(seen).toEqual([{ method: 'speakerDirectory', query: null }]);
  });
});
