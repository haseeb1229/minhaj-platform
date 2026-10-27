import type { ReaderDocument } from '@minhaj/contracts/library';

import { SectionHeading } from '@/components/ui';
import { ReaderControls, type ReaderControlLabels } from './reader-controls';

/**
 * THE LONG-FORM READER (DELIVERY_PLAN.md Phase 8, PRODUCT_SCOPE.md §2.1).
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
 * `dangerouslySetInnerHTML`, and therefore nothing to sanitise.
 *
 * NO LOGIN, AND NO SESSION. This component receives a resolved document and
 * renders it. Nothing in its module graph can read a cookie, and there is no
 * per-visitor state on the server or in this markup (§36, §37).
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
 *     narrower column instead of scrolling sideways;
 *   - no motion at all, and no inline `style` attribute — the typography defaults
 *     live in the stylesheet (`.library-reader`) under the platform's
 *     `style-src 'self'` CSP.
 */

interface ReaderLabels extends ReaderControlLabels {
  readonly contents: string;
  readonly readerHeading: string;
  /** "Section {current} of {total}", for the per-heading position. */
  readonly sectionPosition: string;
  readonly nextSection: string;
  readonly previousSection: string;
  readonly backToContents: string;
}

const CONTENTS_ID = 'library-reader-contents';
const READER_ID = 'library-reader';

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
    <div className="flex flex-col gap-6">
      <SectionHeading>{labels.readerHeading}</SectionHeading>

      <ReaderControls readerId={READER_ID} sectionCount={total} labels={labels} />

      <nav
        id={CONTENTS_ID}
        aria-label={labels.contents}
        lang={interfaceLocale}
        dir={interfaceDirection}
        className="scroll-mt-8 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)] px-4 py-3"
      >
        <p className="text-caption pb-1 font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
          {labels.contents}
        </p>
        <ol className="flex list-decimal flex-col ps-6 marker:text-[color:var(--color-foreground-muted)]">
          {sections.map((section) => (
            <li key={section.key}>
              {/*
               * The entry is the EDITION's own words appearing inside the
               * interface's chrome, so it carries the content language and
               * direction even though its container carries the interface's.
               */}
              <a
                href={`#${section.id}`}
                lang={languageCode}
                dir={direction}
                className="inline-block py-2.5 underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:decoration-[color:var(--color-action)]"
              >
                {section.title}
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
        className="library-reader"
      >
        <div className="flex flex-col gap-10">
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
                // top edge identically in every reading direction.
                className="flex scroll-mt-8 flex-col gap-4"
              >
                <h3 id={`${section.id}-heading`} className="text-xl font-semibold">
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
                  className="flex flex-wrap gap-x-6 gap-y-1 border-t border-[color:var(--color-border)] pt-2 text-sm"
                >
                  {previous === undefined ? null : (
                    <a
                      href={`#${previous.id}`}
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      {labels.previousSection}
                    </a>
                  )}
                  {next === undefined ? null : (
                    <a
                      href={`#${next.id}`}
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      {labels.nextSection}
                    </a>
                  )}
                  <a
                    href={`#${CONTENTS_ID}`}
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                  >
                    {labels.backToContents}
                  </a>
                </nav>
              </section>
            );
          })}
        </div>
      </article>
    </div>
  );
}
