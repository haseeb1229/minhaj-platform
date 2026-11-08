import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { QURAN_MODE_POSTURE } from '@minhaj/contracts/quran';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { globalReadRuntime } from '@/composition/global-read';
import { learningReadRuntime } from '@/composition/learning-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { mediaReadRuntime } from '@/composition/media-read';
import { peopleReadRuntime } from '@/composition/people-read';
import { interfaceLanguageFirst } from '@/components/content-language';
import { translationFor } from '@/components/editorial/presentation';
import { CollectionsIndex } from '@/components/home/collections';
import { GlobalReach } from '@/components/home/global';
import { HomeHero } from '@/components/home/hero';
import { LearnModule } from '@/components/home/learn';
import { Leadership } from '@/components/home/leadership';
import { BooksShelf, MagazineRack } from '@/components/home/library';
import { MyMinhajInvitation } from '@/components/home/my-minhaj';
import { LatestNews } from '@/components/home/news';
import { heroStory, newsLayout } from '@/components/home/presentation';
import { QuranEntry } from '@/components/home/quran';
import { WatchShelf } from '@/components/home/watch';
import { quranAvailability, readSurahs } from '@/components/quran/read';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * THE HOME PAGE (Rebaseline R2).
 *
 * ONE CONCEPT, NOT A STACK OF MODULES. The page opens on what this place is and
 * its two ways in — the Quran, and the knowledge around it — beside one real
 * picture; then the Quran itself, the news as a front page, the Library as a
 * shelf of covers, lectures as posters, the latest magazine issues, curated
 * collections, the network's reach, its leadership, Learn when it has courses,
 * and an invitation to My Minhaj. Each module lives in `components/home/`.
 *
 * WHAT IT SAYS ABOUT ITSELF IS PRODUCT-LEVEL ONLY: what the platform offers and
 * that it needs no account. Organisational words appear only as the PUBLISHED
 * records that carry them — Pages, People profiles and the domains' records.
 * No reviewer or engineering notice sits on this page; the footer carries the
 * one pre-adoption note.
 *
 * WHAT IT SHOWS IS WHAT HAS BEEN PUBLISHED. Every module renders ONLY when its
 * owner returns something: the home page of an empty deployment is the hero
 * and the invitation, and it grows as content is published. The Quran entry
 * appears only while the deployment presents a navigable Quran.
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
} as const;

/** The founder's biography Page, which leads the leadership module. */
const FOUNDER_BINDING = '/explore/shaykh-ul-islam/biography';

export default async function HomePage({ params }: HomeParams) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  const editorial = editorialReadRuntime();
  const library = libraryReadRuntime();
  const [
    quran,
    news,
    works,
    issues,
    videos,
    collections,
    countries,
    people,
    pages,
    courses,
  ] = await Promise.all([
    quranAvailability(),
    editorial.newsList('news-article', 0),
    library.works({ sort: 'newest', titleLocale: locale }),
    library.scholarlyList('magazine-issue', {}),
    mediaReadRuntime().videos({}),
    editorial.collections(0),
    globalReadRuntime().countryChoices(),
    peopleReadRuntime().people.publicPeople({ locale, limit: PREVIEW.people }),
    editorial.explorePages(),
    learningReadRuntime().courses({}),
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
      <LatestNews locale={locale} lead={lead} rest={rest} />
      <BooksShelf locale={locale} works={shelf} />
      <WatchShelf locale={locale} videos={videos.items.slice(0, PREVIEW.videos)} />
      <MagazineRack locale={locale} issues={issues.items.slice(0, PREVIEW.issues)} />
      <CollectionsIndex
        locale={locale}
        items={collections.items.slice(0, PREVIEW.collections)}
      />
      <GlobalReach locale={locale} countries={countries} />
      <Leadership
        locale={locale}
        founder={pages.find((page) => page.routeBinding === FOUNDER_BINDING) ?? null}
        people={people.items}
      />
      <LearnModule locale={locale} courses={courses.items.slice(0, PREVIEW.courses)} />
      <MyMinhajInvitation locale={locale} />
    </>
  );
}
