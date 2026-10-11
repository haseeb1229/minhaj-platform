import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  EVENT_GEOGRAPHY_CENTRES,
  EVENT_LIMITS,
  EVENT_MAX_OFFSET,
  EVENT_PAGE,
  EVENT_PREVIEW,
  editorialContentSchemaFor,
  editorialKindSchema,
  eventGalleryPathOf,
  eventPathOf,
  eventScheduleRefusalOf,
  type EditorialPublicReaderPort,
  type EventListQuery,
} from '../../packages/contracts/src/editorial/index.ts';
import { editorialFailure } from '../../apps/web/src/contexts/editorial/application/editorial-service.ts';
import { EditorialRefusal } from '../../apps/web/src/contexts/editorial/domain/workflow.ts';
import { createEditorialReadService } from '../../apps/web/src/contexts/editorial/application/public-service.ts';

/**
 * Phase 14 — an Event's content contract and the public read service's own
 * rules, without a database: what an editor may submit, how a schedule
 * refusal is told apart from any other, the canonical addresses, and that a
 * public listing's query is validated and only ever NARROWS. The same rules
 * against real SQL Server are in `events.integration.test.ts`.
 */

const document = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
const base = () => ({
  slug: 'synthetic-event',
  primaryLanguage: 'en',
  translations: [
    {
      languageCode: 'en',
      title: 'Synthetic event',
      excerpt: '',
      seoTitle: '',
      seoDescription: '',
      document,
    },
  ],
  topicIds: [] as string[],
  contributors: [] as { personId: string; role: string }[],
  schedule: {
    timezone: 'Asia/Karachi',
    occurrences: [{ start: '2031-11-14T19:00', end: '2031-11-14T21:00' }],
  },
});
const schema = editorialContentSchemaFor('event');

describe('the Event kind', () => {
  it('is the seventh kind of the shared workflow, followed only by Phase 15’s Collection', () => {
    expect(editorialKindSchema.options).toEqual([
      'article',
      'page',
      'news-article',
      'press-release',
      'statement',
      'media-coverage',
      'event',
      'collection',
    ]);
    expect(editorialKindSchema.options.indexOf('event')).toBe(6);
  });

  it('has its canonical address and its gallery view beneath it', () => {
    expect(eventPathOf('a-b')).toBe('/events/a-b');
    expect(eventGalleryPathOf('a-b')).toBe('/events/a-b/gallery');
    expect(eventPathOf('تقریب-ایک')).toBe(`/events/${encodeURIComponent('تقریب-ایک')}`);
    expect(eventPathOf('a/b?c#d')).toBe('/events/a%2Fb%3Fc%23d');
  });

  it('keeps its public bounds coherent', () => {
    expect(EVENT_PREVIEW).toBeLessThanOrEqual(EVENT_PAGE);
    expect(EVENT_MAX_OFFSET % EVENT_PAGE).toBe(0);
    expect(EVENT_LIMITS.occurrences).toBe(12);
    expect(EVENT_LIMITS.galleries).toBe(12);
  });
});

describe('an Event’s content is strict', () => {
  it('accepts the shared content with a schedule, and defaults Centre and Galleries to none', () => {
    const parsed = schema.parse(base());
    expect(parsed.centreId).toBeNull();
    expect(parsed.galleryIds).toEqual([]);
    // The schedule is RESOLVED on the server, not stored as submitted.
    expect(parsed.schedule).toEqual({
      timezone: 'Asia/Karachi',
      occurrences: [
        {
          startsLocal: '2031-11-14T19:00',
          startsAt: new Date('2031-11-14T14:00:00Z'),
          endsLocal: '2031-11-14T21:00',
          endsAt: new Date('2031-11-14T16:00:00Z'),
        },
      ],
    });
  });

  it('requires a schedule and refuses every field it does not own', () => {
    const { schedule: _schedule, ...withoutSchedule } = base();
    expect(schema.safeParse(withoutSchedule).success).toBe(false);
    for (const extra of [
      { isFeatured: true },
      { heroImage: 'https://images.example.invalid/a.jpg' },
      { venue: 'Synthetic Hall' },
      { registrationUrl: 'https://register.example.invalid/' },
      { price: 0 },
      { organiser: 'Synthetic Organiser' },
      { livestreamUrl: 'https://stream.example.invalid/' },
      { recurrence: 'weekly' },
      { coverage: { outlet: 'Injected', sourceUrl: null, sourceDate: null } },
    ])
      expect(
        schema.safeParse({ ...base(), ...extra }).success,
        Object.keys(extra)[0],
      ).toBe(false);
    const issuer = {
      ...base(),
      translations: base().translations.map((t) => ({ ...t, issuer: 'Injected' })),
    };
    expect(schema.safeParse(issuer).success).toBe(false);
    // And no other family accepts an Event's own fields.
    for (const kind of ['article', 'news-article', 'press-release'] as const)
      expect(editorialContentSchemaFor(kind).safeParse(base()).success, kind).toBe(false);
  });

  it('takes a Centre as an identifier, and Galleries unique, ordered and at most twelve', () => {
    const centreId = randomUUID();
    const twelve = Array.from({ length: EVENT_LIMITS.galleries }, () => randomUUID());
    const parsed = schema.parse({ ...base(), centreId, galleryIds: twelve });
    expect(parsed.centreId).toBe(centreId);
    expect(parsed.galleryIds).toEqual(twelve);
    expect(
      schema.safeParse({ ...base(), galleryIds: [...twelve, randomUUID()] }).success,
    ).toBe(false);
    const one = randomUUID();
    expect(schema.safeParse({ ...base(), galleryIds: [one, one] }).success).toBe(false);
    expect(schema.safeParse({ ...base(), galleryIds: ['not-an-id'] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...base(), centreId: 'not-an-id' }).success).toBe(false);
    expect(schema.safeParse({ ...base(), centreId: '' }).success).toBe(false);
  });

  it('holds one to twelve occurrences', () => {
    const occurrences = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        start: `2031-01-${String(index + 1).padStart(2, '0')}T10:00`,
      }));
    const withCount = (count: number) => ({
      ...base(),
      schedule: { timezone: 'UTC', occurrences: occurrences(count) },
    });
    expect(schema.safeParse(withCount(0)).success).toBe(false);
    expect(schema.safeParse(withCount(1)).success).toBe(true);
    expect(schema.safeParse(withCount(12)).success).toBe(true);
    expect(schema.safeParse(withCount(13)).success).toBe(false);
  });

  it('carries a schedule refusal as its OWN reason, and nothing else as one', () => {
    const reason = (schedule: unknown) => {
      const result = schema.safeParse({ ...base(), schedule });
      return result.success ? 'accepted' : eventScheduleRefusalOf(result.error);
    };
    const zone = 'America/New_York';
    expect(reason({ timezone: zone, occurrences: [{ start: '2031-03-09T02:30' }] })).toBe(
      'nonexistent-time',
    );
    expect(reason({ timezone: zone, occurrences: [{ start: '2031-11-02T01:30' }] })).toBe(
      'ambiguous-time',
    );
    expect(
      reason({
        timezone: zone,
        occurrences: [{ start: '2031-06-01T10:00', end: '2031-06-01T10:00' }],
      }),
    ).toBe('schedule-order');
    expect(
      reason({
        timezone: zone,
        occurrences: [{ start: '2031-06-01T10:00' }, { start: '2031-06-01T10:00' }],
      }),
    ).toBe('duplicate-occurrence');
    // A malformed schedule is merely invalid: no schedule reason is invented.
    expect(
      reason({ timezone: '+05:00', occurrences: [{ start: '2031-06-01T10:00' }] }),
    ).toBe(null);
    expect(reason({ timezone: zone, occurrences: [{ start: '2031-02-30T10:00' }] })).toBe(
      null,
    );
    const other = schema.safeParse({ ...base(), slug: '' });
    expect(other.success ? 'accepted' : eventScheduleRefusalOf(other.error)).toBeNull();
  });

  it('reports a schedule refusal through the shared failure vocabulary', () => {
    for (const reason of [
      'nonexistent-time',
      'ambiguous-time',
      'schedule-order',
      'duplicate-occurrence',
    ] as const)
      expect(editorialFailure(new EditorialRefusal(reason))).toBe(reason);
    expect(editorialFailure(new EditorialRefusal('invalid'))).toBe('invalid');
    expect(editorialFailure({ reason: 'made-up' })).not.toBe('made-up');
    expect(editorialFailure(new Error('nonexistent-time'))).not.toBe('nonexistent-time');
  });
});

describe('the public read service', () => {
  function stubReader() {
    const calls: EventListQuery[] = [];
    const reader = {
      events: vi.fn(async (query: EventListQuery) => {
        calls.push(query);
        return { items: [], more: false };
      }),
      eventCanonicalSlug: vi.fn(async () => 'current'),
      publicEvent: vi.fn(async () => null),
    } as unknown as EditorialPublicReaderPort;
    return { reader, calls };
  }
  const NOW = new Date('2031-05-05T05:05:05Z');

  it('asks with the SERVER’s clock, a bounded page and no topic', async () => {
    const { reader, calls } = stubReader();
    const reads = createEditorialReadService(reader, () => NOW);
    await reads.events({ when: 'past', offset: 40, centreIds: null });
    expect(calls).toEqual([
      {
        when: 'past',
        offset: 40,
        centreIds: null,
        now: NOW,
        limit: EVENT_PAGE,
        topicId: null,
      },
    ]);
  });

  it('matches NOTHING for an empty Centre filter, without asking', async () => {
    const { reader, calls } = stubReader();
    const reads = createEditorialReadService(reader, () => NOW);
    expect(await reads.events({ when: 'upcoming', offset: 0, centreIds: [] })).toEqual({
      items: [],
      more: false,
    });
    expect(calls).toEqual([]);
  });

  it('refuses an unbounded or malformed query rather than broadening it', async () => {
    const { reader, calls } = stubReader();
    const reads = createEditorialReadService(reader, () => NOW);
    for (const filter of [
      { when: 'later', offset: 0, centreIds: null },
      { when: 'upcoming', offset: -1, centreIds: null },
      { when: 'upcoming', offset: EVENT_MAX_OFFSET + 1, centreIds: null },
      { when: 'upcoming', offset: 1.5, centreIds: null },
      { when: 'upcoming', offset: 0, centreIds: ['not-an-id'] },
      {
        when: 'upcoming',
        offset: 0,
        centreIds: Array.from({ length: EVENT_GEOGRAPHY_CENTRES + 1 }, () =>
          randomUUID(),
        ),
      },
      { when: 'upcoming', offset: 0, centreIds: null, topicId: randomUUID() },
    ])
      await expect(
        reads.events(filter as Parameters<typeof reads.events>[0]),
      ).rejects.toThrow();
    await expect(reads.centreEvents('not-an-id', 'upcoming')).rejects.toThrow();
    await expect(reads.centreEvents(randomUUID(), 'upcoming', 0, 0)).rejects.toThrow();
    await expect(
      reads.centreEvents(randomUUID(), 'upcoming', 0, EVENT_PAGE + 1),
    ).rejects.toThrow();
    await expect(reads.eventsOnTopic('not-an-id')).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('answers a slug that cannot name an Event without asking', async () => {
    const { reader } = stubReader();
    const reads = createEditorialReadService(reader, () => NOW);
    expect(await reads.event('')).toBeNull();
    expect(await reads.eventCanonicalSlug('x'.repeat(121))).toBeNull();
    expect(reader.publicEvent).not.toHaveBeenCalled();
    expect(reader.eventCanonicalSlug).not.toHaveBeenCalled();
  });

  it('previews a topic’s upcoming Events, or its past ones when none is ahead', async () => {
    const topicId = randomUUID();
    const calls: EventListQuery[] = [];
    const summary = { slug: 'past-one' };
    const reader = {
      events: async (query: EventListQuery) => {
        calls.push(query);
        return query.when === 'past'
          ? { items: [summary], more: false }
          : { items: [], more: false };
      },
    } as unknown as EditorialPublicReaderPort;
    const reads = createEditorialReadService(reader, () => NOW);
    const preview = await reads.eventsOnTopic(topicId);
    expect(preview.when).toBe('past');
    expect(preview.page.items).toEqual([summary]);
    expect(calls.map((call) => [call.when, call.topicId, call.limit, call.now])).toEqual([
      ['upcoming', topicId, EVENT_PREVIEW, NOW],
      ['past', topicId, EVENT_PREVIEW, NOW],
    ]);
  });
});
