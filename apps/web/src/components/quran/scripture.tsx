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
 */
export function ArabicText({
  id,
  label,
  text,
  ayah,
}: {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  /** The Ayah's number, for the presentational end mark. */
  readonly ayah?: number;
}) {
  return (
    <div role="group" aria-labelledby={id} className="min-w-0">
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
        {ayah === undefined ? null : (
          <>
            {' '}
            <span aria-hidden="true" lang="ar" className="quran-name quran-ayah-end">
              {`۝${arabicIndic(ayah)}`}
            </span>
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
 * `quickChoice` marks a default translation the reader's quick choice may hide
 * by language (`data-translations` on the reader); a translation the address
 * chose is always shown. `data-translation-*` is what Copy reads.
 */
export function TranslationText({
  id,
  label,
  name,
  text,
  language,
  quickChoice,
}: {
  readonly id: string;
  /** "Translation: {name}" — the accessible name. */
  readonly label: string;
  readonly name: string;
  readonly text: string;
  readonly language: { readonly code: string; readonly direction: 'ltr' | 'rtl' };
  readonly quickChoice: string | null;
}) {
  return (
    <div
      role="group"
      aria-labelledby={id}
      dir={language.direction}
      data-translation-work={name}
      {...(quickChoice === null ? {} : { 'data-translation-language': quickChoice })}
      className="flex min-w-0 flex-col gap-1.5"
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
