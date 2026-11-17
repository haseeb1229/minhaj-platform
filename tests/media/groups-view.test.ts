import { describe, expect, it } from 'vitest';

import type {
  AudioSeriesEntry,
  MediaGroupEntry,
  SpeakerDirectoryEntry,
} from '../../packages/contracts/src/media/index.ts';
import {
  DEFAULT_GROUPS_VIEW,
  DEFAULT_SPEAKERS_VIEW,
  groupFacets,
  groupMatches,
  groupPageCanonicalRedirect,
  groupPageHref,
  groupsCanonicalRedirect,
  groupsFiltered,
  groupSortParam,
  groupsHref,
  membersOf,
  readGroupPage,
  readGroupsView,
  readSpeakersView,
  relatedGroups,
  sortGroups,
  sortSpeakers,
  speakerMatches,
  speakerRow,
  speakersCanonicalRedirect,
  speakersHref,
  yearSpan,
  type GroupRow,
} from '../../apps/web/src/components/media/groups-view.ts';

/**
 * Watch Part 2 — the groupings' and the speakers' pure rules: the view an
 * address names, the address each control, chip, letter and page link
 * builds, one address per view, and what a directory shows of Media's
 * answer — its filters and their counts, its orders, and the related
 * groupings of a page. Tolerant of anything a visitor or a crawler types;
 * never widening.
 */

const PERSON = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';
const OTHER = '6c1f2e3d-4a5b-4c6d-9e7f-8091a2b3c4d5';
const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SECOND_TOPIC = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function entry(
  id: string,
  fields: Partial<MediaGroupEntry> & { readonly title?: string } = {},
): MediaGroupEntry {
  const { title, ...rest } = fields;
  return {
    id,
    slug: `group-${id}`,
    kind: 'series',
    primaryLocale: 'en',
    labels: [{ locale: 'en', title: title ?? `Group ${id}`, description: '' }],
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    videos: 1,
    seconds: 0,
    firstOn: null,
    lastOn: null,
    languages: [],
    speakers: [],
    topics: [],
    cover: null,
    ...rest,
  };
}

const row = (value: MediaGroupEntry): GroupRow => ({
  entry: value,
  title: value.labels[0]?.title ?? '',
});

describe('a groupings directory’s address — one per view', () => {
  it('reads every filter, an order and a page, and drops what is malformed', () => {
    expect(readGroupsView({})).toEqual(DEFAULT_GROUPS_VIEW);
    expect(
      readGroupsView({
        q: '  Seerah   lessons ',
        language: 'ur',
        speaker: PERSON.toUpperCase(),
        topic: TOPIC,
        sort: 'title',
        page: '3',
      }),
    ).toEqual({
      q: 'Seerah lessons',
      language: 'ur',
      speaker: PERSON,
      topic: TOPIC,
      sort: 'title',
      page: 3,
    });
    expect(
      readGroupsView({
        q: '',
        language: 'Urdu!',
        speaker: 'someone',
        topic: ['a', 'b'],
        sort: 'random',
        page: '0',
      }),
    ).toEqual(DEFAULT_GROUPS_VIEW);
  });

  it('spells each view once, neutral values omitted, identifiers in lower case', () => {
    expect(groupsHref('series', 'en', DEFAULT_GROUPS_VIEW)).toBe('/watch/series');
    expect(groupsHref('program', 'ur', DEFAULT_GROUPS_VIEW)).toBe('/ur/watch/programs');
    expect(
      groupsHref('playlist', 'ar', {
        ...DEFAULT_GROUPS_VIEW,
        q: 'Seerah',
        language: 'en',
        speaker: PERSON.toUpperCase(),
        topic: TOPIC,
        sort: 'videos',
        page: 2,
      }),
    ).toBe(
      `/ar/watch/playlists?q=Seerah&language=en&speaker=${PERSON}&topic=${TOPIC}&sort=videos&page=2`,
    );
    // A changed filter returns to the first page; a page link keeps the rest.
    const view = { ...DEFAULT_GROUPS_VIEW, language: 'ur', page: 4 };
    expect(groupsHref('series', 'en', view, { topic: TOPIC })).toBe(
      `/watch/series?language=ur&topic=${TOPIC}`,
    );
    expect(groupsHref('series', 'en', view, { page: 5 })).toBe(
      '/watch/series?language=ur&page=5',
    );
  });

  it('answers every other spelling with one redirect, and the canonical with none', () => {
    expect(groupsCanonicalRedirect('series', 'en', {})).toBeNull();
    expect(
      groupsCanonicalRedirect('series', 'en', { language: 'ur', page: '2' }),
    ).toBeNull();
    for (const [query, to] of [
      // A form's empty controls.
      [{ q: '', language: '', speaker: '', topic: '', sort: 'newest' }, '/watch/series'],
      // Another order of the same parameters.
      [{ page: '2', language: 'ur' }, '/watch/series?language=ur&page=2'],
      // A former offset pager listed by slug: the first page, not a guess.
      [{ offset: '24' }, '/watch/series'],
      // A repeated value is dropped; an identifier is spelled in lower case.
      [{ language: ['ur', 'en'] }, '/watch/series'],
      [{ speaker: PERSON.toUpperCase() }, `/watch/series?speaker=${PERSON}`],
    ] as const)
      expect(groupsCanonicalRedirect('series', 'en', query), JSON.stringify(query)).toBe(
        to,
      );
    // A parameter the directory does not read is left alone.
    expect(groupsCanonicalRedirect('series', 'en', { utm: 'x' })).toBeNull();
  });

  it('calls a title search or a filter a narrowing, and an order not', () => {
    expect(groupsFiltered(DEFAULT_GROUPS_VIEW)).toBe(false);
    expect(groupsFiltered({ ...DEFAULT_GROUPS_VIEW, sort: 'title' })).toBe(false);
    expect(groupsFiltered({ ...DEFAULT_GROUPS_VIEW, q: 'x' })).toBe(true);
    expect(groupsFiltered({ ...DEFAULT_GROUPS_VIEW, topic: TOPIC })).toBe(true);
  });
});

describe('what a directory shows of Media’s answer', () => {
  const seerah = entry('a', {
    title: 'Ṭāhir’s Seerah lessons',
    languages: [{ id: 'ur', videos: 3 }],
    speakers: [{ id: PERSON.toUpperCase(), videos: 3 }],
    topics: [{ id: TOPIC, videos: 2 }],
    lastOn: '2024-05-01',
    videos: 3,
  });
  const fiqh = entry('b', {
    title: 'Fiqh circle',
    languages: [
      { id: 'en', videos: 1 },
      { id: 'ur', videos: 1 },
    ],
    speakers: [{ id: OTHER, videos: 2 }],
    topics: [{ id: SECOND_TOPIC, videos: 2 }],
    lastOn: '2025-01-01',
    videos: 2,
  });
  const empty = entry('c', { title: 'Awaiting episodes', videos: 0 });
  const rows = [seerah, fiqh, empty].map(row);

  it('filters by language, speaker (without case), Topic and every word of a title', () => {
    const shown = (view: Partial<typeof DEFAULT_GROUPS_VIEW>) =>
      rows
        .filter((value) => groupMatches(value, { ...DEFAULT_GROUPS_VIEW, ...view }))
        .map((value) => value.entry.id);
    expect(shown({})).toEqual(['a', 'b', 'c']);
    expect(shown({ language: 'ur' })).toEqual(['a', 'b']);
    expect(shown({ language: 'en' })).toEqual(['b']);
    expect(shown({ speaker: PERSON })).toEqual(['a']);
    expect(shown({ topic: SECOND_TOPIC })).toEqual(['b']);
    expect(shown({ q: 'tahir seerah' })).toEqual(['a']);
    expect(shown({ q: 'seerah fiqh' })).toEqual([]);
    expect(shown({ language: 'ur', topic: TOPIC })).toEqual(['a']);
  });

  it('counts each option in groupings, under every OTHER filter', () => {
    const facets = groupFacets(rows, { ...DEFAULT_GROUPS_VIEW, language: 'en' });
    // The language facet ignores the language chosen.
    expect(facets.languages).toEqual([
      { id: 'ur', videos: 2 },
      { id: 'en', videos: 1 },
    ]);
    // The others count only what the chosen language leaves.
    expect(facets.speakers).toEqual([{ id: OTHER, videos: 1 }]);
    expect(facets.topics).toEqual([{ id: SECOND_TOPIC, videos: 1 }]);
    // Identifiers are counted in lower case, as an address spells them.
    expect(
      groupFacets(rows, DEFAULT_GROUPS_VIEW).speakers.map((value) => value.id),
    ).toContain(PERSON);
  });

  it('orders latest first with the undated last, by title, or by most videos', () => {
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    const ids = (sort: 'newest' | 'title' | 'videos') =>
      sortGroups(rows, sort, collator).map((value) => value.entry.id);
    expect(ids('newest')).toEqual(['b', 'a', 'c']);
    expect(ids('title')).toEqual(['c', 'b', 'a']);
    expect(ids('videos')).toEqual(['a', 'b', 'c']);
  });

  it('relates groupings by a shared speaker (twice) or Topic, never itself or an empty one', () => {
    const page = entry('x', {
      speakers: [{ id: PERSON, videos: 1 }],
      topics: [{ id: SECOND_TOPIC, videos: 1 }],
    });
    const lonely = entry('d', { lastOn: '2030-01-01' });
    const sameTopicEmpty = entry('e', {
      videos: 0,
      topics: [{ id: SECOND_TOPIC, videos: 0 }],
    });
    expect(
      relatedGroups(page, [page, seerah, fiqh, lonely, sameTopicEmpty], 3).map(
        (value) => value.id,
      ),
    ).toEqual(['a', 'b']);
    expect(relatedGroups(page, [seerah, fiqh], 1).map((value) => value.id)).toEqual([
      'a',
    ]);
  });

  it('states a span of years only when something is dated', () => {
    expect(yearSpan(null, null)).toBeNull();
    expect(yearSpan('2019-03-01', '2023-11-30')).toEqual({ from: 2019, to: 2023 });
    expect(yearSpan('2021-01-01', '2021-12-31')).toEqual({ from: 2021, to: 2021 });
  });
});

describe('one grouping’s page — its page of Videos is its one address', () => {
  it('reads a page, or the page a former offset began on', () => {
    expect(readGroupPage({})).toBe(1);
    expect(readGroupPage({ page: '3' })).toBe(3);
    expect(readGroupPage({ offset: '48' })).toBe(3);
    expect(readGroupPage({ offset: '47' })).toBe(2);
    expect(readGroupPage({ offset: '-1' })).toBe(1);
    expect(readGroupPage({ page: '0' })).toBe(1);
  });

  it('spells the first page bare and every other once', () => {
    expect(groupPageHref('/ur/watch/series/a', 1)).toBe('/ur/watch/series/a');
    expect(groupPageHref('/ur/watch/series/a', 2)).toBe('/ur/watch/series/a?page=2');
    const path = '/watch/playlists/a';
    expect(groupPageCanonicalRedirect(path, {})).toBeNull();
    expect(groupPageCanonicalRedirect(path, { page: '2' })).toBeNull();
    expect(groupPageCanonicalRedirect(path, { page: '1' })).toBe(path);
    expect(groupPageCanonicalRedirect(path, { page: 'x' })).toBe(path);
    expect(groupPageCanonicalRedirect(path, { offset: '24' })).toBe(`${path}?page=2`);
    expect(groupPageCanonicalRedirect(path, { page: ['2', '3'] })).toBe(path);
    expect(groupPageCanonicalRedirect(path, { utm: 'x' })).toBeNull();
  });
});

describe('the speakers’ directory', () => {
  const speaker = (
    id: string,
    videos: number,
    languages: readonly string[],
  ): SpeakerDirectoryEntry => ({
    personId: id,
    videos,
    seconds: 0,
    lastOn: null,
    languages: languages.map((code) => ({ id: code, videos: 1 })),
    series: [],
    seriesTotal: 0,
  });

  it('reads and spells its view once, and redirects every other spelling', () => {
    expect(readSpeakersView({}, 'en')).toEqual(DEFAULT_SPEAKERS_VIEW);
    expect(
      readSpeakersView(
        { letter: 't', language: 'ur', q: ' Tahir ', sort: 'videos', page: '2' },
        'en',
      ),
    ).toEqual({ letter: 'T', language: 'ur', q: 'Tahir', sort: 'videos', page: 2 });
    expect(speakersHref('ur', DEFAULT_SPEAKERS_VIEW)).toBe('/ur/watch/speakers');
    expect(
      speakersHref(
        'en',
        { ...DEFAULT_SPEAKERS_VIEW, letter: 'T', page: 3 },
        { language: 'ar' },
      ),
    ).toBe('/watch/speakers?letter=T&language=ar');
    expect(speakersCanonicalRedirect('en', {})).toBeNull();
    expect(speakersCanonicalRedirect('en', { offset: '50' })).toBe('/watch/speakers');
    expect(speakersCanonicalRedirect('en', { sort: 'name', letter: 'ab' })).toBe(
      '/watch/speakers',
    );
  });

  it('filters by first letter, a language and every word of a name, and orders by name or videos', () => {
    const rows = [
      speakerRow(
        speaker('1', 4, ['ur']),
        { slug: 'tahir', name: 'Ṭāhir ul-Qādrī' },
        'en',
      ),
      speakerRow(speaker('2', 9, ['en', 'ur']), { slug: 'hassan', name: 'Hassan' }, 'en'),
      speakerRow(speaker('3', 1, ['ar']), { slug: 'x', name: '1st speaker' }, 'en'),
    ];
    expect(rows.map((value) => value.letter)).toEqual(['Ṭ', 'H', '#']);
    const shown = (view: Partial<typeof DEFAULT_SPEAKERS_VIEW>) =>
      rows
        .filter((value) => speakerMatches(value, { ...DEFAULT_SPEAKERS_VIEW, ...view }))
        .map((value) => value.slug);
    expect(shown({ language: 'ur' })).toEqual(['tahir', 'hassan']);
    expect(shown({ q: 'tahir qadri' })).toEqual(['tahir']);
    expect(shown({ letter: '#' })).toEqual(['x']);
    // A letter's own count leaves the letter out.
    expect(
      rows.filter((value) =>
        speakerMatches(value, { ...DEFAULT_SPEAKERS_VIEW, letter: 'H' }, 'letter'),
      ),
    ).toHaveLength(3);
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    expect(sortSpeakers(rows, 'name', collator).map((value) => value.slug)).toEqual([
      'x',
      'hassan',
      'tahir',
    ]);
    expect(sortSpeakers(rows, 'videos', collator).map((value) => value.slug)).toEqual([
      'hassan',
      'tahir',
      'x',
    ]);
  });
});

/* ===========================================================================
 * Watch Part 3 — the audio series' directory, kind `audio`, by the same rules
 * ========================================================================= */

function audioEntry(
  id: string,
  fields: Partial<AudioSeriesEntry> & { readonly title?: string } = {},
): AudioSeriesEntry {
  const { title, ...rest } = fields;
  return {
    id,
    slug: `audio-${id}`,
    primaryLocale: 'en',
    labels: [{ locale: 'en', title: title ?? `Audio ${id}`, description: '' }],
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    tracks: 1,
    seconds: 0,
    firstOn: null,
    lastOn: null,
    languages: [],
    speakers: [],
    topics: [],
    ...rest,
  };
}

const audioRow = (value: AudioSeriesEntry): GroupRow<AudioSeriesEntry> => ({
  entry: value,
  title: value.labels[0]?.title ?? '',
});

describe('the audio series’ directory — Watch Part 2’s rules, kind `audio`', () => {
  it('lives at /listen/series and spells its "most" order as recordings', () => {
    expect(groupsHref('audio', 'en', DEFAULT_GROUPS_VIEW)).toBe('/listen/series');
    expect(groupsHref('audio', 'ur', { ...DEFAULT_GROUPS_VIEW, sort: 'videos' })).toBe(
      '/ur/listen/series?sort=recordings',
    );
    expect(groupSortParam('audio', 'videos')).toBe('recordings');
    expect(groupSortParam('audio', 'title')).toBe('title');
    // Watch's directories keep their own spelling.
    expect(groupSortParam('series', 'videos')).toBe('videos');
    expect(readGroupsView({ sort: 'recordings' }, 'audio').sort).toBe('videos');
    expect(readGroupsView({ sort: 'videos' }, 'audio').sort).toBe('newest');
    expect(readGroupsView({ sort: 'recordings' }).sort).toBe('newest');
  });

  it('answers another spelling of an audio view with ONE redirect, and the canonical with none', () => {
    expect(groupsCanonicalRedirect('audio', 'en', {})).toBeNull();
    expect(groupsCanonicalRedirect('audio', 'ar', { sort: 'recordings' })).toBeNull();
    for (const [query, to] of [
      [{ sort: 'videos' }, '/listen/series'],
      [{ q: '', language: '', sort: 'newest' }, '/listen/series'],
      [{ offset: '24' }, '/listen/series'],
      [{ topic: TOPIC.toUpperCase() }, `/listen/series?topic=${TOPIC}`],
    ] as const)
      expect(groupsCanonicalRedirect('audio', 'en', query), JSON.stringify(query)).toBe(
        to,
      );
  });

  it('counts, filters, orders and relates audio series by their published tracks', () => {
    const seerah = audioEntry('a', {
      title: 'Seerah talks',
      tracks: 5,
      lastOn: '2024-02-01',
      languages: [{ id: 'ur', tracks: 5 }],
      speakers: [{ id: PERSON, tracks: 5 }],
      topics: [{ id: TOPIC, tracks: 2 }],
    });
    const fiqh = audioEntry('b', {
      title: 'Fiqh circle',
      tracks: 9,
      lastOn: '2023-01-01',
      languages: [{ id: 'en', tracks: 9 }],
      speakers: [{ id: OTHER.toUpperCase(), tracks: 9 }],
      topics: [{ id: TOPIC, tracks: 1 }],
    });
    const waiting = audioEntry('c', { title: 'Awaiting recordings', tracks: 0 });
    const rows = [seerah, fiqh, waiting].map(audioRow);

    expect(membersOf(fiqh)).toBe(9);
    expect(membersOf(entry('v', { videos: 4 }))).toBe(4);

    // Each option counts the series choosing it would show, under the others.
    const facets = groupFacets(rows, { ...DEFAULT_GROUPS_VIEW, language: 'ur' });
    expect(facets.languages).toEqual([
      { id: 'en', videos: 1 },
      { id: 'ur', videos: 1 },
    ]);
    expect(facets.speakers).toEqual([{ id: PERSON, videos: 1 }]);
    expect(
      rows
        .filter((value) =>
          groupMatches(value, { ...DEFAULT_GROUPS_VIEW, speaker: OTHER }),
        )
        .map((value) => value.entry.id),
    ).toEqual(['b']);

    const collator = new Intl.Collator('en');
    expect(sortGroups(rows, 'videos', collator).map((value) => value.entry.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(sortGroups(rows, 'newest', collator).map((value) => value.entry.id)).toEqual([
      'a',
      'b',
      'c',
    ]);

    // A shared speaker weighs twice a shared Topic; never itself, never an
    // empty series.
    const sameTopicEmpty = audioEntry('d', {
      tracks: 0,
      topics: [{ id: TOPIC, tracks: 0 }],
    });
    expect(
      relatedGroups(seerah, [seerah, fiqh, waiting, sameTopicEmpty], 3).map(
        (value) => value.id,
      ),
    ).toEqual(['b']);
  });
});
