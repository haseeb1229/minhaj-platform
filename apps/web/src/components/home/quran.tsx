import type { Locale } from '@minhaj/contracts';
import type { PublicSurah } from '@minhaj/contracts/quran';
import { getTranslations } from 'next-intl/server';

import { quranPath, surahName, surahPath } from '@/components/quran/presentation';
import { Badge, Container, Icon } from '@/components/ui';
import { directionOf } from '@/config/locale';

import { quickSurahs } from './presentation';

/**
 * THE QURAN ENTRY (R2): a way straight into the text, rendered only when the
 * deployment presents a navigable Quran (an approved corpus, or a reference
 * preview it admits). A preview says so beside the heading, in words.
 *
 * Each quick link is one surah — its number, its Arabic name in the Naskh
 * face, its name in the interface language and its length — as one link. The
 * full index and the juz index sit beside them. Names and counts are the
 * corpus's own; a surah the corpus lacks is simply not offered.
 */
export async function QuranEntry({
  locale,
  surahs,
  preview,
}: {
  readonly locale: Locale;
  readonly surahs: readonly PublicSurah[];
  /** True for a reference preview, which is labelled as one. */
  readonly preview: boolean;
}) {
  const quick = quickSurahs(surahs);
  if (quick.length === 0) return null;
  const [t, quran] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'quran' }),
  ]);

  return (
    <section
      aria-labelledby="home-quran"
      className="border-b border-border bg-surface-sunken"
    >
      <Container>
        <div className="grid grid-cols-1 gap-x-12 gap-y-8 py-[var(--space-section)] lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:items-start">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="home-quran" className="text-title font-semibold text-balance">
                {t('home.quran.heading')}
              </h2>
              {preview ? (
                <Badge tone="caution">{t('home.status.reference')}</Badge>
              ) : null}
            </div>
            <p className="max-w-[var(--measure-prose)] text-foreground-muted">
              {t('home.quran.intro', { count: surahs.length })}
            </p>
            <ul className="flex list-none flex-col gap-1 p-0">
              <li>
                <a
                  href={quranPath(locale, 'surah')}
                  className="inline-flex min-h-11 items-center gap-2 font-semibold text-action underline-offset-4 hover:underline"
                >
                  {t('home.quran.allSurahs', { count: surahs.length })}
                  <Icon name="arrow-end" size={16} />
                </a>
              </li>
              <li>
                <a
                  href={quranPath(locale, 'juz')}
                  className="inline-flex min-h-11 items-center gap-2 font-semibold text-action underline-offset-4 hover:underline"
                >
                  {t('home.quran.byJuz')}
                  <Icon name="arrow-end" size={16} />
                </a>
              </li>
            </ul>
          </div>

          <ul
            aria-label={t('home.quran.quickLabel')}
            className="grid list-none grid-cols-1 gap-3 p-0 min-[30rem]:grid-cols-2 xl:grid-cols-3"
          >
            {quick.map((surah) => {
              const name = surahName(surah, locale);
              return (
                <li
                  key={surah.number}
                  className="group card-surface relative flex min-w-0 items-center gap-4 rounded-panel border border-border bg-surface-raised px-4 py-3 shadow-panel transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-accent-rule hover:shadow-raised"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-accent-rule text-sm font-semibold text-accent tabular-nums"
                  >
                    {new Intl.NumberFormat(locale).format(surah.number)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <a
                      href={surahPath(locale, surah.number)}
                      className="card-link font-semibold wrap-anywhere text-foreground no-underline decoration-accent-rule underline-offset-4 group-hover:underline"
                      {...(name === null
                        ? {}
                        : { lang: name.locale, dir: directionOf(name.locale) })}
                    >
                      {name === null
                        ? quran('surahName', { number: surah.number })
                        : name.text}
                    </a>
                    <span className="text-caption text-foreground-muted">
                      {quran('ayahCount', { count: surah.ayahCount })}
                    </span>
                  </span>
                  {surah.nameArabic === null ? null : (
                    <span
                      lang="ar"
                      dir="rtl"
                      className="shrink-0 font-naskh text-heading leading-none text-foreground"
                    >
                      {surah.nameArabic}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Container>
    </section>
  );
}
