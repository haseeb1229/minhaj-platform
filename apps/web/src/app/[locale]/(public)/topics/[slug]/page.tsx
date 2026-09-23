import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { TopicView } from '@minhaj/contracts/taxonomy';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import { libraryReadRuntime } from '@/composition/library-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { labelFor, workPath } from '@/components/library/presentation';
import {
  Alert,
  Breadcrumbs,
  Button,
  Container,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextInput,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { topicBreadcrumb } from '@/contexts/taxonomy';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/topics/{slug}` — the canonical topic hub (ROUTE_MAP.md §3.1).
 *
 * DELIVERED BY PHASE 17, MINIMALLY AND HONESTLY. Topic search results must be
 * "navigable results into `/topics/{slug}`" (DELIVERY_PLAN.md Phase 17), and no
 * earlier phase delivered the route. It is Layer-4 composition over owners that
 * EXIST: Taxonomy for the topic and its place in the hierarchy, Library for the
 * books classified under it, and Search for everything else classified under
 * it. Each later domain adds its own section when it ships; nothing here renders
 * an empty frame for a domain that has not (ROUTE_MAP.md §5.2).
 *
 * TAXONOMY OWNS THE TOPIC. This page decides nothing about it: an archived topic
 * is a 404, and the slug is immutable, so there is no history to redirect.
 *
 * SIGNED OUT, DYNAMIC. The hub reads mutable published data through public
 * readers only, and a cached copy would keep offering books since withdrawn.
 */
export const dynamic = 'force-dynamic';

interface TopicParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

async function loadTopic(locale: Locale, slug: string): Promise<TopicView | null> {
  if (!topicSlugSchema.safeParse(slug).success) return null;
  const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({ slug, locale });
  return topic !== null && topic.status === 'active' ? topic : null;
}

export async function generateMetadata({ params }: TopicParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const topic = await loadTopic(locale, slug);
  if (topic === null) return {};

  return contentMetadata({
    locale,
    contentLocales: topic.translatedLocales,
    primaryLocale: 'en',
    pathFor: (target) => `/${target}/topics/${encodeURIComponent(topic.slug)}`,
    title: topic.label.name,
    ...(topic.label.description === null
      ? {}
      : { description: topic.label.description.slice(0, 160) }),
  });
}

/** How many books the hub previews before linking to the full filtered list. */
const BOOK_PREVIEW = 6;

export default async function TopicPage({ params }: TopicParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;

  const topic = await loadTopic(locale, slug);
  if (topic === null) notFound();

  const t = await getTranslations({ locale, namespace: 'topics' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const [tree, books] = await Promise.all([
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    libraryReadRuntime().works({ topic: topic.id }),
  ]);

  const ancestors = topicBreadcrumb(topic, tree);
  const children = tree.filter((entry) => entry.parentId === topic.id);
  const labelLocale = topic.label.resolvedLocale;
  const labelDirection = directionOf(labelLocale);

  return (
    <Container>
      <div className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { href: `/${locale}/topics`, text: t('title') },
            ...ancestors.map((ancestor) => ({
              href: `/${locale}/topics/${encodeURIComponent(ancestor.slug)}`,
              text: ancestor.label.name,
            })),
            { text: topic.label.name },
          ]}
        />

        <Prose>
          <PageHeading>
            <span lang={labelLocale} dir={labelDirection}>
              {topic.label.name}
            </span>
          </PageHeading>
          {topic.label.fallback ? <Alert tone="info">{t('fallback')}</Alert> : null}
          {topic.label.description === null ? null : (
            <p lang={labelLocale} dir={labelDirection}>
              {topic.label.description}
            </p>
          )}
        </Prose>

        <Panel>
          <form
            method="get"
            action={`/${locale}/search`}
            role="search"
            aria-label={t('searchWithin')}
            className="flex flex-col gap-3"
          >
            <SectionHeading>{t('searchWithin')}</SectionHeading>
            <input type="hidden" name="topic" value={topic.slug} />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label htmlFor="topic-search" className="text-sm font-medium">
                  {t('searchLabel')}
                </label>
                <TextInput id="topic-search" type="search" name="q" maxLength={200} />
              </div>
              <Button>{t('searchSubmit')}</Button>
            </div>
          </form>
        </Panel>

        {children.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="topic-children">
            <h2 id="topic-children" className="text-lg font-semibold">
              {t('subtopics')}
            </h2>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {children.map((child) => (
                <li key={child.id}>
                  <TextLink href={`/${locale}/topics/${encodeURIComponent(child.slug)}`}>
                    {child.label.name}
                  </TextLink>
                </li>
              ))}
            </ul>
          </section>
        )}

        {books.items.length === 0 ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="topic-books">
            <h2 id="topic-books" className="text-lg font-semibold">
              {t('books')}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {books.items.slice(0, BOOK_PREVIEW).map((work) => {
                const label = labelFor(work, locale);
                return (
                  <Panel as="li" key={work.id}>
                    <p
                      className="font-semibold break-words"
                      lang={label.locale}
                      dir={directionOf(label.locale)}
                    >
                      <TextLink href={workPath(locale, work.slug)}>
                        {label.title}
                      </TextLink>
                    </p>
                  </Panel>
                );
              })}
            </ul>
            <p>
              <TextLink
                href={`/${locale}/library/books?topic=${encodeURIComponent(topic.id)}`}
              >
                {t('allBooks')}
              </TextLink>
            </p>
          </section>
        )}
      </div>
    </Container>
  );
}
