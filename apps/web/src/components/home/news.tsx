import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';
import { leadImagePath, newsPathOf, type NewsSummary } from '@minhaj/contracts/editorial';
import { getTranslations } from 'next-intl/server';

import { contentLanguageBadge } from '@/components/content-language';
import { translationFor } from '@/components/editorial/presentation';
import { EditorialCard } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * LATEST NEWS (R2): one lead story with its picture, and the stories beside it
 * as a column of picture-and-headline rows — the shape of a front page, not a
 * grid of equal cards. Each card names its content language when it differs
 * from the interface (F10). Renders nothing when nothing is published.
 */
export async function LatestNews({
  locale,
  lead,
  rest,
}: {
  readonly locale: Locale;
  readonly lead: NewsSummary | null;
  readonly rest: readonly NewsSummary[];
}) {
  if (lead === null && rest.length === 0) return null;
  const [t, news] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'news' }),
  ]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });

  const card = (item: NewsSummary, variant: 'lead' | 'secondary') => {
    const translation = translationFor(item, locale);
    const language = contentLanguageBadge(translation.languageCode, locale);
    return (
      <EditorialCard
        key={`${item.kind}-${item.slug}`}
        variant={variant}
        as={variant === 'lead' ? 'article' : 'li'}
        href={localizedPath(locale, newsPathOf(item.kind, item.slug))}
        title={translation.title}
        {...(translation.excerpt === '' ? {} : { description: translation.excerpt })}
        meta={[
          <time key="date" dateTime={item.chronologyAt.toISOString().slice(0, 10)}>
            {date.format(item.chronologyAt)}
          </time>,
        ]}
        {...(language === undefined ? {} : { language })}
        lang={translation.languageCode}
        dir={directionOf(translation.languageCode)}
        image={
          item.leadImage === null
            ? null
            : {
                path: leadImagePath(item.leadImage),
                alt: translation.leadAlt ?? '',
                width: item.leadImage.width,
                height: item.leadImage.height,
              }
        }
        sizes={
          variant === 'lead'
            ? '(min-width: 64rem) 38rem, 100vw'
            : '(min-width: 30rem) 12rem, 100vw'
        }
      />
    );
  };

  return (
    <HomeSection
      id="home-news"
      header={{
        heading: news('latest'),
        action: {
          href: pathFor(locale, requireRoute('news-events')),
          text: t('home.links.allNews'),
        },
      }}
    >
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {lead === null ? null : card(lead, 'lead')}
        {rest.length === 0 ? null : (
          <ul
            aria-label={t('home.news.more')}
            className={`m-0 flex list-none flex-col gap-6 p-0 ${lead === null ? 'lg:col-span-2' : ''}`}
          >
            {rest.map((item) => card(item, 'secondary'))}
          </ul>
        )}
      </div>
    </HomeSection>
  );
}
