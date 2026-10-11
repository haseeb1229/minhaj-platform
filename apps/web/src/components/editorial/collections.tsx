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
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  TextLink,
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
 * Collection's to state.
 */
function CollectionCard({
  locale,
  item,
  names,
  t,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly item: CollectionSummary;
  readonly names: Names;
  readonly t: CollectionsTranslator;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const translation = translationFor(item, locale);
  const direction = directionOf(translation.languageCode);
  const Heading = headingLevel;
  const topics = item.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  return (
    <Panel as="li">
      <article className="flex min-w-0 flex-col gap-3">
        <Heading
          className="text-lg leading-snug font-semibold break-words"
          lang={translation.languageCode}
          dir={direction}
        >
          <TextLink href={`/${locale}${collectionPathOf(item.slug)}`}>
            {translation.title}
          </TextLink>
        </Heading>
        {translation.excerpt === '' ? null : (
          <p
            className="line-clamp-3 text-sm break-words text-[color:var(--color-foreground-muted)]"
            lang={translation.languageCode}
            dir={direction}
          >
            {translation.excerpt}
          </p>
        )}
        {topics.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2" aria-label={t('topics')}>
            {topics.map((topic) => (
              <li key={topic.slug}>
                <a
                  href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}
                  className="inline-flex min-h-8 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border)] px-2 text-xs"
                >
                  {topic.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>
    </Panel>
  );
}

/** A grid of cards with their topic names resolved once — one call per page. */
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
  const t = await getTranslations({ locale, namespace: 'collections' });
  const names = await referenceNames(
    { personIds: [], topicIds: items.flatMap((item) => item.topicIds) },
    locale,
  );
  return (
    <ul className="grid gap-4 sm:grid-cols-2" aria-label={label}>
      {items.map((item) => (
        <CollectionCard
          key={item.slug}
          locale={locale}
          item={item}
          names={names}
          t={t}
          headingLevel={headingLevel}
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
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: title }]} />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('description')}</p>
        </Prose>

        <section className="flex flex-col gap-4">
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
        </section>
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

/**
 * ONE MEMBER: its type in words, then its owner's title linked to the owner's
 * canonical address. A long title wraps rather than widening the page.
 */
function MemberItem({
  locale,
  kind,
  target,
  t,
}: {
  readonly locale: Locale;
  readonly kind: CollectionMemberKind;
  readonly target: CollectionMemberTarget;
  readonly t: CollectionsTranslator;
}) {
  const title = memberTitle(target, locale);
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-[color:var(--color-border)] pb-3">
      <span className="text-xs font-semibold tracking-wide text-[color:var(--color-action)] uppercase">
        {t(`kinds.${kind}`)}
      </span>
      <span
        className="min-w-0 font-medium wrap-anywhere"
        dir="auto"
        {...(title.languageCode === null ? {} : { lang: title.languageCode })}
      >
        <TextLink href={`/${locale}${collectionMemberPathOf(kind, target.slug)}`}>
          {title.text}
        </TextLink>
      </span>
    </li>
  );
}

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
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.collections, { text: translation.title }]}
        />

        <Prose>
          <p>
            <span className="text-xs font-semibold tracking-wide text-[color:var(--color-action)] uppercase">
              {t('type')}
            </span>
          </p>
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
            <h1 className="text-3xl leading-tight font-semibold tracking-tight break-words">
              {translation.title}
            </h1>
            {translation.excerpt === '' ? null : (
              <p className="text-lg break-words text-[color:var(--color-foreground-muted)]">
                {translation.excerpt}
              </p>
            )}
          </div>
        </Prose>

        <Prose>
          <div
            className="editorial-prose"
            lang={translation.languageCode}
            dir={direction}
            dangerouslySetInnerHTML={{ __html: translation.html }}
          />
        </Prose>

        <section className="flex flex-col gap-4" aria-labelledby="collection-items">
          <h2 id="collection-items" className="text-xl font-semibold">
            {t('itemsHeading')}
          </h2>
          {resolved.unavailable.size === 0 ? null : (
            <Alert tone="info">{t('itemsUnavailable')}</Alert>
          )}
          {available.length === 0 ? (
            resolved.unavailable.size === 0 ? (
              <EmptyState>{t('itemsNone')}</EmptyState>
            ) : null
          ) : (
            <ol className="flex flex-col gap-3">
              {available.map(({ kind, target }) => (
                <MemberItem
                  key={memberToken({ kind, id: target.id })}
                  locale={locale}
                  kind={kind}
                  target={target}
                  t={t}
                />
              ))}
            </ol>
          )}
        </section>

        {credits.length === 0 && topics.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="collection-facts">
            <h2 id="collection-facts" className="text-lg font-semibold">
              {t('facts')}
            </h2>
            <dl className="grid gap-x-8 sm:grid-cols-2">
              {credits.length === 0 ? null : (
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
              )}
              {topics.length === 0 ? null : (
                <DetailRow term={t('topics')}>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {topics.map((topic) => (
                      <li key={topic.slug}>
                        <TextLink
                          href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}
                        >
                          {topic.name}
                        </TextLink>
                      </li>
                    ))}
                  </ul>
                </DetailRow>
              )}
            </dl>
          </section>
        )}

        <p>
          <TextLink href={`/${locale}/collections`}>{t('all')}</TextLink>
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
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {heading}
      </h2>
      <CollectionGrid
        locale={locale}
        items={page.items}
        label={heading}
        headingLevel="h3"
      />
      <p>
        <TextLink href={`/${locale}/collections`}>{t('all')}</TextLink>
      </p>
    </section>
  );
}
