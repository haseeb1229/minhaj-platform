import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';
import type { TopicView } from '@minhaj/contracts/taxonomy';
import { getTranslations } from 'next-intl/server';

import { TopicChips } from '@/components/ui';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * THE TOPICS (restored from the pre-R2 portal): the canonical taxonomy's
 * active top-level topics, in the taxonomy's own order, as chips to each
 * topic's hub, and the way to all of them. A chip whose name fell back to
 * another language carries that language. Nothing renders when the taxonomy
 * has no active root.
 */
export async function TopicsModule({
  locale,
  roots,
}: {
  readonly locale: Locale;
  readonly roots: readonly TopicView[];
}) {
  if (roots.length === 0) return null;
  const [t, topics] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'topics' }),
  ]);

  return (
    <HomeSection
      id="home-topics"
      header={{
        heading: topics('title'),
        intro: topics('description'),
        action: {
          href: pathFor(locale, requireRoute('topics')),
          text: t('home.links.allTopics'),
        },
      }}
    >
      <TopicChips
        label={topics('title')}
        topics={roots.map((topic) => ({
          href: localizedPath(locale, `/topics/${encodeURIComponent(topic.slug)}`),
          text: topic.label.name,
          ...(topic.label.resolvedLocale === locale
            ? {}
            : { lang: topic.label.resolvedLocale }),
        }))}
      />
    </HomeSection>
  );
}
