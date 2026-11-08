/**
 * THE LONG-FORM READING RULES (R2) of an Editorial record page — pure, so each
 * is proved on its own (`tests/editorial/long-form.test.ts`).
 *
 * A TABLE OF CONTENTS ONLY WHEN THE BODY HAS ONE. The record's body is
 * Editorial's SANITISED HTML (`sanitizeEditorialHtml`): its headings are bare
 * `<h2>`, `<h3>` and `<h4>` elements with no attributes at all. The contents are
 * read from the second- and third-level headings, and each one that is listed
 * gains an `id` this module generates from a counter — never from the heading's
 * words, never from input — so the sanitised markup gains nothing a visitor or
 * an editor supplied. A heading carrying any attribute is not the sanitiser's
 * output and is left exactly as it is, unlisted. A body with fewer than two
 * listed headings has no table of contents and is returned unchanged.
 */

export interface ContentsEntry {
  /** The anchor this module gave the heading. */
  readonly id: string;
  readonly level: 2 | 3;
  /** The heading's words as plain text, for rendering as text (never markup). */
  readonly text: string;
}

/** The most entries a contents list shows; a longer body is still readable. */
export const CONTENTS_LIMIT = 40;

const HEADING = /<h([23])>([\s\S]*?)<\/h\1>/gu;

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes the character references a sanitiser writes into text. */
function decode(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/giu,
    (whole, body: string) => {
      if (body.startsWith('#')) {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED[body.toLowerCase()] ?? whole;
    },
  );
}

/** A heading's inner markup as one line of plain text. */
function plainText(markup: string): string {
  return decode(markup.replace(/<[^>]*>/gu, ''))
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * The body with anchors on its listed headings, and the contents list — or the
 * body unchanged and no list when it has fewer than two listed headings.
 */
export function withContents(html: string): {
  readonly html: string;
  readonly entries: readonly ContentsEntry[];
} {
  const entries: ContentsEntry[] = [];
  const anchored = html.replace(HEADING, (whole, level: string, inner: string) => {
    if (entries.length >= CONTENTS_LIMIT) return whole;
    const text = plainText(inner);
    if (text === '') return whole;
    const id = `section-${String(entries.length + 1)}`;
    entries.push({ id, level: level === '2' ? 2 : 3, text });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  return entries.length < 2 ? { html, entries: [] } : { html: anchored, entries };
}

/**
 * Whether a record was REVISED after it was first published here, so an
 * "Updated" date says something true. A record published once — including a
 * migrated one, whose publication and last change are the same moment — shows
 * its publication date alone. A day's grace absorbs the workflow's own
 * bookkeeping around publication.
 */
export function revisedAfterPublication(publishedAt: Date, updatedAt: Date): boolean {
  return updatedAt.getTime() - publishedAt.getTime() > 24 * 60 * 60 * 1000;
}
