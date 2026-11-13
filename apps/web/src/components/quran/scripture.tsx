import type { ReactNode } from 'react';

import type {
  AyahWord,
  TajweedSpan,
  TranslationNote,
  WordGloss,
} from '@minhaj/contracts/quran';

import { arabicIndic } from './citation';
import { tajweedClass, tajweedRuns } from './tajweed-layout';
import { noteParagraphs, noteSegments } from './translation-notes';

/**
 * THE SCRIPTURE ELEMENTS every public Quran page renders (R2): the canonical
 * Arabic of an Ayah and one translation of it. Plain markup — no server-only
 * dependency and no translation provider — so the exact-text guarantees below
 * are unit-tested by rendering them (`tests/quran/reader-surface.test.ts`).
 */

/**
 * The canonical Arabic of one Ayah — `lang="ar" dir="rtl"` in every locale,
 * generous line height for the marks, and wrapping rather than overflowing a
 * narrow phone. The text is rendered as one text node, exactly as stored, in a
 * group NAMED as the Arabic text so it is told apart from every layer without
 * being seen.
 *
 * SET IN THE QURAN FACE AND NEVER MACHINE-TRANSLATED. `.quran-text` is the one
 * place the self-hosted Quran typeface applies (`@/styles/fonts`), and
 * `translate="no"` asks a browser's page translator to leave scripture alone.
 *
 * THE AYAH-END MARK IS PRESENTATION, NOT TEXT (R2). When `ayah` is given, the
 * end-of-Ayah sign with the Ayah's number in Arabic-Indic digits follows the
 * text as a SEPARATE, `aria-hidden` element — never characters appended to
 * the stored string — so the text node, what a screen reader reads and what
 * is copied all stay exactly as stored. Its size is the reader's
 * (`.quran-reader` in `globals.css`), so a page's size setting moves it too.
 *
 * THE READING-MODE BUTTON (Quran Part 1). With `open`, the same mark is also
 * drawn inside a button named by the mark it shows and `open` ("۝٣ Surah 2,
 * Ayah 3: show its translation" — the visible label is in the name, WCAG 2.5.3), which the reading and mushaf modes show in place of the plain
 * mark once the reader island can answer it — so in flowing Arabic every Ayah
 * is one keyboard stop that opens its translation. The button holds only the
 * presentational mark; the text node is untouched.
 *
 * TAJWEED COLOURS (Quran Part 9). With `tajweed` spans the text is drawn as
 * runs (`tajweedRuns`): plain text, and a `<span>` per coloured run carrying
 * its rule's class — and nothing else: no space, no mark, no change of font,
 * so the letters join and shape across runs as in one text node and the
 * paragraph's text (what a screen reader reads and Copy takes) is the stored
 * string exactly. The runs are colourless until the reader shows the colours
 * (`data-tajweed="on"`) or a page shows them always (`.tajweed-colours`).
 */
export function ArabicText({
  id,
  label,
  text,
  ayah,
  open,
  tajweed = [],
}: {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  /** The Ayah's number, for the presentational end mark. */
  readonly ayah?: number;
  /** The accessible name of the reading-mode button, when there is one. */
  readonly open?: string;
  /** The Ayah's spans in a public tajweed overlay (Quran Part 9). */
  readonly tajweed?: readonly TajweedSpan[];
}) {
  const mark = ayah === undefined ? null : `۝${arabicIndic(ayah)}`;
  return (
    <div role="group" aria-labelledby={id} className="quran-ayah-arabic min-w-0">
      <span id={id} className="sr-only">
        {label}
      </span>
      <div dir="rtl" className="quran-ayah-text break-words text-start">
        <p
          lang="ar"
          dir="rtl"
          translate="no"
          data-ayah-arabic=""
          className="quran-text inline"
        >
          {tajweedChildren(text, tajweed)}
        </p>
        {mark === null ? null : (
          <>
            {' '}
            <span aria-hidden="true" lang="ar" className="quran-name quran-ayah-end">
              {mark}
            </span>
          </>
        )}
        {mark === null || open === undefined ? null : (
          <>
            {' '}
            <button
              type="button"
              data-ayah-action="open"
              aria-label={`${mark} ${open}`}
              className="quran-ayah-open"
            >
              <span aria-hidden="true" lang="ar" className="quran-name">
                {mark}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The stored text as tajweed runs — the bare text, the element's only child,
 * when no span applies. Each coloured run names every rule covering it
 * (`data-tajweed`); its colour is the last-begun rule's class.
 */
export function tajweedChildren(text: string, spans: readonly TajweedSpan[]): ReactNode {
  if (spans.length === 0) return text;
  return tajweedRuns(text, spans).map((run, index) =>
    run.rule === null ? (
      run.text
    ) : (
      <span
        key={index}
        className={tajweedClass(run.rule)}
        data-tajweed={run.rules.join(' ')}
      >
        {run.text}
      </span>
    ),
  );
}

/** The words a translation's notes are offered with, in the interface language. */
export interface NoteLabels {
  /** The interface locale and its direction, for the words below. */
  readonly locale: string;
  readonly direction: 'ltr' | 'rtl';
  /** "Translator's note" / "Translator's notes (2)" — the disclosure's summary. */
  readonly summary: string;
  /** "Translator's note {number}" — a mark's accessible name, after the mark. */
  readonly reference: (number: number) => string;
}

/**
 * One translation of one Ayah (R2; benchmark patterns 1 and 2): the text in its
 * own language and direction, set for reading (`.quran-translation`: a serif in
 * English, Nastaliq at 1.2× with double leading in Urdu), and the work it is
 * from beneath it as its attribution. The group is NAMED by that attribution,
 * so a screen reader announces whose translation it is.
 *
 * ALIGNED TO ITS OWN READING START. The block is measured (`max-w-[68ch]`) and
 * its inline-end margin is `auto` in its OWN direction, so an Urdu block on an
 * English page hugs the right edge the Arabic ends at, and an English block on
 * an Urdu page the left — never stranded at the page's start. Its text is set
 * from its OWN start too (`text-start`), so an alignment inherited from a page
 * of the other direction never sets an English line flush right.
 *
 * `index` is the work's place among the translations the page rendered: the
 * reader shows or hides each by it (`data-shown` on the reader, Quran Part 1).
 * `data-translation-*` is what Copy and the reading-mode sheet read.
 *
 * THE TRANSLATOR'S NOTES (Quran Part 6). Each mark a note answers is drawn as
 * a link to that note — the mark itself, exactly as written, is the link's
 * only content, so the text node, what Copy reads and what is selected stay
 * the stored text; the link is NAMED "٭ Translator's note 1". The notes
 * follow the attribution in a native `<details>`, each in the translation's
 * language and direction, opened by its own marker as the source wrote it, so
 * with no script a mark jumps to its note (the browser opens the disclosure
 * for the fragment) and the page is complete. The reader island opens a note
 * in a dialog instead, and opens every disclosure when the reader asks for
 * notes under each Ayah (`data-notes`). A note with no mark in the text is
 * the Ayah's as a whole and is listed the same way.
 */
export function TranslationText({
  id,
  label,
  name,
  text,
  language,
  index,
  notes = [],
  noteLabels = null,
  open = false,
}: {
  readonly id: string;
  /** "Translation: {name}" — the accessible name. */
  readonly label: string;
  readonly name: string;
  readonly text: string;
  readonly language: { readonly code: string; readonly direction: 'ltr' | 'rtl' };
  readonly index: number;
  /** The Ayah's translator's notes in this work, in order. */
  readonly notes?: readonly TranslationNote[];
  /** The words the notes are offered with; no notes are drawn without them. */
  readonly noteLabels?: NoteLabels | null;
  /** The notes' disclosure open from the start (the compare view). */
  readonly open?: boolean;
}) {
  const shownNotes = noteLabels === null ? [] : notes;
  const noteId = (ordinal: number) => `${id}-note-${String(ordinal)}`;
  const segments = noteSegments(text, shownNotes);
  return (
    <div
      role="group"
      aria-labelledby={id}
      dir={language.direction}
      data-translation-work={name}
      data-translation-index={index}
      className="me-auto flex w-full min-w-0 max-w-[68ch] flex-col gap-1.5 text-start"
    >
      <p
        lang={language.code}
        dir={language.direction}
        data-translation-text=""
        className="quran-translation reading-face break-words"
      >
        {segments.every((segment) => segment.note === null)
          ? text
          : segments.map((segment, position) => {
              const note = segment.note === null ? undefined : shownNotes[segment.note];
              if (note === undefined || noteLabels === null) return segment.text;
              return (
                <a
                  key={position}
                  href={`#${noteId(note.ordinal)}`}
                  data-note-ref={noteId(note.ordinal)}
                  aria-label={`${segment.text} ${noteLabels.reference(note.ordinal)}`}
                  className="quran-note-ref"
                >
                  {segment.text}
                </a>
              );
            })}
      </p>
      <p id={id} className="text-caption text-foreground-muted">
        <span className="sr-only">{label}</span>
        <span aria-hidden="true">
          — <bdi>{name}</bdi>
        </span>
      </p>
      {shownNotes.length === 0 || noteLabels === null ? null : (
        <details open={open} className="quran-notes" data-translation-notes="">
          <summary
            lang={noteLabels.locale}
            dir={noteLabels.direction}
            className="quran-notes-summary"
          >
            {noteLabels.summary}
          </summary>
          <ol
            lang={language.code}
            dir={language.direction}
            className="quran-notes-list reading-face"
          >
            {shownNotes.map((note) => (
              <li
                key={note.ordinal}
                id={noteId(note.ordinal)}
                data-note=""
                tabIndex={-1}
                className="quran-note"
              >
                {noteParagraphs(note.text).map((paragraph, position) => (
                  <p key={position} className="break-words">
                    {position === 0 && note.marker !== '' ? (
                      <>
                        <span className="quran-note-marker">{note.marker}</span>{' '}
                      </>
                    ) : null}
                    <span data-note-paragraph="">{paragraph}</span>
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/**
 * One TRANSLITERATION of one Ayah (Quran Part 7): a sourced work's text — never
 * one derived from the Arabic — set between the Arabic and the translations.
 * Marked with its own language and direction, so Latin text on an Urdu or
 * Arabic page is an isolated left-to-right run that hugs its own start
 * (`me-auto`); set in the reading face, quieter than a translation
 * (`.quran-transliteration-text`, italic only in a Latin script), and named by
 * its work like a translation. `index` is its place among the
 * transliterations the page rendered: the reader shows the one chosen by it
 * (`data-transliteration`), and nothing by default.
 */
export function TransliterationText({
  id,
  label,
  name,
  text,
  language,
  index,
}: {
  readonly id: string;
  /** "Transliteration: {name}" — the accessible name. */
  readonly label: string;
  readonly name: string;
  readonly text: string;
  readonly language: { readonly code: string; readonly direction: 'ltr' | 'rtl' };
  readonly index: number;
}) {
  return (
    <div
      role="group"
      aria-labelledby={id}
      dir={language.direction}
      data-transliteration-index={index}
      className="quran-transliteration me-auto flex w-full min-w-0 max-w-[68ch] flex-col gap-1 text-start"
    >
      <p
        lang={language.code}
        dir={language.direction}
        className="quran-transliteration-text reading-face break-words"
      >
        {text}
      </p>
      <p id={id} className="text-caption text-foreground-muted">
        <span className="sr-only">{label}</span>
        <span aria-hidden="true">
          — <bdi>{name}</bdi>
        </span>
      </p>
    </div>
  );
}

/**
 * The Arabic of one Ayah WORD BY WORD (Quran Part 7): each word of the stored
 * text, as the one segmentation cuts it (`ayahWords`, `@minhaj/contracts/quran`),
 * drawn as a unit with its sourced gloss BENEATH it as real text — never a
 * tooltip — so a screen reader reads each word and then its meaning, a
 * keyboard needs nothing to reach it, and no script is needed to see it.
 *
 * THE TEXT IS NEVER CHANGED. Each word is a verbatim slice of the stored text
 * (a pause sign stays with its word); a word the work does not gloss is shown
 * alone; a gloss whose position the text does not have is not shown. The
 * plain Arabic line stays in the document — what Copy reads — and the reader
 * shows this in its place only while the work is chosen, in Translation mode
 * (`data-words`, `globals.css`). The Ayah-end mark is presentation, hidden
 * from assistive technology, as on the plain line. `index` is the work's place
 * among the word-by-word works the page rendered.
 */
export function WordByWordText({
  id,
  label,
  name,
  words,
  glosses,
  language,
  index,
  mark,
}: {
  readonly id: string;
  /** "Word by word: {name}" — the accessible name. */
  readonly label: string;
  readonly name: string;
  readonly words: readonly AyahWord[];
  readonly glosses: readonly WordGloss[];
  readonly language: { readonly code: string; readonly direction: 'ltr' | 'rtl' };
  readonly index: number;
  /** The presentational Ayah-end mark ("۝٣"), or null. */
  readonly mark: string | null;
}) {
  const glossOf = new Map(glosses.map((gloss) => [gloss.position, gloss.text]));
  return (
    <div
      role="group"
      aria-labelledby={id}
      data-words-index={index}
      className="quran-wbw flex min-w-0 flex-col gap-2"
    >
      <span id={id} className="sr-only">
        {label}
      </span>
      <ol dir="rtl" className="quran-wbw-words">
        {words.map((word) => {
          const gloss = glossOf.get(word.position);
          return (
            <li key={word.position} className="quran-wbw-word">
              <span
                lang="ar"
                dir="rtl"
                translate="no"
                className="quran-text quran-wbw-arabic"
              >
                {word.text}
              </span>
              {gloss === undefined ? null : (
                <span
                  lang={language.code}
                  dir={language.direction}
                  className="quran-wbw-gloss reading-face"
                >
                  {gloss}
                </span>
              )}
            </li>
          );
        })}
        {mark === null ? null : (
          <li aria-hidden="true" className="quran-wbw-word quran-wbw-end">
            <span lang="ar" className="quran-name quran-wbw-mark">
              {mark}
            </span>
          </li>
        )}
      </ol>
      <p className="text-caption text-foreground-muted" aria-hidden="true">
        — <bdi>{name}</bdi>
      </p>
    </div>
  );
}
