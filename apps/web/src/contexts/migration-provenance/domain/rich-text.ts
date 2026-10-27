import 'server-only';

import type { StagedBlock, StagedInline } from '@minhaj/contracts/migration';

import { decodeEntities, sanitizeFragment, type HrefRewrite } from './normalize.ts';

/**
 * SANITISED MARKUP → STAGED BLOCKS (MIGRATION_STRATEGY.md §4.6).
 *
 * The input is ALWAYS the sanitiser's own output first: only the allowlisted
 * tags remain (`p br strong em ul ol li blockquote a h2 h3 h4`), every `<` in
 * text is escaped, and tags are balanced — so splitting on tags is exact and
 * no markup string ever reaches a target. The words are never changed: runs
 * of ASCII whitespace collapse to one space (HTML's own rendering rule), a
 * `<br>` becomes a newline inside its run, and nothing else is touched.
 *
 * Nested structure the targets cannot hold is flattened, never discarded: a
 * list inside a list item continues the outer list; a paragraph inside a
 * quotation starts a new quotation block.
 */

interface Marks {
  bold: number;
  italic: number;
  hrefs: (string | null)[];
}

type Open =
  | { readonly type: 'paragraph' | 'quote'; readonly content: StagedInline[] }
  | {
      readonly type: 'heading';
      readonly level: 2 | 3 | 4;
      readonly content: StagedInline[];
    }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly items: StagedInline[][];
    };

const ASCII_SPACE = /[\t\n\f\r ]+/g;

function sameMarks(a: StagedInline, b: StagedInline): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.href === b.href;
}

/** Appends words to a run list, merging with the previous run when the marks agree. */
function append(runs: StagedInline[], text: string, marks: Marks): void {
  if (text.length === 0) return;
  const href = marks.hrefs.at(-1) ?? null;
  const run: StagedInline = {
    text,
    ...(marks.bold > 0 ? { bold: true as const } : {}),
    ...(marks.italic > 0 ? { italic: true as const } : {}),
    ...(href !== null ? { href } : {}),
  };
  const last = runs.at(-1);
  if (last !== undefined && sameMarks(last, run))
    runs[runs.length - 1] = { ...last, text: last.text + text };
  else runs.push(run);
}

/** Trims a run list's outer whitespace and drops runs left empty. */
function tidy(runs: readonly StagedInline[]): StagedInline[] {
  const out = runs.map((run) => ({ ...run }));
  while (out.length > 0) {
    const first = out[0];
    if (first === undefined) break;
    const text = first.text.replace(/^[ \n]+/, '');
    if (text.length > 0) {
      out[0] = { ...first, text };
      break;
    }
    out.shift();
  }
  while (out.length > 0) {
    const last = out.at(-1);
    if (last === undefined) break;
    const text = last.text.replace(/[ \n]+$/, '');
    if (text.length > 0) {
      out[out.length - 1] = { ...last, text };
      break;
    }
    out.pop();
  }
  return out.filter((run) => run.text.length > 0);
}

/**
 * Blocks from untrusted legacy markup. `rewrite` decides each link (§4.5);
 * `redact` replaces incidental personal data first (§8.3).
 */
export function blocksFrom(
  html: string,
  options: { readonly rewrite?: HrefRewrite; readonly redact?: boolean } = {},
): StagedBlock[] {
  const safe = sanitizeFragment(html, options);
  const blocks: StagedBlock[] = [];
  const marks: Marks = { bold: 0, italic: 0, hrefs: [] };
  // Held in an object: the helpers below mutate it, which a plain `let`
  // would hide from control-flow narrowing.
  const state: {
    open: Open | null;
    quoteDepth: number;
    listDepth: number;
    inItem: boolean;
  } = {
    open: null,
    quoteDepth: 0,
    listDepth: 0,
    inItem: false,
  };

  const close = () => {
    const open = state.open;
    if (open === null) return;
    if (open.type === 'list') {
      const items = open.items.map(tidy).filter((item) => item.length > 0);
      if (items.length > 0) blocks.push({ type: 'list', ordered: open.ordered, items });
    } else {
      const content = tidy(open.content);
      if (content.length > 0)
        blocks.push(
          open.type === 'heading'
            ? { type: 'heading', level: open.level, content }
            : { type: open.type, content },
        );
    }
    state.open = null;
  };

  const runs = (): StagedInline[] => {
    state.open ??= { type: state.quoteDepth > 0 ? 'quote' : 'paragraph', content: [] };
    const open = state.open;
    if (open.type === 'list') {
      if (open.items.length === 0) open.items.push([]);
      return open.items[open.items.length - 1] ?? [];
    }
    return open.content;
  };

  for (const part of safe.split(/(<[^>]*>)/)) {
    if (part.length === 0) continue;
    if (!part.startsWith('<')) {
      const text = decodeEntities(part).replace(ASCII_SPACE, ' ');
      // Whitespace between blocks, or between list items, is layout, not words.
      if (
        text.trim().length === 0 &&
        (state.open === null || (state.open.type === 'list' && !state.inItem))
      )
        continue;
      append(runs(), text, marks);
      continue;
    }
    const closing = part.startsWith('</');
    const name = /^<\/?([a-z0-9]+)/.exec(part)?.[1] ?? '';
    switch (name) {
      case 'strong':
        marks.bold += closing ? -1 : 1;
        break;
      case 'em':
        marks.italic += closing ? -1 : 1;
        break;
      case 'a':
        if (closing) marks.hrefs.pop();
        else {
          const href = /\bhref="([^"]*)"/.exec(part)?.[1];
          marks.hrefs.push(href === undefined ? null : decodeEntities(href));
        }
        break;
      case 'br':
        append(runs(), '\n', marks);
        break;
      case 'p':
        if (state.listDepth > 0) break;
        close();
        break;
      case 'blockquote':
        if (state.listDepth > 0) break;
        close();
        state.quoteDepth += closing ? -1 : 1;
        break;
      case 'h2':
      case 'h3':
      case 'h4':
        if (state.listDepth > 0) break;
        close();
        if (!closing)
          state.open = {
            type: 'heading',
            level: Number(name.slice(1)) as 2 | 3 | 4,
            content: [],
          };
        break;
      case 'ul':
      case 'ol':
        if (closing) {
          state.listDepth -= 1;
          if (state.listDepth === 0) {
            close();
            state.inItem = false;
          }
        } else {
          state.listDepth += 1;
          if (state.listDepth === 1) {
            close();
            state.open = { type: 'list', ordered: name === 'ol', items: [] };
          }
        }
        break;
      case 'li':
        if (closing) state.inItem = false;
        else if (state.open !== null && state.open.type === 'list') {
          state.open.items.push([]);
          state.inItem = true;
        }
        break;
      default:
        break;
    }
  }
  close();
  return blocks;
}

/** The words of blocks as a reader sees them: one paragraph per block or list item. */
export function blocksText(blocks: readonly StagedBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'list')
      for (const item of block.items) lines.push(item.map((run) => run.text).join(''));
    else lines.push(block.content.map((run) => run.text).join(''));
  }
  return lines.join('\n\n');
}
