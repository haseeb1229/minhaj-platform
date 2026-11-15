import type { ReaderDocument } from '@minhaj/contracts/library';

import { ReaderControls, type ReaderControlLabels } from './reader-controls';

/**
 * THE LONG-FORM READER (DELIVERY_PLAN.md Phase 8, PRODUCT_SCOPE.md §2.1;
 * redesigned in Library Part 1).
 *
 * "This phase does not end at metadata pages. A visitor who reaches a Work must
 * be able to READ WHAT IS GENUINELY AVAILABLE." So the edition's text is rendered
 * here, as semantic HTML, on the server.
 *
 * WHAT THE CONTENT IS, AND WHAT IT IS NOT. A `ReaderDocument` is plain text in
 * titled sections. It is NOT rich text, NOT stored HTML and NOT a second
 * editorial document model: Editorial owns Tiptap and sanitisation for Articles
 * and Pages, and reaching for that here would have given Library a rich-text
 * pipeline it has no requirement for and a sanitiser it would have to keep
 * correct (§46). Every string below is inserted as a TEXT NODE by React, so there
 * is no markup path from stored content into the page — no
 * `dangerouslySetInnerHTML`, and therefore nothing to sanitise. Library Part 1
 * changes the presentation only: the document schema is untouched.
 *
 * NO LOGIN, AND NO SESSION. This component receives a resolved document and
 * renders it. Nothing in its module graph can read a cookie, and there is no
 * per-visitor state on the server or in this markup (§36, §37).
 *
 * THE READING LAYOUT (Library Part 1). Wherever the reader has room (a
 * container query, so a Work page's full width and a narrower record column
 * both lay it out well): a contents column kept in view beside the text (above it, bounded
 * and scrollable, on a phone), the text at a comfortable measure, and above
 * both the reading preferences and a slim position bar that stays at the top
 * of the screen while the edition is read — where am I, how far through, the
 * previous and next section, and the way back to the contents.
 *
 * ACCESSIBILITY IS STRUCTURAL RATHER THAN DECORATED (§48):
 *
 *   - a real `<nav>` table of contents of real in-page links, so the whole
 *     edition is navigable by keyboard with nothing but Tab and Enter;
 *   - one `<section>` per structural unit, each with its own heading, so a
 *     screen reader can jump between them and announce where it is;
 *   - each heading states its own position IN WORDS, which is what makes progress
 *     available with JavaScript off and without a live region;
 *   - `lang` and `dir` from the edition's CONTENT language — domain data owned by
 *     Taxonomy, never guessed from the interface locale and never auto-detected
 *     from the first character (DOMAIN_MODEL.md §9.1) — while the reader's own
 *     chrome is marked with the INTERFACE language and direction, so an Urdu
 *     interface around an Arabic edition is correct in both directions at once;
 *   - a measure in `ch` and a font size in `rem`, so 200% zoom reflows into a
 *     narrower column instead of scrolling sideways; logical properties only;
 *   - no motion at all, and no inline `style` attribute — the typography defaults
 *     live in the stylesheet (`.library-reader`) under the platform's
 *     `style-src 'self'` CSP.
 */

interface ReaderLabels extends ReaderControlLabels {
  readonly readerHeading: string;
  /** One line under the heading, where the page has one: the edition and its language. */
  readonly readerIntro?: string;
  /** "Section {current} of {total}", for the per-heading position. */
  readonly sectionPosition: string;
  readonly backToContents: string;
}

const CONTENTS_ID = 'library-reader-contents';
const READER_ID = 'library-reader';
/** The reading section's own address, which a "Read online" call leads to. */
export const READER_SECTION_ID = 'library-reading';

export function Reader({
  anchorFor,
  languageCode,
  direction,
  interfaceLocale,
  interfaceDirection,
  document,
  labels,
}: {
  /**
   * The in-page address of one section, from its authored key.
   *
   * FOR AN EDITION THIS IS THE STABLE POSITION IDENTIFIER — the seam a stored
   * in-edition reading position would attach to: `readerPosition(editionId, contentVersion, sectionKey)`, built
   * from exactly those three things and nothing else. The EDITION, because a
   * position in an Urdu translation is not a position in the Arabic original;
   * the CONTENT VERSION, because a position in text that has since been re-cut
   * should not silently resolve into different words; the SECTION KEY, which is
   * authored structure. No pixel offset, no viewport, no font size and no user —
   * so it is the same at every zoom and type size, before and after a reload,
   * and safe to store. Phase 21 records only THAT a book was read (one history
   * row per Work) and keeps the Quran as its only position (DOMAIN_MODEL.md
   * §14.6); storing a position inside an Edition is not delivered.
   *
   * A Phase-9 document names its sections by key alone: it offers stable
   * in-page links, and no reading-position seam is owed for it.
   */
  readonly anchorFor: (sectionKey: string) => string;
  /** The document's CONTENT language, from Taxonomy. Never the interface locale. */
  readonly languageCode: string;
  readonly direction: 'ltr' | 'rtl';
  readonly interfaceLocale: string;
  readonly interfaceDirection: 'ltr' | 'rtl';
  readonly document: ReaderDocument;
  readonly labels: ReaderLabels;
}) {
  const total = document.sections.length;

  const sections = document.sections.map((section, index) => ({
    ...section,
    index: index + 1,
    id: anchorFor(section.key),
  }));

  return (
    <section
      id={READER_SECTION_ID}
      aria-labelledby={`${READER_SECTION_ID}-heading`}
      className="@container flex scroll-mt-4 flex-col gap-5"
    >
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <h2 id={`${READER_SECTION_ID}-heading`} className="text-heading font-semibold">
          {labels.readerHeading}
        </h2>
        {labels.readerIntro === undefined ? null : (
          <p className="text-sm text-foreground-muted">{labels.readerIntro}</p>
        )}
      </div>

      <ReaderControls
        readerId={READER_ID}
        contentsId={CONTENTS_ID}
        sectionIds={sections.map((section) => section.id)}
        labels={labels}
      />

      <div className="grid grid-cols-1 gap-8 @4xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @4xl:gap-12">
        <nav
          id={CONTENTS_ID}
          aria-label={labels.contents}
          lang={interfaceLocale}
          dir={interfaceDirection}
          className="flex min-w-0 scroll-mt-20 flex-col gap-2 rounded-panel border border-border bg-surface-sunken p-3 @4xl:sticky @4xl:top-20 @4xl:max-h-[calc(100dvh-7rem)] @4xl:self-start @4xl:overflow-y-auto @4xl:border-0 @4xl:bg-transparent @4xl:p-0"
        >
          <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
            {labels.contents}
          </p>
          <ol className="flex max-h-72 list-none flex-col overflow-y-auto border-s border-border p-0 text-sm @4xl:max-h-none @4xl:overflow-visible">
            {sections.map((section) => (
              <li key={section.key} className="flex gap-2">
                {/*
                 * The entry is the EDITION's own words appearing inside the
                 * interface's chrome, so it carries the content language and
                 * direction even though its container carries the interface's.
                 * The controls island marks the entry being read with
                 * `aria-current="location"`.
                 */}
                <a
                  href={`#${section.id}`}
                  lang={languageCode}
                  dir={direction}
                  className="-ms-px flex min-h-11 w-full items-center gap-2 border-s-2 border-transparent py-1.5 ps-3 text-foreground-muted no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:text-foreground aria-[current=location]:border-action aria-[current=location]:font-semibold aria-[current=location]:text-foreground"
                >
                  <span
                    aria-hidden="true"
                    lang={interfaceLocale}
                    className="w-6 shrink-0 text-caption text-foreground-muted tabular-nums"
                  >
                    {new Intl.NumberFormat(interfaceLocale).format(section.index)}
                  </span>
                  <span className="min-w-0 wrap-anywhere">{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/*
         * `library-reader` carries the typography defaults in the STYLESHEET. There
         * is no `style` attribute here: the platform's CSP is `style-src 'self'`,
         * and the controls island changes only the three custom properties, through
         * the CSSOM, which that policy permits.
         */}
        <article
          id={READER_ID}
          lang={languageCode}
          dir={direction}
          className="library-reader min-w-0"
        >
          {sections.map((section, position) => {
            const previous = sections[position - 1];
            const next = sections[position + 1];

            return (
              <section
                key={section.key}
                id={section.id}
                data-reader-index={section.index}
                aria-labelledby={`${section.id}-heading`}
                // A block-direction offset, so a jumped-to heading clears the
                // sticky position bar identically in every reading direction.
                className="library-reader-section scroll-mt-20"
              >
                <h3 id={`${section.id}-heading`}>
                  {section.title}{' '}
                  <span
                    className="sr-only"
                    lang={interfaceLocale}
                    dir={interfaceDirection}
                  >
                    {labels.sectionPosition
                      .replace('{current}', String(section.index))
                      .replace('{total}', String(total))}
                  </span>
                </h3>

                {section.paragraphs.map((paragraph, paragraphIndex) => (
                  <p key={`${section.key}-${String(paragraphIndex)}`}>{paragraph}</p>
                ))}

                {/*
                 * Sequential navigation, as ordinary links: a reader who cannot
                 * use a pointer moves through the edition with Tab and Enter, and
                 * every destination is a real address rather than a scroll
                 * script. Interface language and direction, because the labels
                 * are chrome rather than content.
                 */}
                <nav
                  aria-label={section.title}
                  lang={interfaceLocale}
                  dir={interfaceDirection}
                  className="library-reader-steps"
                >
                  {previous === undefined ? null : (
                    <a href={`#${previous.id}`}>{labels.previousSection}</a>
                  )}
                  {next === undefined ? null : (
                    <a href={`#${next.id}`}>{labels.nextSection}</a>
                  )}
                  <a href={`#${CONTENTS_ID}`}>{labels.backToContents}</a>
                </nav>
              </section>
            );
          })}
        </article>
      </div>
    </section>
  );
}
