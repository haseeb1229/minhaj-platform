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
import {
  MINHAJ_ORG_ASSET_HOSTS,
  createMinhajOrgArchiveNewsAdapter,
  createMinhajOrgCollectionAdapter,
  createMinhajOrgEditorialAdapter,
  createMinhajOrgPageAdapter,
  createMinhajOrgPersonAdapter,
} from '../adapters/minhaj-org.ts';
import { createMinhajOverseasCountryAdapter } from '../adapters/minhaj-overseas.ts';
import { createMinhajTvVideoAdapter } from '../adapters/minhaj-tv.ts';
import {
  createMinhajBooksAuthorAdapter,
  createMinhajBooksWorkAdapter,
} from '../adapters/minhajbooks.ts';
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
  /**
   * Phase 30-R. Exact first-party ASSET hosts the source's own pages name for
   * their pictures, with the evidence recorded when one is added to a source
   * registered before it.
   */
  readonly assetHosts: readonly string[];
  readonly assetHostEvidence: string | null;
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
const MINHAJ_OVERSEAS = 'https://minhajoverseas.com/';

/**
 * Phase 30-R. Why minhaj.net is the minhaj.org sources' own image host: every
 * post that has a picture names it there (surveyed 2026-10-29), minhaj.org's
 * contact page names "MIB Minhaj Internet Bureau … www.minhaj.net", and both
 * state the same copyright holder.
 */
const MINHAJ_NET_EVIDENCE =
  'minhaj.org posts name minhaj.net for their own pictures (surveyed 2026-10-29); minhaj.org ' +
  'lists www.minhaj.net as its Minhaj Internet Bureau; both state copyright Minhaj-ul-Quran ' +
  'International. Owner attestation OWNER-ATTESTATION-2026-10-29-PREADOPTION-CONTENT-BRAND-EXPANSION.';

/**
 * Phase 30-R. The organisational pages of the pre-adoption review build: each
 * minhaj.org page and the ONE reserved shell route it belongs at — reviewed
 * here, never inferred. A route with no truthful source page stays reserved.
 *
 * R2 (2026-11-07): the contact page (tid 1797) at `/contact` — the shell route
 * that shows a published Page above the contact form — and the Annual Reports
 * page (56402). No other organisational page of the site's own site map
 * truthfully IS a reserved route: the founder's profile sections are one page,
 * the peace award (57642) is a news post, Minhaj-ul-Amal (3421) is a
 * self-assessment form, the websites list (1801) would replace the Digital
 * resources landing, and the copyright notice (455) is no legal page.
 */
export const MINHAJ_ORG_PAGE_BINDINGS: Readonly<Record<string, string>> = Object.freeze({
  '1799': '/explore/about/introduction',
  '8721': '/explore/about/global-impact',
  '8718': '/explore/shaykh-ul-islam/biography',
  '8722': '/explore/organization/forums',
  '14614': '/explore/organization/un-recognition',
  '35509': '/explore/our-work/peace',
  '31978': '/explore/digital-resources/mobile-apps',
  '27184': '/explore/digital-resources/social-media',
  '1797': '/contact',
  '56402': '/explore/organization/annual-reports',
});
/** The bound pages' `tid`s, which no English editorial listing may also take. */
const MINHAJ_ORG_PAGE_TIDS: readonly string[] = Object.freeze(
  Object.keys(MINHAJ_ORG_PAGE_BINDINGS),
);

/**
 * Phase 30-RD. The source's own editor-curated archives the owner approved as
 * Collections, by `lkcatid` — never every category: Al-Hidayah (12), Mawlid
 * Conferences (1) and Itikaf during Ramadhan (2); and (R2, the owner's
 * 2026-11-06 extension of OPEN_DECISIONS.md §3.8) the site's other eleven
 * editor-curated "Top Events" archives — all there are, as the archive index
 * listed them on 2026-11-06: Women Activities (9), Welfare Projects & Events
 * (5), Conferences & Seminars (4), Interfaith Activities (3), Quaid Day
 * Programs (11), Spiritual Gatherings (54), Processions & Rallies (7),
 * Educational Projects (6), Overseas Activities (13), Visits & Delegations (52)
 * and Peace, Integration and Reconciliation (67).
 */
export const MINHAJ_ORG_COLLECTION_IDS: readonly string[] = Object.freeze([
  '12',
  '1',
  '2',
  '9',
  '5',
  '4',
  '3',
  '11',
  '54',
  '7',
  '6',
  '13',
  '52',
  '67',
]);

/**
 * Phase 30-RD. Every post those three archives hold, as their pages listed
 * them on 2026-10-31 (archive order; Itikaf names tid 18036 twice, kept once):
 * the bounded set of news posts migrated FIRST, so each Collection's members
 * are public before it is. No other post of the site is taken, and none of
 * these was held by any source before.
 *
 * R2. Then every post the eleven further archives hold, read from their pages
 * on 2026-11-06 by the Collection adapter itself, in archive order — each tid
 * once, under the first archive (in the order above) that lists it: a post
 * two archives name is a member of both and is migrated once. The two entries
 * recorded below stay excluded wherever an archive lists them.
 */
export const MINHAJ_ORG_ARCHIVE_TIDS: readonly string[] = Object.freeze([
  // Al-Hidayah (20)
  '48059',
  '47265',
  '44564',
  '41485',
  '41122',
  '41422',
  '38479',
  '38602',
  '12283',
  '12252',
  '12280',
  '8790',
  '8765',
  '8774',
  '8776',
  '8775',
  '3323',
  '3343',
  '3197',
  '134',
  // Mawlid Conferences (43)
  '60930',
  '54974',
  '57047',
  '52637',
  '50300',
  '47951',
  '45356',
  '42118',
  '39286',
  '35018',
  '31331',
  '25312',
  '20929',
  '15857',
  '13347',
  '9927',
  '7784',
  '3446',
  '3233',
  '3179',
  '13271',
  '3182',
  '11133',
  '3484',
  '3475',
  '7997',
  '3485',
  '7932',
  '7853',
  '8426',
  '62',
  '138',
  '3405',
  '7933',
  '3227',
  '3432',
  '7874',
  '3451',
  '3462',
  '3466',
  '7939',
  '8496',
  '8473',
  // Itikaf during Ramadhan (51)
  '23362',
  '23360',
  '23356',
  '23350',
  '23345',
  '23344',
  '23318',
  '23335',
  '23306',
  '23303',
  '18045',
  '18048',
  '18036',
  '18023',
  '18040',
  '18015',
  '18041',
  '18006',
  '18014',
  '17999',
  '18001',
  '17989',
  '14802',
  '14798',
  '14782',
  '14767',
  '9072',
  '9047',
  '9024',
  '9021',
  '9019',
  '9008',
  '8979',
  '8976',
  '8970',
  '8965',
  '3802',
  '3798',
  '3791',
  '3782',
  '3778',
  '3283',
  '3282',
  '3281',
  '3280',
  '3279',
  '3278',
  '3284',
  '9018',
  '3803',
  '3804',
  // Women Activities (lkcatid 9): 84 not listed above
  '26844',
  '14700',
  '12364',
  '8882',
  '7102',
  '3276',
  '26310',
  '26152',
  '15860',
  '9055',
  '9054',
  '9053',
  '9033',
  '9010',
  '9009',
  '8982',
  '8981',
  '8975',
  '8974',
  '3379',
  '3228',
  '3796',
  '3797',
  '2989',
  '2990',
  '2992',
  '2790',
  '2988',
  '2882',
  '3479',
  '84',
  '3476',
  '56',
  '32159',
  '32146',
  '32070',
  '31953',
  '31949',
  '31137',
  '30683',
  '28848',
  '28810',
  '27367',
  '26466',
  '26213',
  '25554',
  '24455',
  '24422',
  '23951',
  '23846',
  '23681',
  '23680',
  '23449',
  '23214',
  '23125',
  '22856',
  '18596',
  '18549',
  '17302',
  '16854',
  '15630',
  '15275',
  '14124',
  '12907',
  '12888',
  '12638',
  '9818',
  '11550',
  '11693',
  '9646',
  '9623',
  '9620',
  '9606',
  '2904',
  '3306',
  '49',
  '73',
  '3502',
  '7198',
  '7267',
  '7335',
  '7876',
  '8005',
  '8766',
  // Welfare Projects & Events (lkcatid 5): 77 not listed above
  '3533',
  '3723',
  '3732',
  '28421',
  '28534',
  '26277',
  '12143',
  '12174',
  '12756',
  '15002',
  '8599',
  '8482',
  '7136',
  '2857',
  '2854',
  '3131',
  '3132',
  '3134',
  '3135',
  '3143',
  '3257',
  '8551',
  '8536',
  '8529',
  '8524',
  '8508',
  '8506',
  '8469',
  '8486',
  '8467',
  '7668',
  '7423',
  '162',
  '104',
  '107',
  '105',
  '3129',
  '31348',
  '26500',
  '22113',
  '18677',
  '18637',
  '16539',
  '16431',
  '15235',
  '15059',
  '14974',
  '14970',
  '14634',
  '14090',
  '13911',
  '13651',
  '12911',
  '12786',
  '9477',
  '9369',
  '7922',
  '7309',
  '3465',
  '3241',
  '7312',
  '2785',
  '2849',
  '3726',
  '3727',
  '8799',
  '9527',
  '7199',
  '3728',
  '7319',
  '3322',
  '3729',
  '3731',
  '9376',
  '3545',
  '4167',
  '7270',
  // Conferences & Seminars (lkcatid 4): 69 not listed above
  '36751',
  '18204',
  '18223',
  '18183',
  '15468',
  '15052',
  '14940',
  '14507',
  '14456',
  '13852',
  '13214',
  '12858',
  '12902',
  '12708',
  '9959',
  '9647',
  '9587',
  '9385',
  '9263',
  '3660',
  '8716',
  '7911',
  '7484',
  '7867',
  '9526',
  '7742',
  '3534',
  '14926',
  '19887',
  '15498',
  '115',
  '7302',
  '3586',
  '3583',
  '3560',
  '3217',
  '3329',
  '7727',
  '3581',
  '13834',
  '9426',
  '2983',
  '3165',
  '3235',
  '3532',
  '3574',
  '7262',
  '7647',
  '3180',
  '4166',
  '3722',
  '13483',
  '9723',
  '9601',
  '9508',
  '9361',
  '7636',
  '7619',
  '7336',
  '7641',
  '3389',
  '3496',
  '7696',
  '14920',
  '15469',
  '14646',
  '9756',
  '7180',
  '3396',
  // Interfaith Activities (lkcatid 3): 52 not listed above
  '31829',
  '31545',
  '31383',
  '31275',
  '30736',
  '26400',
  '25973',
  '23739',
  '23385',
  '22624',
  '22187',
  '21647',
  '18423',
  '18271',
  '16007',
  '14224',
  '13561',
  '13754',
  '13680',
  '9686',
  '9567',
  '9548',
  '9451',
  '9027',
  '3359',
  '8823',
  '8807',
  '8425',
  '8798',
  '8448',
  '7652',
  '7327',
  '3561',
  '7295',
  '7293',
  '7284',
  '7117',
  '7097',
  '4176',
  '4175',
  '3771',
  '3585',
  '3212',
  '3204',
  '3203',
  '3199',
  '3095',
  '749',
  '3714',
  '407',
  '3216',
  '3555',
  // Quaid Day Programs (lkcatid 11): 30 not listed above
  '13488',
  '13439',
  '7669',
  '3398',
  '7259',
  '3424',
  '3411',
  '3385',
  '3423',
  '3399',
  '3383',
  '3344',
  '3339',
  '3337',
  '3338',
  '7708',
  '7737',
  '7755',
  '7710',
  '7694',
  '7634',
  '7642',
  '7659',
  '7621',
  '7592',
  '7628',
  '3390',
  '492',
  '3380',
  '488',
  // Spiritual Gatherings (lkcatid 54): 30 not listed above
  '23443',
  '12658',
  '12211',
  '12136',
  '11756',
  '11548',
  '9758',
  '9653',
  '9682',
  '9326',
  '9205',
  '8805',
  '8702',
  '8487',
  '3770',
  '3494',
  '3463',
  '3425',
  '2994',
  '3266',
  '3146',
  '3273',
  '12209',
  '9613',
  '9346',
  '9345',
  '3387',
  '3724',
  '88',
  '89',
  // Processions & Rallies (lkcatid 7): 16 not listed above
  '25134',
  '15532',
  '13532',
  '8537',
  '8671',
  '3767',
  '724',
  '3449',
  '3515',
  '15344',
  '7440',
  '7438',
  '7464',
  '3564',
  '3558',
  '3559',
  // Educational Projects (lkcatid 6): 18 not listed above
  '9612',
  '8927',
  '8926',
  '8915',
  '3388',
  '3378',
  '422',
  '3478',
  '8925',
  '82',
  '125',
  '376',
  '9516',
  '9493',
  '7648',
  '7567',
  '3139',
  '353',
  // Overseas Activities (lkcatid 13): 6 not listed above
  '9678',
  '9327',
  '7899',
  '8804',
  '2881',
  '3486',
  // Visits & Delegations (lkcatid 52): 14 not listed above
  '3345',
  '7627',
  '3536',
  '3576',
  '3544',
  '3482',
  '3519',
  '3529',
  '81',
  '87',
  '102',
  '143',
  '135',
  '106',
  // Peace, Integration and Reconciliation activity (lkcatid 67): 9 not listed above
  '31221',
  '31524',
  '18417',
  '12065',
  '9679',
  '9234',
  '8701',
  '9073',
  '7223',
]);

/**
 * Phase 30-RD. The archive entries no record can be made of, as the member
 * run of 2026-10-31 found them, each with the reason — reviewed here, never
 * inferred. Owner decision 2026-10-31: each archive is published without
 * exactly these, and its staged payload names them for the reviewer.
 */
export const MINHAJ_ORG_ARCHIVE_EXCLUSIONS: Readonly<Record<string, string>> =
  Object.freeze({
    // Al-Hidayah: "European al-Hidayah Camp 2017: Highlights".
    '41122':
      'A photo-only post: seven pictures and two social-media embeds, no text an Editorial record can carry (2026-10-31).',
    // Mawlid Conferences, "Other Mawlid Conferences".
    '3484':
      'The source no longer serves this post: its address redirects to the site home page (2026-10-31).',
  });

/**
 * The English `tid`s other sources own — the bound pages and the archive
 * members — which no English editorial LISTING may also take, so one legacy
 * address never maps to two records.
 */
const MINHAJ_ORG_ENGLISH_RESERVED_TIDS: readonly string[] = Object.freeze([
  ...MINHAJ_ORG_PAGE_TIDS,
  ...MINHAJ_ORG_ARCHIVE_TIDS,
]);

/**
 * Phase 30-R. The public leadership profiles on minhaj.org. The founder's own
 * profile (tid 8718) is the Shaykh-ul-Islam biography PAGE above, so one legacy
 * address never maps to two records.
 */
export const MINHAJ_ORG_PROFILE_TIDS: readonly string[] = Object.freeze([
  '120',
  '34530',
  '49802',
]);

/**
 * Phase 30-R. The Minhaj Books categories of the review build, walked in this
 * order — The Hadith first, the Stage-1A slice every later run keeps.
 *
 * R2. Then every other English category the site's sitemap names (33 in all,
 * surveyed 2026-11-06), so the whole catalogue is walked: a book filed under
 * several categories is one record, keyed by its id. The language, PDF and
 * author listings are not walked — they link books only by slug, which cannot
 * be keyed without fetching each book.
 */
export const MINHAJ_BOOKS_LISTINGS: readonly string[] = Object.freeze([
  '/english/cat/The-Hadith/',
  '/english/cat/The-Quran-and-the-Quranic-Sciences/',
  '/english/cat/The-Prophet-s-life-Conduct-and-Virtues/',
  '/english/cat/Morality-and-Spiritualism/',
  '/english/cat/Islam-and-Science/',
  '/english/cat/Human-Rights-and-Contemporary-Era/',
  // R2
  '/english/cat/Science-of-Beliefs-Bases-and-Branches/',
  '/english/cat/Science-of-Faith-and-Worship/',
  '/english/cat/Finality-of-Prophethood-and-the-Comparative-Study/',
  '/english/cat/Jurisprudence/',
  '/english/cat/Religious-Litanies-and-Devotions-Awrad-and-Wazaif/',
  '/english/cat/Economics/',
  '/english/cat/Ideologies/',
  '/english/cat/Constitutions-and-Legislative-Practices/',
  '/english/cat/Celebrities-and-Luminaries/',
  '/english/cat/Islamic-Teachings-Series/',
  '/english/cat/Peace-Love-and-Counter-Terrorrism/',
  '/english/cat/English-Books/',
  '/english/cat/Dr-Hassan-Mohi-ud-Din-Qadri/',
  '/english/cat/Dr-Hussain-Mohi-ud-Din/',
  '/english/cat/Al-Hadith-Aqaid-o-Ibadat/',
  '/english/cat/Al-Hadith-Arbainat/',
  '/english/cat/Al-Hadith-Fazail-e-Nabawi/',
  '/english/cat/Al-Hadith-Irfan-e-Bari-Taala/',
  '/english/cat/Al-Hadith-Manaqib-e-Sahaba-wa-Ahle-Bayt-awr-Awlia/',
  '/english/cat/Al-Hadith-Shakhsiyat-o-Marwiyat-e-Sufiya/',
  '/english/cat/Arbainat-Fazail-e-Nabawi/',
  '/english/cat/Arbainat-Fikriyat-o-Asriyat/',
  '/english/cat/Arbainat-Ibadat/',
  '/english/cat/Arbainat-Imaniyat-o-Aitiqadiyat/',
  '/english/cat/Arbainat-Irfan-e-Bari-Taala/',
  '/english/cat/Arbainat-Manaqib-e-Sahaba-wa-Ahle-Bayt-awr-Awlia/',
  '/english/cat/Arbainat-Quraniyat/',
]);

/**
 * R2. The Minhaj Books author pages read as public profiles — the publisher's
 * author index of 2026-11-06 less the four authors already public as one
 * record each: the founder (his biography Page, tid 8718), Dr Hassan and Dr
 * Hussain Mohi-ud-Din Qadri (leadership profiles 34530, 49802) and Dr Farid-ud-
 * Din Qadri (profile 120). One person, one record.
 */
export const MINHAJ_BOOKS_AUTHORS: readonly string[] = Object.freeze([
  'Abdul-Sattar-Minhajian',
  'Dr-Muhammad-Akram-Qadri',
  'Dr-Naeem-Mushtaq',
  'Ghulam-Murtaza-Alvi',
  'Hafiz-Muhammad-Saeed-Raza-Baghdadi',
  'Mufti-Abdul-Qayyum-Khan',
  'Muhammad-Farooq-Rana',
  'Shaykh-Hammad-Mustafa',
]);
const IRFAN = 'https://www.irfan-ul-quran.com/';

export const AUTHORISED_SOURCES: readonly AuthorisedSourceDefinition[] = Object.freeze([
  {
    key: 'minhaj-org-news-en',
    name: 'Minhaj.org — English news',
    contentKind: 'editorial.news',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
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
        reservedTids: MINHAJ_ORG_ENGLISH_RESERVED_TIDS,
      }),
  },
  {
    key: 'minhaj-org-news-ur',
    name: 'Minhaj.org — Urdu news',
    contentKind: 'editorial.news',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
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
        reservedTids: [],
      }),
  },
  {
    key: 'minhaj-org-articles-en',
    name: 'Minhaj.org — English articles',
    contentKind: 'editorial.article',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
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
        reservedTids: MINHAJ_ORG_ENGLISH_RESERVED_TIDS,
      }),
  },
  {
    key: 'minhaj-org-news-ar',
    name: 'Minhaj.org — Arabic news',
    contentKind: 'editorial.news',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
    defaultLanguageCode: 'ar',
    policy: AUTHORISED_POLICY,
    policyNotes: `News & Events listing (Arabic). ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgEditorialAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        kind: 'editorial.news',
        section: 'News-Events',
        language: 'arabic',
        reservedTids: [],
      }),
  },
  {
    key: 'minhaj-org-press-releases-en',
    name: 'Minhaj.org — English press releases',
    contentKind: 'editorial.press-release',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes: `Press Release listing (English). ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgEditorialAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        kind: 'editorial.press-release',
        section: 'Press-Release',
        language: 'english',
        reservedTids: MINHAJ_ORG_ENGLISH_RESERVED_TIDS,
      }),
  },
  {
    // R2: the Urdu Press-Release listing (470 pages of 20, newest first).
    key: 'minhaj-org-press-releases-ur',
    name: 'Minhaj.org — Urdu press releases',
    contentKind: 'editorial.press-release',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes: `Press Release listing (Urdu). ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgEditorialAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        kind: 'editorial.press-release',
        section: 'Press-Release',
        language: 'urdu',
        reservedTids: [],
      }),
  },
  {
    // R2: the Urdu Articles listing (19 pages of 40).
    key: 'minhaj-org-articles-ur',
    name: 'Minhaj.org — Urdu articles',
    contentKind: 'editorial.article',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes: `Articles listing (Urdu). ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgEditorialAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        kind: 'editorial.article',
        section: 'Articles',
        language: 'urdu',
        reservedTids: [],
      }),
  },
  {
    key: 'minhaj-org-pages-en',
    name: 'Minhaj.org — organisational pages (English)',
    contentKind: 'editorial.page',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `The catalogued organisational pages, each bound to one reserved Explore route; ` +
      `pre-adoption review content, subject to Minhaj content acceptance. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgPageAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        items: selection.items,
        language: 'english',
        bindings: MINHAJ_ORG_PAGE_BINDINGS,
      }),
  },
  {
    key: 'minhaj-org-archive-news-en',
    name: 'Minhaj.org — curated-archive news posts (English)',
    contentKind: 'editorial.news',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `The catalogued posts the owner-approved curated archives hold — migrated first, so ` +
      `every Collection member is public before its Collection. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgArchiveNewsAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        items: selection.items,
        language: 'english',
        tids: MINHAJ_ORG_ARCHIVE_TIDS,
      }),
  },
  {
    key: 'minhaj-org-collections-en',
    name: 'Minhaj.org — curated archives (English)',
    contentKind: 'editorial.collection',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: [],
    assetHostEvidence: null,
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `The owner-approved editor-curated archives the catalogue names by lkcatid, as ` +
      `Collections: title, description and members in source order; no image; the entries ` +
      `the catalogue records as unmigratable are named, not carried. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgCollectionAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        items: selection.items,
        language: 'english',
        archives: MINHAJ_ORG_COLLECTION_IDS,
        exclusions: MINHAJ_ORG_ARCHIVE_EXCLUSIONS,
      }),
  },
  {
    key: 'minhaj-org-people-en',
    name: 'Minhaj.org — leadership profiles (English)',
    contentKind: 'people.person',
    baseUrl: MINHAJ_ORG,
    hosts: ['www.minhaj.org'],
    assetHosts: MINHAJ_ORG_ASSET_HOSTS,
    assetHostEvidence: MINHAJ_NET_EVIDENCE,
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `The catalogued public leadership profiles: name, whole biography paragraphs and the ` +
      `profile's own portrait; no contact detail. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOrgPersonAdapter({
        baseUrl: MINHAJ_ORG,
        selection,
        items: selection.items,
        language: 'english',
        tids: MINHAJ_ORG_PROFILE_TIDS,
      }),
  },
  {
    key: 'minhaj-overseas-countries',
    name: 'Minhaj Overseas (DFA) — countries of presence',
    contentKind: 'global.country',
    baseUrl: MINHAJ_OVERSEAS,
    hosts: ['minhajoverseas.com'],
    assetHosts: [],
    assetHostEvidence: null,
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `The Directorate of Foreign Affairs' "MQI in different Countries of the world" page and ` +
      `each listed country's page; no person's contact detail is read. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajOverseasCountryAdapter({ baseUrl: MINHAJ_OVERSEAS, selection }),
  },
  {
    key: 'minhajbooks-works',
    name: 'Minhaj Books — works',
    contentKind: 'library.work',
    baseUrl: MINHAJ_BOOKS,
    hosts: ['www.minhajbooks.com'],
    assetHosts: [],
    assetHostEvidence: null,
    defaultLanguageCode: null,
    policy: AUTHORISED_POLICY,
    policyNotes:
      `Book landing pages of the catalogued categories: metadata, introductions and the cover ` +
      `picture; no PDF, page image or sale-point data in Stage 1A. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajBooksWorkAdapter({
        baseUrl: MINHAJ_BOOKS,
        selection,
        listings: MINHAJ_BOOKS_LISTINGS,
      }),
  },
  {
    // R2: the publisher's author pages as public profiles.
    key: 'minhajbooks-authors',
    name: 'Minhaj Books — author profiles',
    contentKind: 'people.person',
    baseUrl: MINHAJ_BOOKS,
    hosts: ['www.minhajbooks.com'],
    assetHosts: [],
    assetHostEvidence: null,
    defaultLanguageCode: 'en',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `The catalogued author pages: name, the full biography paragraph and the author's own ` +
      `photo; no social link, contact detail or book list. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajBooksAuthorAdapter({
        baseUrl: MINHAJ_BOOKS,
        selection,
        items: selection.items,
        authors: MINHAJ_BOOKS_AUTHORS,
      }),
  },
  {
    key: 'minhaj-info-magazines',
    name: 'Minhaj magazines — titles',
    contentKind: 'library.magazine',
    baseUrl: MINHAJ_INFO,
    hosts: ['minhaj.info'],
    assetHosts: [],
    assetHostEvidence: null,
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes: `Magazine archive pages. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajInfoMagazineAdapter({
        baseUrl: MINHAJ_INFO,
        selection,
        // R2: the quarterly al-Ulama, its issues a source of their own.
        magazines: ['/minhaj-ul-quran-mags', '/dukhtran-e-islam', '/ulama-mags'],
      }),
  },
  {
    key: 'minhaj-info-issues-mq',
    name: 'Monthly Minhaj-ul-Quran — issues',
    contentKind: 'library.magazine-issue',
    baseUrl: MINHAJ_INFO,
    hosts: ['minhaj.info'],
    assetHosts: [],
    assetHostEvidence: null,
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
    assetHosts: [],
    assetHostEvidence: null,
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
    // R2: the quarterly al-Ulama.
    key: 'minhaj-info-issues-ulama',
    name: 'al-Ulama — issues',
    contentKind: 'library.magazine-issue',
    baseUrl: MINHAJ_INFO,
    hosts: ['minhaj.info'],
    assetHosts: [],
    assetHostEvidence: null,
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes: `Issue pages: titles, dates and the table of contents; no PDF. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajInfoIssueAdapter({
        baseUrl: MINHAJ_INFO,
        selection,
        magazine: '/ulama-mags',
      }),
  },
  {
    key: 'minhaj-tv-videos',
    name: 'Minhaj.TV — video lectures',
    contentKind: 'media.video',
    baseUrl: MINHAJ_TV,
    hosts: ['www.minhaj.tv'],
    assetHosts: [],
    assetHostEvidence: null,
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
    // R2: the Urdu Speeches listing (90 pages of 30). The listing itself is the
    // site's statement of the speech language — the source's declared default,
    // used only when a page names no language category of its own. A video
    // the English listing also holds collapses into one record by its YouTube id.
    key: 'minhaj-tv-videos-ur',
    name: 'Minhaj.TV — Urdu video lectures',
    contentKind: 'media.video',
    baseUrl: MINHAJ_TV,
    hosts: ['www.minhaj.tv'],
    assetHosts: [],
    assetHostEvidence: null,
    defaultLanguageCode: 'ur',
    policy: AUTHORISED_POLICY,
    policyNotes:
      `Video metadata and YouTube identifiers of the /english/Urdu-Speeches/ listing only ` +
      `(robots.txt disallows /urdu); no video file is downloaded. ${PUBLIC_ONLY}`,
    adapter: (selection) =>
      createMinhajTvVideoAdapter({
        baseUrl: MINHAJ_TV,
        selection,
        listing: 'Urdu-Speeches',
      }),
  },
  {
    key: 'thefatwa-rulings',
    name: 'TheFatwa — published rulings (review only)',
    contentKind: 'fatwa.ruling',
    baseUrl: THE_FATWA,
    hosts: ['thefatwa.com'],
    assetHosts: [],
    assetHostEvidence: null,
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
    assetHosts: [],
    assetHostEvidence: null,
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
    assetHosts: [],
    assetHostEvidence: null,
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
