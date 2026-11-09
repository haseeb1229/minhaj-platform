'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { PERSONAL_LIMITS } from '@minhaj/contracts/personalisation';

import {
  PersonalIsland,
  type PersonalIslandLabels,
} from '@/components/personal-island/personal-island';
import { Dialog, Sheet } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { ayahCopyText, citationLine } from './citation';
import { PLAY_REQUEST } from './recitation-plan';
import {
  usePosition,
  useFragmentLanding,
  useWindowLoader,
  type ReadingSeries,
  type WindowedSurah,
} from './reader-effects';
import {
  DEFAULT_PREFERENCES,
  LEADINGS,
  READING_MODES,
  SCALE,
  TRANSLATION_LAYOUTS,
  presentationOf,
  shownOf,
  stepScale,
  type Leading,
  type ReadingMode,
  type TranslationLayout,
} from './reader-preferences';
import {
  applyPresentation,
  updateReaderPreferences,
  useReaderPreferences,
} from './reader-store';

/**
 * THE READER'S CONTROLS (R2; Quran Part 1, owner direction 2026-11-09) — the
 * client islands of a Quran reading page: the sticky bar with its settings
 * sheet, and the reading-mode switch at the head of the text.
 *
 * THE TEXT NEVER PASSES THROUGH THEM. The ayat, the translations and their
 * attribution are server-rendered; these islands receive labels and numbers
 * only, reach the reader element by identifier, and change attributes on it
 * (`data-mode`, `data-shown`, `data-leading`, `data-layout`) and two CSS custom
 * properties — through the CSSOM, which the platform's `style-src 'self'`
 * permits — plus `data-enhanced`, which reveals the controls that need script.
 * A sheet that shows an Ayah's text copies it out of the server's elements as
 * plain text; nothing is ever inserted as markup.
 *
 * WHAT THEY REMEMBER, AND WHERE: presentation preferences and the last Ayah in
 * view, in `localStorage` only (`./reader-preferences`, `./reader-store`). The
 * signed-in person's own saving, note and reading position are the private
 * island's (`PersonalIsland`), opened here in a sheet on the Ayah chosen — it
 * talks to `/api/my/*` after the person asks, never during the shared render.
 *
 * NO MOTION. The position line is a native `<progress>`; nothing animates.
 */

/** "{name}" placeholders filled from a record — the labels' only formatting. */
function fill(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

export interface ReaderControlLabels {
  readonly translationSwitch: string;
  readonly settings: string;
  readonly settingsTitle: string;
  readonly close: string;
  readonly modes: Readonly<Record<ReadingMode | 'label', string>>;
  readonly translationsLegend: string;
  readonly arabicSize: string;
  readonly translationSize: string;
  readonly decrease: string;
  readonly increase: string;
  readonly leading: Readonly<Record<Leading | 'label', string>>;
  readonly layout: Readonly<Record<TranslationLayout | 'label', string>>;
  readonly reset: string;
  readonly kept: string;
  readonly moreOptions: string;
  readonly useDefault: string;
  /** "Juz {number}". */
  readonly position: string;
  /** "Surah {surah}, Ayah {ayah}". */
  readonly ayahName: string;
  readonly openPage: string;
  readonly noTranslation: string;
  readonly copy: string;
  readonly share: string;
  readonly save: string;
  /** Play the chosen recitation from this Ayah (Quran Part 5). */
  readonly play: string;
  readonly copied: string;
  readonly linkCopied: string;
  readonly copyFailed: string;
  readonly loadFailed: string;
}

/** One translation the page rendered, in index order. */
export interface RenderedWork {
  readonly slug: string;
  readonly name: string;
  /** The work's content language, by its own name. */
  readonly language: string;
}

export interface ReaderControlsProps {
  /** The element that holds the ayat and receives the preferences. */
  readonly readerId: string;
  /** The ordered list of ayat inside it. */
  readonly listId: string;
  readonly locale: string;
  readonly labels: ReaderControlLabels;
  /** The translations the server rendered, in index order. */
  readonly translations: readonly RenderedWork[];
  /** The indexes shown when nothing is stored. */
  readonly defaults: readonly number[];
  /** The address chose the translation itself: the choice steps aside. */
  readonly fixedTranslation: { readonly text: string; readonly resetHref: string } | null;
  /** The address set a size (`?size=`): a stored size does not override it. */
  readonly explicitSize: boolean;
  /** Whether the page reads in modes (a Surah, a Juz, a mushaf page). */
  readonly modes: boolean;
  readonly initialJuz: number;
  /** Named sources of the Arabic, for the copied citation ("Tanzil Uthmani"). */
  readonly arabicSources: readonly string[];
  /** Each Surah on the page by number: its recorded name, or null. */
  readonly surahLabels: Readonly<Record<string, string | null>>;
  /** Remember the Ayah in view as "last read" (a reading page, not a citation). */
  readonly remember: boolean;
  /** Where the full GET reading form lives on the page, if it does. */
  readonly moreOptionsHref: string | null;
  /** The Surah a page reads in windows, or null: a fragment is landed in it. */
  readonly surah: WindowedSurah | null;
  /** The reading a page's windows belong to (a Surah or a Juz), or null. */
  readonly series: ReadingSeries | null;
  /** The private island's words: Save opens it in place. Null: Save navigates. */
  readonly personal: PersonalIslandLabels | null;
}

const CONTROL =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface-raised px-3 text-sm font-medium text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-raised';

const CHOICE =
  'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control border border-border px-3 text-sm has-[:checked]:border-action has-[:checked]:bg-surface-sunken has-[:checked]:font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus';

const percent = (scale: number) => `${String(Math.round(scale * 100))}%`;

/** An Ayah's text as the page rendered it, for a sheet and for Copy. */
interface AyahView {
  readonly ref: { readonly surah: number; readonly ayah: number };
  readonly citation: string;
  readonly url: string;
  readonly canonical: string;
  readonly arabic: string;
  readonly translations: readonly {
    readonly name: string;
    readonly text: string;
    readonly lang: string;
    readonly dir: 'ltr' | 'rtl';
  }[];
}

export function QuranReaderControls({
  readerId,
  listId,
  locale,
  labels,
  translations,
  defaults,
  fixedTranslation,
  explicitSize,
  modes,
  initialJuz,
  arabicSources,
  surahLabels,
  remember,
  moreOptionsHref,
  surah,
  series,
  personal,
}: ReaderControlsProps) {
  const preferences = useReaderPreferences();
  const [arabicTouched, setArabicTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [rowsVersion, setRowsVersion] = useState(0);
  const [ayahSheet, setAyahSheet] = useState<AyahView | null>(null);
  const [saving, setSaving] = useState<AyahView['ref'] | null>(null);
  const statusTimer = useRef<number | null>(null);
  const base = useId();

  const page = useMemo(
    () => ({
      slugs: translations.map((work) => work.slug),
      defaults,
      fixed: fixedTranslation !== null,
    }),
    [translations, defaults, fixedTranslation],
  );
  const shown = shownOf(preferences, page);
  const anyTranslation = translations.length > 0;

  // The page's own controls, revealed once there is script to run them.
  useEffect(() => {
    const reader = document.getElementById(readerId);
    // `data-script` too: after a client-side navigation the boot script has
    // not run, and the controls it reveals must still appear.
    reader?.setAttribute('data-script', '');
    reader?.setAttribute('data-enhanced', '');
  }, [readerId]);

  useEffect(() => {
    const reader = document.getElementById(readerId);
    if (reader === null) return;
    applyPresentation(
      reader,
      presentationOf(preferences, {
        ...page,
        modes,
        explicitSize: explicitSize && !arabicTouched,
      }),
    );
  }, [readerId, preferences, page, modes, explicitSize, arabicTouched]);

  const say = useCallback((text: string) => {
    setStatus(text);
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(''), 4000);
  }, []);

  useEffect(
    () => () => {
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    },
    [],
  );

  useFragmentLanding(readerId, surah);
  const onLoaded = useCallback(() => setRowsVersion((version) => version + 1), []);
  const onFailed = useCallback(() => say(labels.loadFailed), [say, labels.loadFailed]);
  useWindowLoader(readerId, listId, series?.key ?? null, onLoaded, onFailed);
  const position = usePosition(readerId, initialJuz, remember, series, rowsVersion);

  /** What the page rendered for one Ayah row: its Arabic and its shown translations. */
  const viewOf = useCallback(
    (row: HTMLElement): AyahView => {
      const [surahNumber = 0, ayah = 0] = (row.dataset['ayah'] ?? '')
        .split(':')
        .map(Number);
      const ref = { surah: surahNumber, ayah };
      const groups = [...row.querySelectorAll<HTMLElement>('[data-translation-index]')];
      const visible = groups.filter((group) =>
        shown.includes(Number(group.dataset['translationIndex'])),
      );
      const citation = citationLine({
        label: surahLabels[String(surahNumber)] ?? null,
        ref,
        sources: [
          ...arabicSources,
          ...visible.map((group) => group.dataset['translationWork'] ?? ''),
        ],
      });
      const canonical = row.dataset['canonical'] ?? '';
      return {
        ref,
        citation,
        canonical,
        url: new URL(canonical, window.location.origin).href,
        arabic: row.querySelector('[data-ayah-arabic]')?.textContent ?? '',
        translations: visible.map((group) => {
          const text = group.querySelector<HTMLElement>('[data-translation-text]');
          return {
            name: group.dataset['translationWork'] ?? '',
            text: text?.textContent ?? '',
            lang: text?.lang ?? '',
            dir: text?.dir === 'rtl' ? 'rtl' : 'ltr',
          };
        }),
      };
    },
    [shown, surahLabels, arabicSources],
  );

  const copy = useCallback(
    async (view: AyahView) => {
      try {
        await navigator.clipboard.writeText(
          ayahCopyText({
            arabic: view.arabic,
            translations: view.translations.map((entry) => entry.text),
            citation: view.citation,
            url: view.url,
          }),
        );
        say(labels.copied);
      } catch {
        say(labels.copyFailed);
      }
    },
    [say, labels.copied, labels.copyFailed],
  );

  const share = useCallback(
    async (view: AyahView) => {
      try {
        if (typeof navigator.share === 'function') {
          await navigator.share({
            title: view.citation,
            text: view.citation,
            url: view.url,
          });
        } else {
          await navigator.clipboard.writeText(view.url);
          say(labels.linkCopied);
        }
      } catch (error) {
        // A visitor closing the share sheet is not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        say(labels.copyFailed);
      }
    },
    [say, labels.linkCopied, labels.copyFailed],
  );

  // Every Ayah's tools, by delegation: one listener serves every row,
  // including rows the window loader adds later.
  useEffect(() => {
    const reader = document.getElementById(readerId);
    if (reader === null) return undefined;
    const listener = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest<HTMLElement>('[data-ayah-action]');
      const row = control?.closest<HTMLElement>('li[data-ayah], [data-ayah]');
      if (control === null || control === undefined || row === null || row === undefined)
        return;
      const view = viewOf(row);
      switch (control.dataset['ayahAction']) {
        case 'copy':
          void copy(view);
          break;
        case 'share':
          void share(view);
          break;
        case 'open':
          setAyahSheet(view);
          break;
        case 'save':
          if (personal === null) return;
          event.preventDefault();
          setSaving(view.ref);
          break;
        default:
          break;
      }
    };
    reader.addEventListener('click', listener);
    return () => reader.removeEventListener('click', listener);
  }, [readerId, viewOf, copy, share, personal]);

  function toggleTranslations(on: boolean) {
    // Back on after every work was unticked: the page's own default again.
    updateReaderPreferences(
      on && preferences.translations?.length === 0
        ? { translationsOn: true, translations: null }
        : { translationsOn: on },
    );
  }

  function chooseWork(slug: string, on: boolean) {
    const current = shownOf({ ...preferences, translationsOn: true }, page).map(
      (index) => page.slugs[index] ?? '',
    );
    const next = on
      ? page.slugs.filter((each) => each === slug || current.includes(each))
      : current.filter((each) => each !== slug);
    updateReaderPreferences({ translations: next, translationsOn: next.length > 0 });
  }

  function openMoreOptions() {
    setOpen(false);
    if (moreOptionsHref === null) return;
    const details = document.getElementById(moreOptionsHref.replace(/^#/, ''));
    if (details instanceof HTMLDetailsElement) details.open = true;
  }

  const switchId = `${base}-translation`;
  const ayahTitle = (ref: AyahView['ref']) =>
    fill(labels.ayahName, { surah: ref.surah, ayah: ref.ayah });

  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <p className="hidden text-sm text-foreground-muted tabular-nums sm:block">
        {fill(labels.position, { number: position.juz })}
      </p>
      <p
        role="status"
        className="max-w-[12rem] truncate text-caption font-medium text-action sm:max-w-none"
      >
        {status}
      </p>
      {anyTranslation && fixedTranslation === null ? (
        <label
          htmlFor={switchId}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"
        >
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            checked={shown.length > 0}
            onChange={(event) => toggleTranslations(event.currentTarget.checked)}
            className="size-4 accent-action"
          />
          <span className="hidden sm:inline">{labels.translationSwitch}</span>
          <span className="sr-only sm:hidden">{labels.translationSwitch}</span>
        </label>
      ) : null}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={CONTROL}
      >
        <Icon name="settings" size={20} />
        <span className="sr-only sm:not-sr-only">{labels.settings}</span>
      </button>
      <Sheet
        title={labels.settingsTitle}
        closeLabel={labels.close}
        open={open}
        onOpenChange={setOpen}
      >
        <div className="flex flex-col gap-7">
          {modes ? <ModeChoice labels={labels} name={`${base}-mode-sheet`} /> : null}

          {fixedTranslation !== null ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-semibold">{labels.translationsLegend}</p>
              <p className="text-foreground-muted">{fixedTranslation.text}</p>
              <a
                href={fixedTranslation.resetHref}
                className="inline-flex min-h-11 items-center self-start font-semibold text-action underline-offset-4 hover:underline"
              >
                {labels.useDefault}
              </a>
            </div>
          ) : anyTranslation ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-2 text-sm font-semibold">
                {labels.translationsLegend}
              </legend>
              {translations.map((work, index) => (
                <label key={work.slug} className={CHOICE}>
                  <input
                    type="checkbox"
                    checked={shown.includes(index)}
                    onChange={(event) =>
                      chooseWork(work.slug, event.currentTarget.checked)
                    }
                    className="size-4 shrink-0 accent-action"
                  />
                  <span className="flex min-w-0 flex-col">
                    <bdi className="break-words">{work.name}</bdi>
                    <span className="text-caption text-foreground-muted">
                      {work.language}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {translations.length > 1 ? (
            <Choice
              legend={labels.layout.label}
              name={`${base}-layout`}
              values={TRANSLATION_LAYOUTS}
              labels={labels.layout}
              value={preferences.layout}
              onChange={(layout) => updateReaderPreferences({ layout })}
            />
          ) : null}

          <Stepper
            label={labels.arabicSize}
            value={preferences.arabicScale}
            labels={labels}
            onStep={(direction) => {
              setArabicTouched(true);
              updateReaderPreferences({
                arabicScale: stepScale(preferences.arabicScale, direction),
              });
            }}
          />
          {anyTranslation ? (
            <Stepper
              label={labels.translationSize}
              value={preferences.translationScale}
              labels={labels}
              onStep={(direction) =>
                updateReaderPreferences({
                  translationScale: stepScale(preferences.translationScale, direction),
                })
              }
            />
          ) : null}
          <Choice
            legend={labels.leading.label}
            name={`${base}-leading`}
            values={LEADINGS}
            labels={labels.leading}
            value={preferences.leading}
            onChange={(leading) => updateReaderPreferences({ leading })}
          />

          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => {
                setArabicTouched(true);
                updateReaderPreferences(DEFAULT_PREFERENCES);
              }}
              className={`${CONTROL} self-start`}
            >
              {labels.reset}
            </button>
            <p className="text-caption text-foreground-muted">{labels.kept}</p>
            {moreOptionsHref === null ? null : (
              <a
                href={moreOptionsHref}
                onClick={openMoreOptions}
                className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-action underline-offset-4 hover:underline"
              >
                {labels.moreOptions}
                <Icon name="arrow-end" size={16} />
              </a>
            )}
          </div>
        </div>
      </Sheet>

      <Dialog
        title={ayahSheet === null ? '' : ayahTitle(ayahSheet.ref)}
        closeLabel={labels.close}
        open={ayahSheet !== null}
        onOpenChange={(next) => {
          if (!next) setAyahSheet(null);
        }}
      >
        {ayahSheet === null ? null : (
          <AyahSheet
            view={ayahSheet}
            labels={labels}
            onCopy={() => void copy(ayahSheet)}
            onShare={() => void share(ayahSheet)}
            onPlay={() => {
              const ref = ayahSheet.ref;
              setAyahSheet(null);
              // The Quran layout's player answers; this island never imports it.
              window.dispatchEvent(new CustomEvent(PLAY_REQUEST, { detail: ref }));
            }}
            onSave={
              personal === null
                ? null
                : () => {
                    setAyahSheet(null);
                    setSaving(ayahSheet.ref);
                  }
            }
          />
        )}
      </Dialog>

      {personal === null ? null : (
        <Sheet
          title={saving === null ? '' : ayahTitle(saving)}
          closeLabel={labels.close}
          open={saving !== null}
          onOpenChange={(next) => {
            if (!next) setSaving(null);
          }}
        >
          {saving === null ? null : (
            <PersonalIsland
              key={`${String(saving.surah)}:${String(saving.ayah)}`}
              locale={locale}
              target={{ kind: 'ayah', surah: saving.surah, ayah: saving.ayah }}
              noteMax={PERSONAL_LIMITS.noteMax}
              labels={personal}
              recordHistory={false}
            />
          )}
        </Sheet>
      )}

      <progress
        aria-hidden="true"
        value={position.value}
        max={position.max}
        className="quran-progress absolute inset-x-0 bottom-0 h-0.5 w-full"
      />
    </div>
  );
}

/** What the reading-mode sheet shows for one Ayah: its text, translations and tools. */
function AyahSheet({
  view,
  labels,
  onCopy,
  onShare,
  onPlay,
  onSave,
}: {
  readonly view: AyahView;
  readonly labels: ReaderControlLabels;
  readonly onCopy: () => void;
  readonly onShare: () => void;
  readonly onPlay: () => void;
  readonly onSave: (() => void) | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <p lang="ar" dir="rtl" translate="no" className="quran-text text-2xl leading-loose">
        {view.arabic}
      </p>
      {view.translations.length === 0 ? (
        <p className="text-sm text-foreground-muted">{labels.noTranslation}</p>
      ) : (
        view.translations.map((entry) => (
          <div key={entry.name} dir={entry.dir} className="flex flex-col gap-1.5">
            <p
              lang={entry.lang}
              dir={entry.dir}
              className="quran-translation reading-face"
            >
              {entry.text}
            </p>
            <p className="text-caption text-foreground-muted">
              — <bdi>{entry.name}</bdi>
            </p>
          </div>
        ))
      )}
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <button type="button" onClick={onPlay} className={`quran-ayah-play ${CONTROL}`}>
          <Icon name="play" size={20} />
          {labels.play}
        </button>
        <button type="button" onClick={onCopy} className={CONTROL}>
          <Icon name="copy" size={20} />
          {labels.copy}
        </button>
        <button type="button" onClick={onShare} className={CONTROL}>
          <Icon name="share" size={20} />
          {labels.share}
        </button>
        {onSave === null ? null : (
          <button type="button" onClick={onSave} className={CONTROL}>
            <Icon name="bookmark" size={20} />
            {labels.save}
          </button>
        )}
      </div>
      <a
        href={view.canonical}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-action underline-offset-4 hover:underline"
      >
        {labels.openPage}
        <Icon name="arrow-end" size={16} />
      </a>
    </div>
  );
}

/**
 * THE READING-MODE SWITCH at the head of the text — three native radio
 * buttons drawn as one segmented control, so arrow keys move between them
 * and a screen reader announces a group of three choices. It is visible as
 * soon as the boot script has run (`data-script`), before hydration, and its
 * place is held without script, so it never pushes the text down.
 */
export function QuranModeSwitch({
  labels,
}: {
  readonly labels: Pick<ReaderControlLabels, 'modes'>;
}) {
  const base = useId();
  return <ModeChoice labels={labels} name={`${base}-mode`} segmented />;
}

function ModeChoice({
  labels,
  name,
  segmented = false,
}: {
  readonly labels: Pick<ReaderControlLabels, 'modes'>;
  readonly name: string;
  readonly segmented?: boolean;
}) {
  const preferences = useReaderPreferences();
  if (!segmented)
    return (
      <Choice
        legend={labels.modes.label}
        name={name}
        values={READING_MODES}
        labels={labels.modes}
        value={preferences.mode}
        onChange={(mode) => updateReaderPreferences({ mode })}
      />
    );
  return (
    <fieldset className="quran-mode-switch flex justify-center">
      <legend className="sr-only">{labels.modes.label}</legend>
      <div className="inline-flex rounded-control border border-border-strong bg-surface-sunken p-1">
        {READING_MODES.map((mode) => (
          <label
            key={mode}
            className="inline-flex min-h-10 min-w-20 cursor-pointer items-center justify-center rounded-[calc(var(--radius-control)-2px)] px-3 text-sm font-medium text-foreground-muted has-[:checked]:bg-surface-raised has-[:checked]:text-foreground has-[:checked]:shadow-panel has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus"
          >
            <input
              type="radio"
              name={name}
              value={mode}
              checked={preferences.mode === mode}
              onChange={() => updateReaderPreferences({ mode })}
              className="sr-only"
            />
            {labels.modes[mode]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Choice<T extends string>({
  legend,
  name,
  values,
  labels,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly name: string;
  readonly values: readonly T[];
  readonly labels: Readonly<Record<T, string>>;
  readonly value: T;
  readonly onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-sm font-semibold">{legend}</legend>
      <div
        className={`grid grid-cols-1 gap-2 ${values.length === 2 ? 'min-[22rem]:grid-cols-2' : 'min-[22rem]:grid-cols-3'}`}
      >
        {values.map((each) => (
          <label key={each} className={CHOICE}>
            <input
              type="radio"
              name={name}
              value={each}
              checked={value === each}
              onChange={() => onChange(each)}
              className="size-4 shrink-0 accent-action"
            />
            {labels[each]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Stepper({
  label,
  value,
  labels,
  onStep,
}: {
  readonly label: string;
  readonly value: number;
  readonly labels: Pick<ReaderControlLabels, 'decrease' | 'increase'>;
  readonly onStep: (direction: 1 | -1) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{label}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${labels.decrease}: ${label}`}
          disabled={value <= SCALE.min}
          onClick={() => onStep(-1)}
          className={`${CONTROL} min-w-11 px-0`}
        >
          <Icon name="minus" size={20} />
        </button>
        <output aria-live="polite" className="min-w-14 text-center text-sm tabular-nums">
          {percent(value)}
        </output>
        <button
          type="button"
          aria-label={`${labels.increase}: ${label}`}
          disabled={value >= SCALE.max}
          onClick={() => onStep(1)}
          className={`${CONTROL} min-w-11 px-0`}
        >
          <Icon name="plus" size={20} />
        </button>
      </div>
    </div>
  );
}
