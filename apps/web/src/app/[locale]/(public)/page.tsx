import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import type { EventSummary, EventWhen } from '@minhaj/contracts/editorial';
import type { FatwaAvailability, PublicFatwaSummary } from '@minhaj/contracts/fatwa';
import { QURAN_MODE_POSTURE } from '@minhaj/contracts/quran';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { fatwaReadRuntime } from '@/composition/fatwa-read';
import { globalReadRuntime } from '@/composition/global-read';
import { learningReadRuntime } from '@/composition/learning-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { mediaReadRuntime } from '@/composition/media-read';
import { peopleReadRuntime } from '@/composition/people-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { interfaceLanguageFirst } from '@/components/content-language';
import { translationFor } from '@/components/editorial/presentation';
import { fatwaAvailability } from '@/components/fatwa/read';
import { hadithAvailability } from '@/components/hadith/read';
import { CollectionsIndex } from '@/components/home/collections';
import { AreasModule, ExploreSections } from '@/components/home/directory';
import { EventsModule } from '@/components/home/events';
import { FatwaModule } from '@/components/home/fatwa';
import { GlobalReach } from '@/components/home/global';
import { HomeHero } from '@/components/home/hero';
import { LearnModule } from '@/components/home/learn';
import { Leadership } from '@/components/home/leadership';
import { BooksShelf, MagazineRack } from '@/components/home/library';
import { ListenModule } from '@/components/home/listen';
import { MyMinhajInvitation } from '@/components/home/my-minhaj';
import { LatestNews } from '@/components/home/news';
import { OrganisationModule } from '@/components/home/organisation';
import { heroStory, newsLayout } from '@/components/home/presentation';
import { QuranEntry } from '@/components/home/quran';
import { SourcesModule } from '@/components/home/sources';
import { TopicsModule } from '@/components/home/topics';
import { WatchShelf } from '@/components/home/watch';
import { quranAvailability, readSurahs } from '@/components/quran/read';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * THE HOME PAGE (Rebaseline R2).
 *
 * The page opens on what this place is and its two ways in — the Quran, and
 * the knowledge around it — beside one real picture, with the search box and
 * the way to Explore; then the Quran itself, the two sources, the news as a
 * front page, the Library as a shelf of covers, lectures as posters and audio,
 * the latest magazine issues, Events, rulings, the organisation's own Pages,
 * its leadership, curated collections, the network's reach, Learn, the
 * platform's areas, its topics, the Explore sections and an invitation to My
 * Minhaj. Each module lives in `components/home/`.
 *
 * RESTORED AFTER R2 (owner direction, 2026-11-08): the R2 redesign had dropped
 * the hero search and Explore link, the always-present Quran and Hadith cards,
 * the areas, and the Events, rulings, audio, organisation, topics and Explore
 * modules, and the Centre finder as the Global module's way on. They are back,
 * in R2's visual language, behaving as the pre-R2 portal did.
 *
 * WHAT IT SAYS ABOUT ITSELF IS PRODUCT-LEVEL ONLY: what the platform offers and
 * that it needs no account. Organisational words appear only as the PUBLISHED
 * records that carry them — Pages, People profiles and the domains' records.
 * No reviewer or engineering notice sits on this page; the footer carries the
 * one pre-adoption note.
 *
 * WHAT IT SHOWS IS WHAT HAS BEEN PUBLISHED. A content module renders ONLY when
 * its owner returns something; the home page of an empty deployment is the
 * hero, the two sources, the areas, the Explore sections and the invitation,
 * and it grows as content is published. The Quran and Hadith cards are always
 * present and say honestly whether a text is available; the Quran entry's
 * quick links appear only while the deployment presents a navigable Quran.
 *
 * BOUNDED AND DETERMINISTIC. Every read is the first page of its owner's own
 * public listing (or a bounded choice list), sliced to a handful.
 *
 * SIGNED OUT, ALWAYS, AND DYNAMIC. The page reads mutable published data, so
 * it renders per request, and every reader is a session-free `*-read` root: a
 * signed-in visitor and an anonymous one receive the same document
 * (ARCHITECTURE.md §8.1). No structured data: a pre-adoption origin makes no
 * machine-readable claim to be the organisation (ROUTE_MAP.md §9.6).
 */
export const dynamic = 'force-dynamic';

interface HomeParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: HomeParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'shell' });

  // No `title`: the home page's title IS the product name, which the root
  // layout already supplies as the default.
  return shellMetadata({
    locale,
    route: requireRoute('home'),
    description: t('home.description'),
  });
}

/** How many records each module shows before linking to its owner's listing. */
const PREVIEW = {
  newsBeside: 4,
  books: 12,
  issues: 12,
  videos: 12,
  collections: 6,
  people: 6,
  courses: 3,
  events: 4,
  rulings: 4,
  pages: 6,
  tracks: 4,
  topics: 14,
} as const;

/** The founder's biography Page, which leads the leadership module. */
const FOUNDER_BINDING = '/explore/shaykh-ul-islam/biography';

/**
 * The soonest upcoming Events; when none is upcoming, the most recent past
 * ones — reported as past, never as upcoming.
 */
async function readEvents(): Promise<{
  readonly when: EventWhen;
  readonly items: readonly EventSummary[];
}> {
  const reads = editorialReadRuntime();
  const upcoming = await reads.events({ when: 'upcoming', offset: 0, centreIds: null });
  if (upcoming.items.length > 0) return { when: 'upcoming', items: upcoming.items };
  const past = await reads.events({ when: 'past', offset: 0, centreIds: null });
  return { when: 'past', items: past.items };
}

/** The newest published rulings, read only while the service is activated. */
async function readRulings(): Promise<{
  readonly availability: FatwaAvailability;
  readonly items: readonly PublicFatwaSummary[];
}> {
  const availability = await fatwaAvailability();
  if (!availability.active) return { availability, items: [] };
  const page = await fatwaReadRuntime().reader.browse({
    sort: 'latest',
    categoryId: null,
    topicId: null,
    offset: 0,
  });
  return { availability, items: page.items };
}

export default async function HomePage({ params }: HomeParams) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  const editorial = editorialReadRuntime();
  const library = libraryReadRuntime();
  const media = mediaReadRuntime();
  const network = globalReadRuntime();
  const [
    quran,
    hadith,
    news,
    works,
    issues,
    videos,
    tracks,
    events,
    rulings,
    collections,
    countries,
    hasCentres,
    people,
    pages,
    courses,
    topics,
  ] = await Promise.all([
    quranAvailability(),
    hadithAvailability(),
    editorial.newsList('news-article', 0),
    library.works({ sort: 'newest', titleLocale: locale }),
    library.scholarlyList('magazine-issue', {}),
    media.videos({}),
    media.audioTracks({}),
    readEvents(),
    readRulings(),
    editorial.collections(0),
    network.countryChoices(),
    network.hasPublicCentres(),
    peopleReadRuntime().people.publicPeople({ locale, limit: PREVIEW.people }),
    editorial.explorePages(),
    learningReadRuntime().courses({}),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
  ]);

  // A Quran the deployment presents for navigation: an approved corpus, or a
  // reference preview it admits. Fixture text is never offered from here.
  const quranOpen = quran.active && QURAN_MODE_POSTURE[quran.mode].navigation;
  const surahs = quranOpen ? await readSurahs() : [];

  // The interface language first, every other language after it (F10).
  const stories = interfaceLanguageFirst(
    news.items,
    (item) => translationFor(item, locale).languageCode,
    locale,
  );
  const hero = heroStory(stories);
  const { lead, rest } = newsLayout(stories, hero, PREVIEW.newsBeside);

  // Covers first, each group in the Library's newest-first order.
  const shelf = [
    ...works.items.filter((work) => work.cover !== null),
    ...works.items.filter((work) => work.cover === null),
  ].slice(0, PREVIEW.books);

  // The organisation's own published Pages; the founder's biography leads the
  // leadership module instead, so it is not repeated here.
  const founder = pages.find((page) => page.routeBinding === FOUNDER_BINDING) ?? null;
  const organisation = pages
    .filter((page) => page.routeBinding !== FOUNDER_BINDING)
    .slice(0, PREVIEW.pages);

  // The taxonomy's active top-level topics, in its own order.
  const roots = topics
    .filter((topic) => topic.parentId === null && topic.status === 'active')
    .slice(0, PREVIEW.topics);

  return (
    <>
      <HomeHero locale={locale} story={hero} quranOpen={quranOpen} />
      {quranOpen ? (
        <QuranEntry
          locale={locale}
          surahs={surahs}
          preview={quran.active && quran.mode === 'reference'}
        />
      ) : null}
      <SourcesModule locale={locale} quran={quran} hadith={hadith} />
      <LatestNews locale={locale} lead={lead} rest={rest} />
      <BooksShelf locale={locale} works={shelf} />
      <WatchShelf locale={locale} videos={videos.items.slice(0, PREVIEW.videos)} />
      <ListenModule locale={locale} tracks={tracks.items.slice(0, PREVIEW.tracks)} />
      <MagazineRack locale={locale} issues={issues.items.slice(0, PREVIEW.issues)} />
      <EventsModule
        locale={locale}
        when={events.when}
        items={events.items.slice(0, PREVIEW.events)}
      />
      <FatwaModule
        locale={locale}
        availability={rulings.availability}
        items={rulings.items.slice(0, PREVIEW.rulings)}
      />
      <OrganisationModule locale={locale} pages={organisation} />
      <Leadership locale={locale} founder={founder} people={people.items} />
      <CollectionsIndex
        locale={locale}
        items={collections.items.slice(0, PREVIEW.collections)}
      />
      <GlobalReach locale={locale} countries={countries} hasCentres={hasCentres} />
      <LearnModule locale={locale} courses={courses.items.slice(0, PREVIEW.courses)} />
      <AreasModule locale={locale} />
      <TopicsModule locale={locale} roots={roots} />
      <ExploreSections locale={locale} />
      <MyMinhajInvitation locale={locale} />
    </>
  );
}
