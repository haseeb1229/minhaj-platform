import 'server-only';

import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { formatDuration } from '@minhaj/contracts/media';
import type { PublicLayerWork } from '@minhaj/contracts/quran';

import { workPath } from '@/components/library/presentation';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { mediaLabel, videoPath } from '@/components/media/presentation';
import { Icon } from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  bookTitle,
  lectureHref,
  passageCitation,
  tafsirSurahPath,
  type AyahResources,
} from './tafsir-layout';
import type { HubBook, HubLecture } from './tafsir-read';

/**
 * ONE AYAH'S TAFSIR PANEL (Quran Part 8) — what explains it: the public Tafsir
 * entries covering it (an excerpt, with the way to the whole entry), the books
 * whose passages cover it and the lectures (each opened at its passage).
 *
 * TWO PRESENTATIONS OF ONE MARKUP. In a reading list the panel is `hidden`
 * inside the Ayah's row — the window loader carries it with the row — and the
 * reader island copies it, as plain text and first-party addresses, into a
 * sheet when the Ayah's Tafsir action is pressed; without script that action is
 * a link to the Ayah's place on its Surah's tafsir page, where all of it is in
 * the open. On an Ayah's own page (`visible`) it is a section of the page.
 *
 * Only an Ayah something explains renders one, so the action is never empty.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;

/** How much of an entry the panel quotes before "read it all". */
const EXCERPT = 320;

function excerpt(text: string): string {
  const first = paragraphsOf(text)[0] ?? '';
  return first.length <= EXCERPT ? first : `${first.slice(0, EXCERPT).trimEnd()}…`;
}

const ITEM =
  'flex min-h-11 min-w-0 flex-col gap-1 rounded-control border border-border bg-surface-raised px-3 py-2.5 text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:bg-accent-surface';

export function TafsirPanel({
  id,
  locale,
  surah,
  ayah,
  found,
  works,
  t,
  visible = false,
}: {
  readonly id: string;
  readonly locale: Locale;
  readonly surah: number;
  readonly ayah: number;
  readonly found: AyahResources<HubBook, HubLecture>;
  readonly works: ReadonlyMap<string, PublicLayerWork>;
  readonly t: QuranTranslator;
  readonly visible?: boolean;
}) {
  const citation = `${String(surah)}:${String(ayah)}`;
  const all = `${tafsirSurahPath(locale, surah)}?ayah=${String(ayah)}`;
  const headingId = `${id}-heading`;
  const Heading = visible ? 'h3' : 'p';
  const groups = (
    <>
      {found.texts.length === 0 ? null : (
        <section data-tafsir-group="" className="flex flex-col gap-2">
          <Heading
            data-tafsir-heading=""
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Icon name="list" size={16} className="text-accent" />
            {t('reader.tafsir.texts')}
          </Heading>
          <ul className="flex flex-col gap-2">
            {found.texts.map(({ workId, entry }) => {
              const work = works.get(workId);
              if (work === undefined) return null;
              const range = passageCitation({
                surah: entry.surah,
                ayahFrom: entry.startAyah,
                ayahTo: entry.endAyah,
              });
              return (
                <li key={entry.id}>
                  <a href={all} data-tafsir-item="" className={ITEM}>
                    <span
                      data-tafsir-title=""
                      className="font-semibold wrap-anywhere"
                      dir="auto"
                    >
                      {work.name}
                    </span>
                    <span
                      data-tafsir-meta=""
                      className="text-caption text-foreground-muted"
                    >
                      <bdi dir="ltr">{range}</bdi>
                    </span>
                    <span
                      data-tafsir-excerpt=""
                      className="reading-face text-sm wrap-anywhere"
                      lang={work.languageCode}
                      dir="auto"
                    >
                      {excerpt(entry.text)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {found.books.length === 0 ? null : (
        <section data-tafsir-group="" className="flex flex-col gap-2">
          <Heading
            data-tafsir-heading=""
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Icon name="book" size={16} className="text-accent" />
            {t('reader.tafsir.books')}
          </Heading>
          <ul className="flex flex-col gap-2">
            {found.books.map((book) => {
              const label = bookTitle(book, locale);
              const cited = book.passages.filter((passage) => passage.surah === surah);
              return (
                <li key={book.id}>
                  <a
                    href={workPath(locale, book.slug)}
                    data-tafsir-item=""
                    className={ITEM}
                  >
                    <span
                      data-tafsir-title=""
                      className="font-semibold wrap-anywhere"
                      lang={label.locale}
                      dir={directionOf(label.locale)}
                    >
                      {label.title}
                    </span>
                    <span
                      data-tafsir-meta=""
                      className="text-caption text-foreground-muted"
                    >
                      <bdi dir="ltr">{cited.map(passageCitation).join(' · ')}</bdi>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {found.lectures.length === 0 ? null : (
        <section data-tafsir-group="" className="flex flex-col gap-2">
          <Heading
            data-tafsir-heading=""
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Icon name="video" size={16} className="text-accent" />
            {t('reader.tafsir.lectures')}
          </Heading>
          <ul className="flex flex-col gap-2">
            {found.lectures.map(({ video, passage }) => {
              const label = mediaLabel(video, locale);
              return (
                <li key={video.id}>
                  <a
                    href={lectureHref(videoPath(locale, video.slug), passage)}
                    data-tafsir-item=""
                    className={ITEM}
                  >
                    <span
                      data-tafsir-title=""
                      className="font-semibold wrap-anywhere"
                      lang={label.locale}
                      dir={directionOf(label.locale)}
                    >
                      {label.title}
                    </span>
                    <span
                      data-tafsir-meta=""
                      className="text-caption text-foreground-muted"
                    >
                      <bdi dir="ltr">{passageCitation(passage)}</bdi>
                      {passage.startSeconds === null
                        ? null
                        : ` · ${t('tafsirHub.startsAt', { time: formatDuration(passage.startSeconds) })}`}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p>
        <a
          href={all}
          data-tafsir-all=""
          className="inline-flex min-h-11 items-center font-semibold text-action underline-offset-4 hover:underline"
        >
          {t('reader.tafsir.all', { surah })}
        </a>
      </p>
    </>
  );

  if (visible)
    return (
      <section
        id={id}
        aria-labelledby={headingId}
        className="flex flex-col gap-4 rounded-panel border border-accent-rule bg-accent-surface p-4 sm:p-5"
      >
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
          <Icon name="book" size={20} className="text-accent" />
          {t('reader.tafsir.title', { citation })}
        </h2>
        {groups}
      </section>
    );
  return (
    <div
      hidden
      id={id}
      data-tafsir-panel=""
      data-title={t('reader.tafsir.title', { citation })}
    >
      {groups}
    </div>
  );
}
