import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { cache } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  COLLECTION_PAGE,
  collectionMemberPathOf,
  collectionPathOf,
  isEditorialMemberKind,
  leadImagePath,
  memberToken,
  type CollectionMemberKind,
  type CollectionMemberTarget,
  type CollectionSummary,
  type PublicCollection,
  type PublicLeadImage,
} from '@minhaj/contracts/editorial';

import { resolveCollectionMembers } from '@/composition/collection-members';
import { editorialReadRuntime } from '@/composition/editorial-read';
import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import {
  collectionOrderPath,
  collectionsPath,
  memberTitle,
  memberYear,
  orderMembers,
  readCollectionOffset,
  readCollectionOrder,
  type CollectionOrder,
} from '@/components/editorial/collection-presentation';
import { translationFor } from '@/components/editorial/presentation';
import { RecordSection } from '@/components/editorial/frame';
import { leadCardImage } from '@/components/editorial/lead-image';
import { BreadcrumbData } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  FilterLink,
  Icon,
  LanguageBadge,
  ListRow,
  MediaCard,
  MetaRow,
  PageHeading,
  Pager,
  ResponsiveImage,
  SectionHeader,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf, isSupportedLocale } from '@/config/locale';

/**
 * The public Collection surfaces — `/collections`, a Collection and the topic
 * hub's Collections (ROUTE_MAP.md §3.8). Phase 15; redesigned in R2.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through the
 * public composition roots of Editorial, Library, Media, People and Taxonomy —
 * no session, no identity service, no cookie — so a signed-in visitor and an
 * anonymous one receive the same page (ARCHITECTURE.md §8.1).
 *
 * LAYER-4 COMPOSITION, NEVER A JOIN. A Collection names its members by typed
 * identifier. What a visitor sees of a member is what its OWNER says is public
 * NOW — Editorial for Articles and News, Library for Works, Media for Videos —
 * asked once per owner for the whole page. A withdrawn member is simply not
 * shown: no title, picture or address of it reaches the page, and the rest
 * keep their curated order. A failed owner read degrades that owner's members
 * in words and never takes the Collection down or reveals anything unpublished.
 *
 * IMAGE-LED, NOTHING INVENTED (R2, audit F51). A Collection has no picture of
 * its own, so it is shown through its members' OWN first-party lead images: a
 * card takes the first of its leading members that has one, and a Collection's
 * page opens with a mosaic of them. A Collection whose members have none is
 * set as text — never a placeholder.
 */

type CollectionsTranslator = Awaited<ReturnType<typeof getTranslations<'collections'>>>;
type NewsTranslator = Awaited<ReturnType<typeof getTranslations<'news'>>>;
type Query = Record<string, string | string[] | undefined>;

/** Reads one published Collection once per request, for metadata and body alike. */
export const readCollection = cache((slug: string) =>
  editorialReadRuntime().collection(slug),
);

async function collectionsTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'collections' });
  return {
    label: shell('nav.breadcrumbs'),
    homeText: shell('nav.home'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    collections: { href: localizedPath(locale, '/collections'), text: t('title') },
  };
}

/** A member title's language, said in words when it is not the interface's. */
function languageOf(code: string | null, locale: Locale, news: NewsTranslator) {
  return code === null || code === locale || !isSupportedLocale(code)
    ? undefined
    : { label: news(`languages.${code}`), code };
}

/* ===========================================================================
 * Cards
 * ========================================================================= */

/**
 * Each card's cover: the first of its leading members, in the curated order,
 * whose owner shows a lead image now. Editorial's members only — Library and
 * Media are not asked for pictures here — in ONE bounded owner read for the
 * whole page.
 */
async function coversFor(
  items: readonly CollectionSummary[],
): Promise<ReadonlyMap<string, PublicLeadImage>> {
  const members = items.flatMap((item) =>
    (item.leadMembers ?? []).filter((member) => isEditorialMemberKind(member.kind)),
  );
  if (members.length === 0) return new Map();
  let targets: ReadonlyMap<string, CollectionMemberTarget>;
  try {
    targets = await editorialReadRuntime().memberTargets(members);
  } catch {
    // A cover is presentation: without it the card is set as text.
    return new Map();
  }
  const covers = new Map<string, PublicLeadImage>();
  for (const item of items)
    for (const member of item.leadMembers ?? []) {
      const image = targets.get(memberToken(member))?.leadImage ?? null;
      if (image !== null) {
        covers.set(item.slug, image);
        break;
      }
    }
  return covers;
}

/**
 * A grid of image-led cards: each Collection's cover (when a member gives it
 * one), its title in its own language and its own summary. The title is the
 * card's one link.
 */
async function CollectionGrid({
  locale,
  items,
  label,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly items: readonly CollectionSummary[];
  readonly label: string;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const news = await getTranslations({ locale, namespace: 'news' });
  const covers = await coversFor(items);
  return (
    <ul
      className="grid list-none grid-cols-1 gap-x-6 gap-y-10 p-0 sm:grid-cols-2 lg:grid-cols-3"
      aria-label={label}
    >
      {items.map((item) => {
        const translation = translationFor(item, locale);
        const cover = covers.get(item.slug);
        const language = languageOf(translation.languageCode, locale, news);
        return (
          <MediaCard
            key={item.slug}
            href={localizedPath(locale, collectionPathOf(item.slug))}
            title={translation.title}
            description={translation.excerpt}
            lang={translation.languageCode}
            dir={directionOf(translation.languageCode)}
            headingLevel={headingLevel}
            aspect="wide"
            sizes="(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw"
            image={cover === undefined ? null : leadCardImage(cover, '')}
            {...(language === undefined ? {} : { language })}
          />
        );
      })}
    </ul>
  );
}

/* ===========================================================================
 * /collections
 * ========================================================================= */

/**
 * `/collections` — every published Collection, newest publication first, twenty
 * to a page with `?offset=`. The order is Editorial's, with a deterministic
 * tie-breaker, so a page is the same page on every request. Every offset is
 * canonical to `/collections`.
 */
export async function CollectionsPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'collections' });
  const trail = await collectionsTrail(locale);
  const offset = readCollectionOffset(query);
  const page = await editorialReadRuntime().collections(offset);
  const title = t('title');

  return (
    <Container>
      <div className="flex flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: title }]} />
        <div className="flex max-w-3xl flex-col gap-3">
          <PageHeading>{title}</PageHeading>
          <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
            {t('description')}
          </p>
        </div>
        {page.items.length === 0 ? (
          offset > 0 ? (
            <EmptyState action={{ href: collectionsPath(locale), text: t('firstPage') }}>
              {t('pageEmpty')}
            </EmptyState>
          ) : (
            <EmptyState icon="grid">{t('empty')}</EmptyState>
          )
        ) : (
          <CollectionGrid
            locale={locale}
            items={page.items}
            label={title}
            headingLevel="h2"
          />
        )}
        <Pager
          label={title}
          previous={
            offset > 0
              ? collectionsPath(locale, Math.max(0, offset - COLLECTION_PAGE))
              : null
          }
          next={page.more ? collectionsPath(locale, offset + COLLECTION_PAGE) : null}
          previousLabel={t('previous')}
          nextLabel={t('next')}
        />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /collections/{slug}
 * ========================================================================= */

/** The locales the Collection genuinely exists in — never widened by a fallback. */
export function collectionLocales(record: PublicCollection): Locale[] {
  return record.translations.map((row) => row.languageCode);
}

interface Member {
  readonly kind: CollectionMemberKind;
  readonly target: CollectionMemberTarget;
}

/** One mosaic picture: Editorial's own first-party address and the measured box. */
function mosaicPicture(image: PublicLeadImage) {
  return {
    path: leadImagePath(image),
    alt: '',
    width: image.width,
    height: image.height,
  };
}

/** How many member pictures the opening mosaic shows: one, two, three or five. */
function mosaicCount(available: number): number {
  return available >= 5 ? 5 : available >= 3 ? 3 : available;
}

/**
 * THE OPENING MOSAIC: the members' own lead images, in the curated order — a
 * large picture with two or four beside it from a tablet up, the large one
 * alone on a phone. Decorative: every picture belongs to a member listed, and
 * named, below.
 */
function CoverMosaic({ images }: { readonly images: readonly PublicLeadImage[] }) {
  const count = mosaicCount(images.length);
  if (count === 0) return null;
  const shown = images.slice(0, count);
  const [first] = shown;
  if (first === undefined) return null;
  if (count === 1)
    return (
      <ResponsiveImage
        {...mosaicPicture(first)}
        aspect="16/9"
        radius="panel"
        priority
        sizes="(min-width: 72rem) 72rem, 100vw"
        className="md:aspect-[21/9]"
      />
    );
  if (count === 2)
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((image, index) => (
          <ResponsiveImage
            key={image.recordId}
            {...mosaicPicture(image)}
            aspect="3/2"
            radius="panel"
            priority={index === 0}
            sizes="(min-width: 40rem) 50vw, 100vw"
            className={index === 0 ? '' : 'max-sm:hidden'}
          />
        ))}
      </div>
    );
  return (
    <div
      className={`grid grid-cols-1 gap-2 ${count === 5 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}
    >
      {shown.map((image, index) => (
        <div
          key={image.recordId}
          className={index === 0 ? 'sm:col-span-2 sm:row-span-2' : 'max-sm:hidden'}
        >
          <ResponsiveImage
            {...mosaicPicture(image)}
            aspect="3/2"
            radius="panel"
            priority={index === 0}
            sizes={index === 0 ? '(min-width: 40rem) 50vw, 100vw' : '25vw'}
            className={index === 0 ? 'sm:aspect-auto sm:h-full' : ''}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * ONE MEMBER, AS A ROW: its own lead image where its owner shows one, its type
 * in words, its owner's title as the row's one link to the owner's canonical
 * address, and its date where its owner states one. The list's order is the
 * reading order, so no number is drawn beside it.
 */
function MemberRow({
  locale,
  member,
  t,
  news,
}: {
  readonly locale: Locale;
  readonly member: Member;
  readonly t: CollectionsTranslator;
  readonly news: NewsTranslator;
}) {
  const { kind, target } = member;
  const title = memberTitle(target, locale);
  const language = languageOf(title.languageCode, locale, news);
  const image = target.leadImage ?? null;
  const date = target.chronologyAt ?? null;
  const lang =
    title.languageCode !== null && isSupportedLocale(title.languageCode)
      ? title.languageCode
      : null;
  return (
    <ListRow
      href={localizedPath(locale, collectionMemberPathOf(kind, target.slug))}
      title={title.text}
      type={t(`kinds.${kind}`)}
      image={image === null ? null : leadCardImage(image, '')}
      {...(lang === null ? {} : { lang, dir: directionOf(lang) })}
      {...(language === undefined ? {} : { language })}
      {...(date === null
        ? {}
        : {
            meta: [
              <time key="date" dateTime={date.toISOString().slice(0, 10)}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'long',
                  timeZone: 'UTC',
                }).format(date)}
              </time>,
            ],
          })}
    />
  );
}

/** The members grouped by the UTC year of their date, for a date order. */
function byYear(members: readonly Member[]) {
  const groups: { year: number | null; members: Member[] }[] = [];
  for (const member of members) {
    const year = memberYear(member.target);
    const last = groups.at(-1);
    if (last !== undefined && last.year === year) last.members.push(member);
    else groups.push({ year, members: [member] });
  }
  return groups;
}

/**
 * A Collection's page: its title and standfirst, a mosaic of its members'
 * pictures, the editor's introduction at a reading measure, then its members
 * — in the curated order by default, or by date (`?order=newest|oldest`,
 * grouped by year) — then who made it and what it is about.
 */
export async function CollectionDetailPage({
  locale,
  record,
  query = {},
}: {
  readonly locale: Locale;
  readonly record: PublicCollection;
  readonly query?: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'collections' });
  const news = await getTranslations({ locale, namespace: 'news' });
  const editorial = await getTranslations({ locale, namespace: 'editorial' });
  const trail = await collectionsTrail(locale);
  const translation = translationFor(record, locale);
  const direction = directionOf(translation.languageCode);
  const order = readCollectionOrder(query);
  const [names, languages, resolved] = await Promise.all([
    referenceNames(
      {
        personIds: record.contributors.map((c) => c.personId),
        topicIds: record.topicIds,
      },
      locale,
    ),
    translation.languageCode === locale
      ? Promise.resolve(new Map<string, ContentLanguage>())
      : contentLanguages(),
    // Every member, once, batched by owner — public records only.
    resolveCollectionMembers(record.members),
  ]);
  // The curated order, kept; a member its owner does not publish now — or
  // whose owner could not be asked — is left out, title and address alike.
  const available: Member[] = record.members.flatMap((member) => {
    const target = resolved.targets.get(memberToken(member));
    return target === undefined ? [] : [{ kind: member.kind, target }];
  });
  const dated = available.filter(
    (member) => (member.target.chronologyAt ?? null) !== null,
  ).length;
  const ordered = orderMembers(available, dated >= 2 ? order : 'curated');
  const shownOrder: CollectionOrder = dated >= 2 ? order : 'curated';
  // Each picture once, in the curated order: two members may share one image.
  const pictures = [
    ...new Map(
      available.flatMap((member) => {
        const image = member.target.leadImage ?? null;
        return image === null ? [] : [[image.assetId, image] as const];
      }),
    ).values(),
  ];
  const credits = record.contributors.flatMap((credit) => {
    const person = names.people.get(credit.personId);
    return person === undefined ? [] : [{ person, role: credit.role }];
  });
  const topics = record.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  const contentLocales = collectionLocales(record);

  return (
    <Container>
      <article className="flex flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.collections, { text: translation.title }]}
        />

        <header className="flex max-w-3xl flex-col gap-4">
          {translation.languageCode === locale ? null : (
            <p className="flex flex-wrap items-center gap-2">
              <LanguageBadge
                label={news(`languages.${translation.languageCode}`)}
                code={translation.languageCode}
              />
            </p>
          )}
          <div
            className="flex flex-col gap-4"
            lang={translation.languageCode}
            dir={direction}
          >
            <h1 className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
              {translation.title}
            </h1>
            {translation.excerpt === '' ? null : (
              <p className="reading-face text-lede max-w-[var(--measure-prose)] wrap-anywhere text-foreground-muted">
                {translation.excerpt}
              </p>
            )}
          </div>
          {translation.languageCode === locale ? null : (
            <p
              role="status"
              className="flex items-start gap-2 text-sm text-foreground-muted"
            >
              <Icon name="globe" size={16} className="mt-1 shrink-0" />
              <span>
                {t('fallback', {
                  language:
                    languages.get(translation.languageCode)?.name ??
                    translation.languageCode,
                })}
              </span>
            </p>
          )}
          {available.length === 0 ? null : (
            <MetaRow items={[t('itemCount', { count: available.length })]} />
          )}
        </header>

        <CoverMosaic images={pictures} />

        <div
          className="editorial-prose long-form"
          lang={translation.languageCode}
          dir={direction}
          dangerouslySetInnerHTML={{ __html: translation.html }}
        />

        <section
          className="flex max-w-4xl flex-col gap-5"
          aria-labelledby="collection-items"
        >
          <SectionHeader id="collection-items" heading={t('itemsHeading')} />
          {dated >= 2 ? (
            <nav aria-label={t('orderLabel')}>
              <ul className="flex list-none flex-wrap gap-2 p-0">
                {(['curated', 'newest', 'oldest'] as const).map((choice) => (
                  <li key={choice}>
                    <FilterLink
                      href={collectionOrderPath(locale, record.slug, choice)}
                      current={shownOrder === choice}
                    >
                      {t(`order.${choice}`)}
                    </FilterLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {resolved.unavailable.size === 0 ? null : (
            <Alert tone="info">{t('itemsUnavailable')}</Alert>
          )}
          {ordered.length === 0 ? (
            resolved.unavailable.size === 0 ? (
              <EmptyState>{t('itemsNone')}</EmptyState>
            ) : null
          ) : shownOrder === 'curated' ? (
            <ol className="flex list-none flex-col border-t border-border p-0">
              {ordered.map((member) => (
                <MemberRow
                  key={memberToken({ kind: member.kind, id: member.target.id })}
                  locale={locale}
                  member={member}
                  t={t}
                  news={news}
                />
              ))}
            </ol>
          ) : (
            <div className="flex flex-col gap-8">
              {byYear(ordered).map((group) => (
                <section
                  key={group.year ?? 'undated'}
                  aria-labelledby={`collection-year-${String(group.year ?? 'undated')}`}
                  className="flex flex-col gap-2"
                >
                  <h3
                    id={`collection-year-${String(group.year ?? 'undated')}`}
                    className="text-subheading font-semibold tabular-nums"
                  >
                    {group.year === null
                      ? t('undated')
                      : new Intl.DateTimeFormat(locale, {
                          year: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(Date.UTC(group.year, 0, 1)))}
                  </h3>
                  <ol className="flex list-none flex-col border-t border-border p-0">
                    {group.members.map((member) => (
                      <MemberRow
                        key={memberToken({ kind: member.kind, id: member.target.id })}
                        locale={locale}
                        member={member}
                        t={t}
                        news={news}
                      />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </section>

        {credits.length === 0 && topics.length === 0 ? null : (
          <div className="max-w-3xl">
            <RecordSection id="collection-facts" heading={t('facts')}>
              {topics.length === 0 ? null : (
                <TopicChips
                  label={t('topics')}
                  topics={topics.map((topic) => ({
                    href: localizedPath(
                      locale,
                      `/topics/${encodeURIComponent(topic.slug)}`,
                    ),
                    text: topic.name,
                  }))}
                />
              )}
              {credits.length === 0 ? null : (
                <dl className="flex flex-col">
                  <DetailRow term={t('contributors')}>
                    <ul className="flex flex-col gap-1">
                      {credits.map(({ person, role }) => (
                        <li key={`${person.slug}:${role}`} dir="auto">
                          <TextLink
                            href={localizedPath(
                              locale,
                              `/people/${encodeURIComponent(person.slug)}`,
                            )}
                          >
                            {person.name}
                          </TextLink>{' '}
                          — {editorial(role as 'speaker')}
                        </li>
                      ))}
                    </ul>
                  </DetailRow>
                </dl>
              )}
            </RecordSection>
          </div>
        )}

        <p>
          <TextLink href={localizedPath(locale, '/collections')}>{t('all')}</TextLink>
        </p>

        <BreadcrumbData
          contentLocales={contentLocales}
          trail={[
            { name: trail.homeText, path: localizedPath(translation.languageCode, '') },
            {
              name: t('title'),
              path: localizedPath(translation.languageCode, '/collections'),
            },
            {
              name: translation.title,
              path: localizedPath(
                translation.languageCode,
                collectionPathOf(record.slug),
              ),
            },
          ]}
        />
      </article>
    </Container>
  );
}

/* ===========================================================================
 * The topic hub's Collections section
 * ========================================================================= */

/**
 * PHASE 15 — the most recently published Collections on a topic, a bounded
 * preview from Editorial's own public read and never from the search index,
 * with a link to every Collection; nothing at all when the topic has none.
 */
export async function CollectionTopicSection({
  locale,
  topicId,
  heading,
  headingId,
}: {
  readonly locale: Locale;
  readonly topicId: string;
  readonly heading: string;
  readonly headingId: string;
}) {
  const page = await editorialReadRuntime().collectionsOnTopic(topicId);
  if (page.items.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'collections' });
  return (
    <section className="flex flex-col gap-5" aria-labelledby={headingId}>
      <SectionHeader
        id={headingId}
        heading={heading}
        action={{ href: localizedPath(locale, '/collections'), text: t('all') }}
      />
      <CollectionGrid
        locale={locale}
        items={page.items}
        label={heading}
        headingLevel="h3"
      />
    </section>
  );
}
