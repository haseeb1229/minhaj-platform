import type {
  MigrationContentKind,
  MigrationSourceAdapter,
  SourcePolicy,
} from '@minhaj/contracts/migration';

import type { SourceSelection as AdapterSelection } from '../adapters/source-support.ts';
import { createIrfanUlQuranTranslationAdapter } from '../adapters/irfan-ul-quran.ts';
import {
  createMinhajInfoIssueAdapter,
  createMinhajInfoMagazineAdapter,
} from '../adapters/minhaj-info.ts';
import { createMinhajOrgEditorialAdapter } from '../adapters/minhaj-org.ts';
import { createMinhajTvVideoAdapter } from '../adapters/minhaj-tv.ts';
import { createMinhajBooksWorkAdapter } from '../adapters/minhajbooks.ts';
import { createTheFatwaAdapter } from '../adapters/thefatwa.ts';

/**
 * THE AUTHORISED SOURCE CATALOGUE (Phase 30; MIGRATION_STRATEGY.md §3.1).
 *
 * What each authorised source registration IS — its stable key, content kind,
 * exact hosts, base URL, declared default language, politeness and the
 * adapter that knows its markup — committed so a registration is reproducible
 * and reviewable. It holds NO authorisation evidence and NO secret: the
 * written authorisation reference and date are supplied by the operator at
 * registration (`migration:register-source`) and live in the source row and
 * in the organisation's own records.
 *
 * ONE SOURCE, ONE CONTENT KIND. A physical site that yields several kinds is
 * several registrations sharing its hosts (MIGRATION_STRATEGY.md §3.2), and a
 * key never changes: Stage 1B widens the SELECTION of the same registrations,
 * so every record keeps its identity, mappings and provenance.
 *
 * THE SELECTION is not part of a registration. A run is given its bounded
 * selection (`--pages`, `--limit`, `--items`) — Stage 1A takes a
 * representative slice; Stage 1B widens the same options over the same keys.
 */

export interface SourceSelection extends AdapterSelection {
  /** Source-specific explicit items (e.g. surah numbers), when the source needs them. */
  readonly items: readonly string[];
}

export interface AuthorisedSourceDefinition {
  readonly key: string;
  readonly name: string;
  readonly contentKind: MigrationContentKind;
  readonly baseUrl: string;
  readonly hosts: readonly string[];
  readonly defaultLanguageCode: string | null;
  readonly policy: SourcePolicy;
  /** Public statement of what the registration covers; never a secret. */
  readonly policyNotes: string;
  readonly adapter: (selection: SourceSelection) => MigrationSourceAdapter;
}

/**
 * Politeness for every authorised source: three seconds between requests, one
 * at a time, three attempts for transient failures only, a 30-second deadline,
 * 4 MiB bodies and at most three redirects — well inside the floor the
 * database enforces (≥1 s, concurrency 1).
 */
export const AUTHORISED_POLICY: SourcePolicy = Object.freeze({
  minIntervalMs: 3000,
  maxConcurrency: 1,
  maxAttempts: 3,
  timeoutMs: 30_000,
  maxBodyBytes: 4 * 1024 * 1024,
  maxRedirects: 3,
});

const PUBLIC_ONLY =
  'Public pages only, under the owner-recorded authorisation; no account, login, form, private ' +
  'question, enrolment or message area; robots.txt respected; no access restriction bypassed.';

function surahs(selection: SourceSelection): number[] {
  const numbers = selection.items.map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 114))
    throw new Error('--items must be surah numbers 1–114 for this source');
  return numbers;
}

const MINHAJ_ORG = 'https://www.minhaj.org/';
const MINHAJ_BOOKS = 'https://www.minhajbooks.com/';
const MINHAJ_INFO = 'https://minhaj.info/';
const MINHAJ_TV = 'https://www.minhaj.tv/';
const THE_FATWA = 'https://thefatwa.com/';
const IRFAN = 'https://www.irfan-ul-quran.com/';

export const AUTHORISED_SOURCES: readonly AuthorisedSourceDefinition[] = Object.freeze([
  {
    key: 'minhaj-org-news-en',
    name: 'Minhaj.org — English news',
    contentKind: 'editorial.news',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes: `News & Events listing (English). ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgEditorialAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        kind: 'editorial.news',
        section: 'News-Events',
        language: 'english',
      }),
  },
  {
    key: 'minhaj-org-news-ur',
    name: 'Minhaj.org — Urdu news',
    contentKind: 'editorial.news',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes: `News & Events listing (Urdu). ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgEditorialAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        kind: 'editorial.news',
        section: 'News-Events',
        language: 'urdu',
      }),
  },
  {
    key: 'minhaj-org-articles-en',
    name: 'Minhaj.org — English articles',
    contentKind: 'editorial.article',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes: `Articles listing (English). ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgEditorialAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        kind: 'editorial.article',
        section: 'Articles',
        language: 'english',
      }),
  },
  {
    key: 'minhajbooks-works',
    name: 'Minhaj Books — works',
    contentKind: 'library.work',
    baseUrl: MINHAJ_BOOKS,
    hosts: ['www.minhajbooks.com'],
    defaultLanguageCode: null,
    policy: AUTHORISED_POLICY,
    policyNotes:
      `Book landing pages: metadata and introductions; no PDF, page image or sale-point data in ` +
      `Stage 1A. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajBooksWorkAdapter({
        baseUrl: MINHAJ_BOOKS,
        selection,
        listing: '/english/cat/The-Hadith/',
      }),
  },
  {
    key: 'minhaj-info-magazines',
    name: 'Minhaj magazines — titles',
    contentKind: 'library.magazine',
    baseUrl: MINHAJ_INFO,
    hosts: ['minhaj.info'],
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes: `Magazine archive pages. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajInfoMagazineAdapter({
        baseUrl: MINHAJ_INFO,
        selection,
        magazines: ['/minhaj-ul-quran-mags', '/dukhtran-e-islam'],
      }),
  },
  {
    key: 'minhaj-info-issues-mq',
    name: 'Monthly Minhaj-ul-Quran — issues',
    contentKind: 'library.magazine-issue',
    baseUrl: MINHAJ_INFO,
    hosts: ['minhaj.info'],
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes: `Issue pages: titles, dates and the table of contents; no PDF. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajInfoIssueAdapter({
        baseUrl: MINHAJ_INFO,
        selection,
        magazine: '/minhaj-ul-quran-mags',
      }),
  },
  {
    key: 'minhaj-info-issues-di',
    name: 'Dukhtran-e-Islam — issues',
    contentKind: 'library.magazine-issue',
    baseUrl: MINHAJ_INFO,
    hosts: ['minhaj.info'],
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes: `Issue pages: titles, dates and the table of contents; no PDF. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajInfoIssueAdapter({
        baseUrl: MINHAJ_INFO,
        selection,
        magazine: '/dukhtran-e-islam',
      }),
  },
  {
    key: 'minhaj-tv-videos',
    name: 'Minhaj.TV — video lectures',
    contentKind: 'media.video',
    baseUrl: MINHAJ_TV,
    hosts: ['www.minhaj.tv'],
    defaultLanguageCode: null,
    policy: AUTHORISED_POLICY,
    policyNotes:
      `Video metadata and YouTube identifiers from /english/ pages only (robots.txt disallows ` +
      `others); no video file is downloaded. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajTvVideoAdapter({
        baseUrl: MINHAJ_TV,
        selection,
        listing: 'English-Speeches',
      }),
  },
  {
    key: 'thefatwa-rulings',
    name: 'TheFatwa — published rulings (review only)',
    contentKind: 'fatwa.ruling',
    baseUrl: THE_FATWA,
    hosts: ['thefatwa.com'],
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `Published rulings only; the asker's name and place are never read; the question form is ` +
      `never touched. Review-only: migration never publishes a Fatwa. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createTheFatwaAdapter({ baseUrl: THE_FATWA, selection, listing: 'latest' }),
  },
  {
    key: 'irfan-ul-quran-ur',
    name: 'Irfan-ul-Quran — Urdu translation (review only)',
    contentKind: 'quran.translation',
    baseUrl: IRFAN,
    hosts: ['www.irfan-ul-quran.com'],
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `Urdu translation text per surah, exactly as published; no Arabic text, tafsir or ` +
      `recitation. Review-only: migration never publishes Quran material. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createIrfanUlQuranTranslationAdapter({
        baseUrl: IRFAN,
        selection,
        translation: 'ur',
        surahs: surahs(selection),
      }),
  },
  {
    key: 'irfan-ul-quran-en',
    name: 'Irfan-ul-Quran — English translation (review only)',
    contentKind: 'quran.translation',
    baseUrl: IRFAN,
    hosts: ['www.irfan-ul-quran.com'],
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `English translation text per surah, exactly as published; no Arabic text, tafsir or ` +
      `recitation. Review-only: migration never publishes Quran material. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createIrfanUlQuranTranslationAdapter({
        baseUrl: IRFAN,
        selection,
        translation: 'en',
        surahs: surahs(selection),
      }),
  },
]);

export function authorisedSource(key: string): AuthorisedSourceDefinition | null {
  return AUTHORISED_SOURCES.find((source) => source.key === key) ?? null;
}
