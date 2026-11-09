import type { TranslationNote } from '@minhaj/contracts/quran';

import { arabicIndic } from './citation';
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
 */
export function ArabicText({
  id,
  label,
  text,
  ayah,
  open,
}: {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  /** The Ayah's number, for the presentational end mark. */
  readonly ayah?: number;
  /** The accessible name of the reading-mode button, when there is one. */
  readonly open?: string;
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
          {text}
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
      className="flex min-w-0 max-w-[68ch] flex-col gap-1.5"
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
