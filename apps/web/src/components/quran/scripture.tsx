import { arabicIndic } from './citation';

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
 */
export function TranslationText({
  id,
  label,
  name,
  text,
  language,
  index,
}: {
  readonly id: string;
  /** "Translation: {name}" — the accessible name. */
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
