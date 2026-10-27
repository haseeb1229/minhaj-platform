import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { collectionPathOf } from '@minhaj/contracts/editorial';
import { globalPaths } from '@minhaj/contracts/global';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { globalReadRuntime } from '@/composition/global-read';
import { learningReadRuntime } from '@/composition/learning-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { EventGrid } from '@/components/editorial/events';
import { NewsGrid } from '@/components/editorial/news';
import { translationFor } from '@/components/editorial/presentation';
import { FatwaList, categoryLabels } from '@/components/fatwa/list';
import { FatwaFixtureNotice } from '@/components/fatwa/parts';
import { fatwaAvailability } from '@/components/fatwa/read';
import { fatwaReadRuntime } from '@/composition/fatwa-read';
import { placeName } from '@/components/global/presentation';
import { hadithAvailability } from '@/components/hadith/read';
import { CourseGrid } from '@/components/learning/parts';
import { labelFor, readLibraryQuery, workPath } from '@/components/library/presentation';
import { listingHref } from '@/components/library/scholarly';
import {
  readScholarlyQuery,
  scholarlyLabel,
} from '@/components/library/scholarly-presentation';
import { AudioPreview } from '@/components/media/listen';
import { VideoPreview } from '@/components/media/watch';
import { quranAvailability } from '@/components/quran/read';
import {
  ActionLink,
  CardGrid,
  Container,
  LinkCard,
  PageHero,
  Panel,
  SectionHeader,
  TopicChips,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { EXPLORE_SECTIONS } from '@/shell/explore';
import { PRODUCT_NAME } from '@/shell/product';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * THE HOME PORTAL.
 *
 * WHAT IT SAYS ABOUT ITSELF IS PRODUCT-LEVEL ONLY: what One Minhaj is, where to
 * search, and which areas exist. It states NO organisational content — no
 * mission, no vision, no history, no leadership, no impact figure, no
 * testimonial, no award and no Quran or Hadith excerpt. Each of those is either
 * an organisational fact Minhaj owns and publishes through the Phase-6 `Page`
 * workflow (OPEN_DECISIONS.md §6.1) or a record a domain publishes.
 *
 * WHAT IT SHOWS IS WHAT HAS BEEN PUBLISHED. Below the hero, the page composes
 * the owners' PUBLIC readers at Layer 4 — Editorial's News, Events and
 * Collections, Library's Works and Magazines, Media's Videos and audio,
 * Fatwa's rulings, Learning's Courses, the Global directory and the Taxonomy —
 * and each module renders ONLY when its owner returns something. A module with
 * nothing to show is omitted, not shown empty: the portal of an empty
 * deployment is the hero, the two sources, the areas and Explore, and it grows
 * as content is published. The Quran and Hadith entries are always present,
 * and say honestly whether a text is available.
 *
 * BOUNDED AND DETERMINISTIC. Every read is the FIRST page of its owner's own
 * public listing, in that owner's own stable order, sliced to a handful; no
 * module loads a corpus to choose from it.
 *
 * SIGNED OUT, ALWAYS, AND DYNAMIC. The page reads mutable published data, so
 * a prerendered copy would keep offering a record since withdrawn — it renders
 * per request. Every reader is a session-free `*-read` root: no cookie, no
 * session and no identity service is reachable from here, so a signed-in
 * visitor and an anonymous one receive the same document (ARCHITECTURE.md
 * §8.1). No client JavaScript and no structured data: a pre-adoption origin
 * makes no machine-readable claim to be the organisation (ROUTE_MAP.md §9.6).
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

/** How many records each module previews before linking to its owner's listing. */
const PREVIEW = {
  news: 4,
  events: 4,
  works: 3,
  magazines: 3,
  rulings: 4,
  courses: 3,
  collections: 3,
  countries: 12,
  topics: 14,
} as const;

export default async function HomePage({ params }: HomeParams) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <>
      <HomeHero locale={locale} />

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <SourcesModule locale={locale} />
          <AreasModule locale={locale} />
          <NewsModule locale={locale} />
          <EventsModule locale={locale} />
          <LibraryModule locale={locale} />
          <WatchModule locale={locale} />
          <FatwaModule locale={locale} />
          <CoursesModule locale={locale} />
          <CollectionsModule locale={locale} />
          <GlobalModule locale={locale} />
          <TopicsModule locale={locale} />

          <section aria-labelledby="home-explore" className="flex flex-col gap-5">
            <SectionHeader
              id="home-explore"
              heading={t('home.exploreHeading')}
              intro={t('home.exploreIntro')}
              action={{
                href: pathFor(locale, requireRoute('explore')),
                text: t('home.exploreAction'),
              }}
            />
            <CardGrid>
              {EXPLORE_SECTIONS.map((section) => (
                <LinkCard
                  key={section}
                  href={pathFor(locale, requireRoute(`explore.${section}`))}
                  title={t(`explore.${section}.title` as 'explore.about.title')}
                  description={t(`explore.${section}.summary` as 'explore.about.summary')}
                />
              ))}
            </CardGrid>
          </section>

          {/*
           * THE ACCOUNT ENTRY POINT, described rather than personalised.
           *
           * It says what an account is for and links to it. It does NOT say
           * whether anybody is signed in, because this page is one document
           * served to every visitor and a greeting here would be somebody
           * else's (ARCHITECTURE.md §8.1).
           */}
          <section aria-labelledby="home-account">
            <Panel>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                <div className="flex flex-col gap-1.5">
                  <h2 id="home-account" className="text-heading font-semibold">
                    {t('home.accountHeading')}
                  </h2>
                  <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
                    {t('home.accountBody')}
                  </p>
                </div>
                <div className="shrink-0">
                  <ActionLink
                    href={pathFor(locale, requireRoute('my-minhaj'))}
                    tone="secondary"
                  >
                    {t('nav.myMinhaj')}
                  </ActionLink>
                </div>
              </div>
            </Panel>
          </section>
        </div>
      </Container>
    </>
  );
}

/* ===========================================================================
 * The hero
 * ========================================================================= */

/**
 * The product, stated plainly, and the search box.
 *
 * The search is a GET form to the delivered `/search` page — it works without
 * JavaScript, and its query is a shareable address. Its label and button are
 * worded so that neither collides with the not-found page's own search.
 */
async function HomeHero({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <PageHero
      tone="ink"
      title={<span lang="en">{PRODUCT_NAME}</span>}
      lede={t('home.lede')}
    >
      <form
        method="get"
        action={pathFor(locale, requireRoute('search'))}
        role="search"
        aria-label={t('home.search.label')}
        className="flex w-full max-w-2xl flex-col gap-2"
      >
        <label htmlFor="home-search" className="text-sm font-medium">
          {t('home.search.label')}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="home-search"
            type="search"
            name="q"
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            autoComplete="off"
            className="min-h-12 w-full min-w-0 flex-1 rounded-[var(--radius-control)] border border-[color:var(--color-ink-border)] bg-[color:var(--color-surface-raised)] px-4 text-base text-[color:var(--color-foreground)]"
          />
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center rounded-[var(--radius-control)] bg-[color:var(--color-ink-accent)] px-6 text-sm font-semibold text-[color:var(--color-ink)] transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--color-ink-foreground)] active:bg-[color:var(--color-ink-muted)]"
          >
            {t('home.search.submit')}
          </button>
        </div>
      </form>

      {/* The way in for a visitor who came to browse rather than search, and
          the honest, quiet statement of where this deployment stands. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
        <ActionLink
          href={pathFor(locale, requireRoute('explore'))}
          tone="secondary"
          onInk
        >
          {t('home.exploreAction')}
        </ActionLink>
        <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-ink-muted)]">
          {t('home.preAdoption')}
        </p>
      </div>
    </PageHero>
  );
}

/* ===========================================================================
 * The modules
 * ========================================================================= */

/** A module's frame: its header and its body, labelled by its heading. */
function Module({
  id,
  heading,
  intro,
  action,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly intro?: string;
  readonly action?: { readonly href: string; readonly text: string };
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <SectionHeader
        id={id}
        heading={heading}
        {...(intro === undefined ? {} : { intro })}
        {...(action === undefined ? {} : { action })}
      />
      {children}
    </section>
  );
}

/**
 * The Quran and the Hadith — always present, and peers (INFORMATION_ARCHITECTURE
 * §1.4). Each says, in words, whether its text is available here: an approved
 * corpus, non-authoritative fixture text on a proof deployment, or nothing yet.
 */
async function SourcesModule({ locale }: { readonly locale: Locale }) {
  const [t, all, quran, hadith] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale }),
    quranAvailability(),
    hadithAvailability(),
  ]);

  const status = (availability: { readonly active: boolean; readonly mode?: string }) =>
    !availability.active
      ? t('home.status.unavailable')
      : availability.mode === 'fixture'
        ? t('home.status.fixture')
        : t('home.status.available');

  const quranBody = !quran.active
    ? all('quran.unavailable.body')
    : quran.mode === 'fixture'
      ? all('quran.fixture')
      : all('quran.description');
  const hadithBody = !hadith.active
    ? all('hadith.unavailable.body')
    : hadith.mode === 'fixture'
      ? all('hadith.fixture')
      : all('hadith.description');

  return (
    <Module
      id="home-sources"
      heading={t('home.sources.heading')}
      intro={t('home.sources.intro')}
    >
      <CardGrid columns={2}>
        <LinkCard
          href={pathFor(locale, requireRoute('quran'))}
          eyebrow={status(quran)}
          title={t('nav.quran')}
          description={quranBody}
        />
        <LinkCard
          href={pathFor(locale, requireRoute('hadith'))}
          eyebrow={status(hadith)}
          title={t('nav.hadith')}
          description={hadithBody}
        />
      </CardGrid>
    </Module>
  );
}

/** The other primary domains, each with the description its own landing uses. */
async function AreasModule({ locale }: { readonly locale: Locale }) {
  const [t, all] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale }),
  ]);

  const areas = [
    { key: 'learn', title: t('nav.learn'), body: all('learn.description') },
    { key: 'library', title: t('nav.library'), body: all('library.description') },
    { key: 'watch', title: t('nav.watch'), body: all('watch.description') },
    { key: 'fatwa', title: t('nav.fatwa'), body: all('fatwa.description') },
    { key: 'news-events', title: t('nav.newsEvents'), body: all('news.description') },
    { key: 'global', title: t('nav.global'), body: all('global.intro') },
  ] as const;

  return (
    <Module
      id="home-areas"
      heading={t('home.areas.heading')}
      intro={t('home.areas.intro')}
    >
      <CardGrid>
        {areas.map((area) => (
          <LinkCard
            key={area.key}
            href={pathFor(locale, requireRoute(area.key))}
            title={area.title}
            description={area.body}
          />
        ))}
      </CardGrid>
    </Module>
  );
}

/** The latest NewsArticles — Editorial's own first page, newest first. */
async function NewsModule({ locale }: { readonly locale: Locale }) {
  const page = await editorialReadRuntime().newsList('news-article', 0);
  if (page.items.length === 0) return null;

  const [t, news] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'news' }),
  ]);

  return (
    <Module
      id="home-news"
      heading={news('latest')}
      action={{
        href: pathFor(locale, requireRoute('news-events')),
        text: t('home.links.allNews'),
      }}
    >
      <NewsGrid
        locale={locale}
        items={page.items.slice(0, PREVIEW.news)}
        label={news('latest')}
        showType={false}
        headingLevel="h3"
      />
    </Module>
  );
}

/**
 * Upcoming Events, soonest first; when none is upcoming, the most recent past
 * ones instead — labelled as past, never presented as upcoming.
 */
async function EventsModule({ locale }: { readonly locale: Locale }) {
  const reads = editorialReadRuntime();
  const upcoming = await reads.events({ when: 'upcoming', offset: 0, centreIds: null });
  const when = upcoming.items.length > 0 ? 'upcoming' : 'past';
  const page =
    when === 'upcoming'
      ? upcoming
      : await reads.events({ when: 'past', offset: 0, centreIds: null });
  if (page.items.length === 0) return null;

  const [t, events] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'events' }),
  ]);
  const heading = events(`when.${when}`);

  return (
    <Module
      id="home-events"
      heading={heading}
      action={{
        href: pathFor(locale, requireRoute('events')),
        text: t('home.links.allEvents'),
      }}
    >
      <EventGrid
        locale={locale}
        items={page.items.slice(0, PREVIEW.events)}
        when={when}
        label={heading}
        headingLevel="h3"
      />
    </Module>
  );
}

/** Library's first page of Works and of Magazines, each in its own order. */
async function LibraryModule({ locale }: { readonly locale: Locale }) {
  const reads = libraryReadRuntime();
  const [works, magazines] = await Promise.all([
    reads.works(readLibraryQuery({})),
    reads.scholarlyList('magazine', readScholarlyQuery({})),
  ]);
  const books = works.items.slice(0, PREVIEW.works);
  const periodicals = magazines.items.slice(0, PREVIEW.magazines);
  if (books.length === 0 && periodicals.length === 0) return null;

  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <Module
      id="home-library"
      heading={t('home.library.heading')}
      action={{
        href: pathFor(locale, requireRoute('library')),
        text: t('home.links.library'),
      }}
    >
      <CardGrid>
        {books.map((work) => {
          const label = labelFor(work, locale);
          return (
            <LinkCard
              key={work.id}
              href={workPath(locale, work.slug)}
              eyebrow={t('home.library.book')}
              title={label.title}
              description={label.description}
              lang={label.locale}
              dir={directionOf(label.locale)}
            />
          );
        })}
        {periodicals.map((row) => {
          const label = scholarlyLabel(row, locale);
          return (
            <LinkCard
              key={row.id}
              href={listingHref(locale, row)}
              eyebrow={t('home.library.magazine')}
              title={label.title}
              description={label.summary}
              lang={label.locale}
              dir={directionOf(label.locale)}
            />
          );
        })}
      </CardGrid>
    </Module>
  );
}

/**
 * Watch and Listen, through Media's own bounded previews — each renders
 * nothing when nothing is published, so the pair can be empty, half or whole.
 */
async function WatchModule({ locale }: { readonly locale: Locale }) {
  const [watch, listen] = await Promise.all([
    getTranslations({ locale, namespace: 'watch' }),
    getTranslations({ locale, namespace: 'listen' }),
  ]);

  return (
    <>
      <VideoPreview
        locale={locale}
        filter={{}}
        heading={watch('title')}
        headingId="home-watch"
        more={{ href: pathFor(locale, requireRoute('watch')), text: watch('allVideos') }}
      />
      <AudioPreview
        locale={locale}
        filter={{}}
        heading={listen('title')}
        headingId="home-listen"
        more={{
          href: pathFor(locale, requireRoute('listen.lectures')),
          text: listen('allTracks'),
        }}
      />
    </>
  );
}

/**
 * The latest published rulings — only while the service is activated, and with
 * the fixture notice on a proof deployment, exactly as the Fatwa pages carry it.
 */
async function FatwaModule({ locale }: { readonly locale: Locale }) {
  const availability = await fatwaAvailability();
  if (!availability.active) return null;

  const page = await fatwaReadRuntime().reader.browse({
    sort: 'latest',
    categoryId: null,
    topicId: null,
    offset: 0,
  });
  if (page.items.length === 0) return null;

  const [t, fatwa, categories] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'fatwa' }),
    categoryLabels(locale),
  ]);

  return (
    <Module
      id="home-fatwa"
      heading={fatwa('landing.rulings')}
      action={{
        href: pathFor(locale, requireRoute('fatwa')),
        text: t('home.links.fatwa'),
      }}
    >
      <FatwaFixtureNotice locale={locale} availability={availability} />
      <FatwaList
        locale={locale}
        items={page.items.slice(0, PREVIEW.rulings)}
        categories={categories}
        label={fatwa('landing.rulings')}
        headingLevel="h3"
        t={fatwa}
      />
    </Module>
  );
}

/** Recently published Courses — Learning's own first page. */
async function CoursesModule({ locale }: { readonly locale: Locale }) {
  const page = await learningReadRuntime().courses({});
  if (page.items.length === 0) return null;

  const learn = await getTranslations({ locale, namespace: 'learn' });

  return (
    <Module
      id="home-courses"
      heading={learn('landing.courses')}
      action={{
        href: pathFor(locale, requireRoute('learn.courses')),
        text: learn('landing.allCourses'),
      }}
    >
      <CourseGrid
        locale={locale}
        courses={page.items.slice(0, PREVIEW.courses)}
        label={learn('landing.courses')}
        headingLevel="h3"
      />
    </Module>
  );
}

/** Curated Collections — Editorial's first page, newest publication first. */
async function CollectionsModule({ locale }: { readonly locale: Locale }) {
  const page = await editorialReadRuntime().collections(0);
  if (page.items.length === 0) return null;

  const [t, collections] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'collections' }),
  ]);

  return (
    <Module
      id="home-collections"
      heading={collections('title')}
      intro={collections('description')}
      action={{
        href: pathFor(locale, requireRoute('collections')),
        text: t('home.links.allCollections'),
      }}
    >
      <CardGrid>
        {page.items.slice(0, PREVIEW.collections).map((item) => {
          const translation = translationFor(item, locale);
          return (
            <LinkCard
              key={item.slug}
              href={`/${locale}${collectionPathOf(item.slug)}`}
              title={translation.title}
              description={translation.excerpt}
              lang={translation.languageCode}
              dir={directionOf(translation.languageCode)}
            />
          );
        })}
      </CardGrid>
    </Module>
  );
}

/** The Global Network — shown only once the directory holds a public Centre. */
async function GlobalModule({ locale }: { readonly locale: Locale }) {
  const reads = globalReadRuntime();
  const [hasCentres, countries] = await Promise.all([
    reads.hasPublicCentres(),
    reads.countries(0),
  ]);
  if (!hasCentres || countries.items.length === 0) return null;

  const [t, global] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'global' }),
  ]);

  return (
    <Module
      id="home-global"
      heading={global('title')}
      intro={global('intro')}
      action={{
        href: pathFor(locale, requireRoute('find-a-centre')),
        text: t('nav.findACentre'),
      }}
    >
      <ul
        aria-label={global('sections.countries')}
        className="grid list-none grid-cols-1 gap-x-8 gap-y-1 p-0 min-[30rem]:grid-cols-2 lg:grid-cols-4"
      >
        {countries.items.slice(0, PREVIEW.countries).map((country) => {
          const name = placeName(country, locale);
          return (
            <li key={country.id} className="min-w-0">
              <a
                href={globalPaths.country(locale, country.slug)}
                lang={name.locale}
                dir={directionOf(name.locale)}
                className="inline-flex min-h-11 items-center wrap-anywhere text-[color:var(--color-action)] underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:decoration-[color:var(--color-action)]"
              >
                {name.text}
              </a>
            </li>
          );
        })}
      </ul>
      {countries.hasMore ? (
        <p>
          <a
            href={globalPaths.countries(locale)}
            className="text-sm font-semibold text-[color:var(--color-action)] underline underline-offset-4"
          >
            {global('allCountries')}
          </a>
        </p>
      ) : null}
    </Module>
  );
}

/** The canonical taxonomy's top-level topics, in the taxonomy's own order. */
async function TopicsModule({ locale }: { readonly locale: Locale }) {
  const tree = await taxonomyRuntime().taxonomy.listTree({
    locale,
    includeArchived: false,
  });
  const roots = tree
    .filter((topic) => topic.parentId === null && topic.status === 'active')
    .slice(0, PREVIEW.topics);
  if (roots.length === 0) return null;

  const [t, topics] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'topics' }),
  ]);

  return (
    <Module
      id="home-topics"
      heading={topics('title')}
      intro={topics('description')}
      action={{
        href: pathFor(locale, requireRoute('topics')),
        text: t('home.links.allTopics'),
      }}
    >
      <TopicChips
        label={topics('title')}
        topics={roots.map((topic) => ({
          href: `/${locale}/topics/${encodeURIComponent(topic.slug)}`,
          text: topic.label.name,
          ...(topic.label.resolvedLocale === locale
            ? {}
            : { lang: topic.label.resolvedLocale }),
        }))}
      />
    </Module>
  );
}
