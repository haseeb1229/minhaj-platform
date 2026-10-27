import 'server-only';

import { cache } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  COLLECTION_PAGE,
  collectionMemberPathOf,
  collectionPathOf,
  memberToken,
  type CollectionMemberKind,
  type CollectionMemberTarget,
  type CollectionSummary,
  type PublicCollection,
} from '@minhaj/contracts/editorial';

import { resolveCollectionMembers } from '@/composition/collection-members';
import { editorialReadRuntime } from '@/composition/editorial-read';
import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import {
  collectionsPath,
  memberTitle,
  readCollectionOffset,
} from '@/components/editorial/collection-presentation';
import { translationFor } from '@/components/editorial/presentation';
import {
  CARD_RAISED,
  CARD_SURFACE,
  CARD_TITLE_LINK,
  Eyebrow,
  LandingFrame,
  RecordSection,
} from '@/components/editorial/frame';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  MetaRow,
  Prose,
  SectionHeader,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf } from '@/config/locale';

/**
 * The public Collection surfaces — `/collections`, a Collection and the topic
 * hub's Collections (ROUTE_MAP.md §3.8). Phase 15.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through the
 * public composition roots of Editorial, Library, Media, People and Taxonomy —
 * no session, no identity service, no cookie — so a signed-in visitor and an
 * anonymous one receive the same page (ARCHITECTURE.md §8.1).
 *
 * LAYER-4 COMPOSITION, NEVER A JOIN. A Collection names its members by typed
 * identifier. What a visitor sees of a member is what its OWNER says is public
 * NOW — Editorial for Articles and News, Library for Works, Media for Videos —
 * asked once per owner for the whole Collection. A withdrawn member is simply
 * not shown: no title and no address of it reaches the page, and the rest keep
 * their curated order. A failed owner read degrades that owner's members in
 * words and never takes the Collection down or reveals anything unpublished.
 *
 * NOTHING INVENTED. A card shows what the Collection itself owns — its title,
 * summary and topics — with no picture and no member count; a member is its
 * type and its owner's title, linked to the owner's canonical address.
 */

type CollectionsTranslator = Awaited<ReturnType<typeof getTranslations<'collections'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;
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
    home: { href: `/${locale}`, text: shell('nav.home') },
    collections: { href: `/${locale}/collections`, text: t('title') },
  };
}

/* ===========================================================================
 * Cards
 * ========================================================================= */

/**
 * ONE CARD: the Collection's title in its own language and direction, its own
 * summary and its topics. No picture and no count — neither is the
 * Collection's to state. The title is the card's one stretched link; the
 * topics sit above it as links of their own. A `feature` card — the newest
 * Collection, opening the first page — is the same record set larger.
 */
function CollectionCard({
  locale,
  item,
  names,
  t,
  headingLevel,
  feature,
}: {
  readonly locale: Locale;
  readonly item: CollectionSummary;
  readonly names: Names;
  readonly t: CollectionsTranslator;
  readonly headingLevel: 'h2' | 'h3';
  readonly feature: boolean;
}) {
  const translation = translationFor(item, locale);
  const direction = directionOf(translation.languageCode);
  const Heading = headingLevel;
  const topics = item.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  return (
    <li
      className={`${CARD_SURFACE} border-t-4 border-t-[color:var(--color-accent-rule)] ${
        feature ? 'gap-4 sm:col-span-2 sm:p-7' : ''
      }`}
    >
      <article className="flex min-w-0 flex-1 flex-col gap-3">
        <Eyebrow>{t('type')}</Eyebrow>
        <Heading
          className={`${
            feature ? 'text-heading' : 'text-subheading'
          } leading-snug font-semibold text-balance wrap-anywhere`}
          lang={translation.languageCode}
          dir={direction}
        >
          <a
            href={`/${locale}${collectionPathOf(item.slug)}`}
            className={CARD_TITLE_LINK}
          >
            {translation.title}
          </a>
        </Heading>
        {translation.excerpt === '' ? null : (
          <p
            className={`wrap-anywhere text-[color:var(--color-foreground-muted)] ${
              feature ? 'text-lede line-clamp-4' : 'line-clamp-3 text-sm'
            }`}
            lang={translation.languageCode}
            dir={direction}
          >
            {translation.excerpt}
          </p>
        )}
        {topics.length === 0 ? null : (
          <div className={`${CARD_RAISED} mt-auto pt-1`}>
            <TopicChips
              label={t('topics')}
              topics={topics.map((topic) => ({
                href: `/${locale}/topics/${encodeURIComponent(topic.slug)}`,
                text: topic.name,
              }))}
            />
          </div>
        )}
      </article>
    </li>
  );
}

/** A grid of cards with their topic names resolved once — one call per page. */
async function CollectionGrid({
  locale,
  items,
  label,
  headingLevel,
  feature = false,
}: {
  readonly locale: Locale;
  readonly items: readonly CollectionSummary[];
  readonly label: string;
  readonly headingLevel: 'h2' | 'h3';
  /** Open with the first card set larger — the first page of `/collections`. */
  readonly feature?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'collections' });
  const names = await referenceNames(
    { personIds: [], topicIds: items.flatMap((item) => item.topicIds) },
    locale,
  );
  return (
    <ul
      className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3"
      aria-label={label}
    >
      {items.map((item, index) => (
        <CollectionCard
          key={item.slug}
          locale={locale}
          item={item}
          names={names}
          t={t}
          headingLevel={headingLevel}
          feature={feature && index === 0 && items.length > 1}
        />
      ))}
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
 * canonical to `/collections`. The newest opens the first page set larger — a
 * position earned by date alone, never a "featured" claim.
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
    <>
      <LandingFrame
        trailLabel={trail.label}
        trail={[trail.home, { text: title }]}
        title={title}
        lede={t('description')}
      >
        <MetaRow items={KIND_ORDER.map((kind) => t(`kindsPlural.${kind}`))} />
      </LandingFrame>

      <Container>
        <div className="flex flex-col gap-6 py-[var(--space-page)]">
          {page.items.length === 0 ? (
            <EmptyState>
              {offset > 0 ? (
                <span className="flex flex-col gap-2">
                  <span>{t('pageEmpty')}</span>
                  <TextLink href={collectionsPath(locale)}>{t('firstPage')}</TextLink>
                </span>
              ) : (
                t('empty')
              )}
            </EmptyState>
          ) : (
            <CollectionGrid
              locale={locale}
              items={page.items}
              label={title}
              headingLevel="h2"
              feature={offset === 0}
            />
          )}
          <Pagination
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
    </>
  );
}

/** The kinds of record a Collection can gather, in the order the hero names them. */
const KIND_ORDER = ['article', 'news', 'work', 'video'] as const;

/* ===========================================================================
 * /collections/{slug}
 * ========================================================================= */

/** The locales the Collection genuinely exists in — never widened by a fallback. */
export function collectionLocales(record: PublicCollection): Locale[] {
  return record.translations.map((row) => row.languageCode);
}

/**
 * ONE MEMBER, AS A STEP IN THE SEQUENCE: its position (decorative — the
 * ordered list already announces it), its type in words, then its owner's
 * title as the card's one stretched link to the owner's canonical address. A
 * long title wraps rather than widening the page.
 */
function MemberItem({
  locale,
  kind,
  target,
  position,
  t,
}: {
  readonly locale: Locale;
  readonly kind: CollectionMemberKind;
  readonly target: CollectionMemberTarget;
  readonly position: number;
  readonly t: CollectionsTranslator;
}) {
  const title = memberTitle(target, locale);
  return (
    <li className={CARD_SURFACE}>
      <div className="flex min-w-0 items-start gap-4">
        <span
          aria-hidden="true"
          className="text-heading w-10 shrink-0 leading-none font-semibold text-[color:var(--color-accent)] tabular-nums"
        >
          {new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(position)}
        </span>
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-foreground-muted)] uppercase">
            {t(`kinds.${kind}`)}
          </span>
          <span
            className="text-subheading min-w-0 font-semibold wrap-anywhere"
            dir="auto"
            {...(title.languageCode === null ? {} : { lang: title.languageCode })}
          >
            <a
              href={`/${locale}${collectionMemberPathOf(kind, target.slug)}`}
              className={CARD_TITLE_LINK}
            >
              {title.text}
            </a>
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * A Collection's page reads as a curated sequence: its title and standfirst,
 * the editor's introduction at a reading measure, then its members as numbered
 * steps in the saved order, then who made it and what it is about.
 */
export async function CollectionDetailPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: PublicCollection;
}) {
  const t = await getTranslations({ locale, namespace: 'collections' });
  const editorial = await getTranslations({ locale, namespace: 'editorial' });
  const trail = await collectionsTrail(locale);
  const translation = translationFor(record, locale);
  const direction = directionOf(translation.languageCode);
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
  const available = record.members.flatMap((member) => {
    const target = resolved.targets.get(memberToken(member));
    return target === undefined ? [] : [{ kind: member.kind, target }];
  });
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
      <article className="flex flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.collections, { text: translation.title }]}
        />

        <header className="flex max-w-3xl flex-col gap-4 border-b border-[color:var(--color-border)] pb-8">
          <Eyebrow>{t('type')}</Eyebrow>
          {translation.languageCode === locale ? null : (
            <Alert tone="info">
              {t('fallback', {
                language:
                  languages.get(translation.languageCode)?.name ??
                  translation.languageCode,
              })}
            </Alert>
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
              <p className="text-lede max-w-[var(--measure-prose)] wrap-anywhere text-[color:var(--color-foreground-muted)]">
                {translation.excerpt}
              </p>
            )}
          </div>
        </header>

        <Prose>
          <div
            className="editorial-prose"
            lang={translation.languageCode}
            dir={direction}
            dangerouslySetInnerHTML={{ __html: translation.html }}
          />
        </Prose>

        <section
          className="flex max-w-3xl flex-col gap-5"
          aria-labelledby="collection-items"
        >
          <SectionHeader id="collection-items" heading={t('itemsHeading')} />
          {resolved.unavailable.size === 0 ? null : (
            <Alert tone="info">{t('itemsUnavailable')}</Alert>
          )}
          {available.length === 0 ? (
            resolved.unavailable.size === 0 ? (
              <EmptyState>{t('itemsNone')}</EmptyState>
            ) : null
          ) : (
            <ol className="flex list-none flex-col gap-3 p-0">
              {available.map(({ kind, target }, index) => (
                <MemberItem
                  key={memberToken({ kind, id: target.id })}
                  locale={locale}
                  kind={kind}
                  target={target}
                  position={index + 1}
                  t={t}
                />
              ))}
            </ol>
          )}
        </section>

        {credits.length === 0 && topics.length === 0 ? null : (
          <div className="max-w-3xl">
            <RecordSection id="collection-facts" heading={t('facts')}>
              {credits.length === 0 ? null : (
                <dl className="flex flex-col">
                  <DetailRow term={t('contributors')}>
                    <ul className="flex flex-col gap-1">
                      {credits.map(({ person, role }) => (
                        <li key={`${person.slug}:${role}`} dir="auto">
                          <TextLink
                            href={`/${locale}/people/${encodeURIComponent(person.slug)}`}
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
              {topics.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[color:var(--color-foreground-muted)]">
                    {t('topics')}
                  </p>
                  <TopicChips
                    label={t('topics')}
                    topics={topics.map((topic) => ({
                      href: `/${locale}/topics/${encodeURIComponent(topic.slug)}`,
                      text: topic.name,
                    }))}
                  />
                </div>
              )}
            </RecordSection>
          </div>
        )}

        <p>
          <ActionLink href={`/${locale}/collections`} tone="secondary">
            {t('all')}
          </ActionLink>
        </p>

        <BreadcrumbData
          contentLocales={contentLocales}
          trail={[
            { name: trail.homeText, path: `/${translation.languageCode}` },
            { name: t('title'), path: `/${translation.languageCode}/collections` },
            {
              name: translation.title,
              path: `/${translation.languageCode}${collectionPathOf(record.slug)}`,
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
        action={{ href: `/${locale}/collections`, text: t('all') }}
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
