import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';
import { leadImagePath, newsPathOf, type NewsSummary } from '@minhaj/contracts/editorial';
import { getTranslations } from 'next-intl/server';

import { contentLanguageBadge } from '@/components/content-language';
import { translationFor } from '@/components/editorial/presentation';
import { quranPath } from '@/components/quran/presentation';
import { ActionLink, Hero, LanguageBadge, ResponsiveImage } from '@/components/ui';
import { directionOf } from '@/config/locale';

/**
 * THE HOME HERO (R2): what this place is, the two ways in, and one real picture.
 *
 * THE TWO PATHS are the platform's two halves — the Quran, and the knowledge
 * around it. "Read the Quran" is offered only while the deployment presents a
 * Quran text visitors may navigate to; otherwise the heading and the first
 * action speak of the Library alone, so the opening never promises a page that
 * says "not yet".
 *
 * THE PICTURE IS A RECORD, never decoration: the newest story that has a lead
 * image, with its date and headline as the caption and the headline as the one
 * link. Without such a story the hero is words alone.
 */
export async function HomeHero({
  locale,
  story,
  quranOpen,
}: {
  readonly locale: Locale;
  readonly story: NewsSummary | null;
  /** True when the Quran section is navigable on this deployment. */
  readonly quranOpen: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'shell' });
  const library = localizedPath(locale, '/library');

  return (
    <Hero
      variant="split"
      tone="ink"
      title={quranOpen ? t('home.hero.title') : t('home.hero.titleLibrary')}
      lede={t('home.hero.lede')}
      actions={
        quranOpen ? (
          <>
            <ActionLink href={quranPath(locale)} onInk>
              {t('home.hero.readQuran')}
            </ActionLink>
            <ActionLink href={library} tone="secondary" onInk>
              {t('home.hero.exploreLibrary')}
            </ActionLink>
          </>
        ) : (
          <ActionLink href={library} onInk>
            {t('home.hero.exploreLibrary')}
          </ActionLink>
        )
      }
      {...(story === null ? {} : { aside: <HeroStory locale={locale} story={story} /> })}
    />
  );
}

/** The hero's picture and its caption: one link, named by the headline. */
async function HeroStory({
  locale,
  story,
}: {
  readonly locale: Locale;
  readonly story: NewsSummary;
}) {
  if (story.leadImage === null) return null;
  const t = await getTranslations({ locale, namespace: 'shell' });
  const translation = translationFor(story, locale);
  const language = contentLanguageBadge(translation.languageCode, locale);

  return (
    <figure className="group card-surface relative m-0 flex flex-col gap-4">
      <ResponsiveImage
        path={leadImagePath(story.leadImage)}
        alt={translation.leadAlt ?? ''}
        lang={translation.languageCode}
        width={story.leadImage.width}
        height={story.leadImage.height}
        aspect="3/2"
        radius="panel"
        priority
        sizes="(min-width: 64rem) 34rem, 100vw"
      />
      <figcaption className="flex flex-col gap-2">
        <span className="text-caption flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
          <span>{t('home.hero.storyLabel')}</span>
          <time dateTime={story.chronologyAt.toISOString().slice(0, 10)}>
            {new Intl.DateTimeFormat(locale, {
              dateStyle: 'long',
              timeZone: 'UTC',
            }).format(story.chronologyAt)}
          </time>
          {language === undefined ? null : <LanguageBadge {...language} />}
        </span>
        <a
          href={localizedPath(locale, newsPathOf(story.kind, story.slug))}
          lang={translation.languageCode}
          dir={directionOf(translation.languageCode)}
          className="card-link text-subheading font-semibold text-balance wrap-anywhere text-ink-foreground no-underline decoration-ink-accent decoration-1 underline-offset-4 group-hover:underline"
        >
          {translation.title}
        </a>
      </figcaption>
    </figure>
  );
}
