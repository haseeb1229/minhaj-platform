import 'server-only';
import { z } from 'zod';
import { getSchema, type JSONContent } from '@tiptap/core';
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string';
import sanitizeHtml from 'sanitize-html';
import { editorialExtensions } from '@minhaj/contracts/editorial/editor';
import { EditorialRefusal } from '../domain/workflow.ts';

const markSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({ type: z.literal('strike') }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z.strictObject({
      href: z.string().max(2048).refine(safeEditorialLink),
      target: z.enum(['_blank', '_self']).nullable().optional(),
      rel: z.string().max(100).nullable().optional(),
      class: z.null().optional(),
      title: z.string().max(200).nullable().optional(),
    }),
  }),
]);
const nodeSchema = z.strictObject({
  type: z.enum([
    'doc',
    'paragraph',
    'text',
    'heading',
    'bulletList',
    'orderedList',
    'listItem',
    'blockquote',
    'hardBreak',
  ]),
  text: z.string().max(100_000).optional(),
  attrs: z
    .strictObject({
      level: z.number().int().min(2).max(4).optional(),
      start: z.number().int().min(1).max(10_000).optional(),
      type: z.null().optional(),
    })
    .optional(),
  marks: z.array(markSchema).max(4).optional(),
  content: z.array(z.unknown()).max(2000).optional(),
});
export function safeEditorialLink(value: string): boolean {
  if (
    value !== value.trim() ||
    /[\s\\]/u.test(value) ||
    [...value].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function sanitizeEditorialHtml(html: string): string {
  if (html.length > 400_000) throw new EditorialRefusal('invalid');
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'blockquote',
      'strong',
      'em',
      's',
      'br',
      'a',
    ],
    allowedAttributes: { a: ['href', 'rel', 'title'], ol: ['start'] },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: 'a',
        attribs: {
          ...(attrs['href'] && safeEditorialLink(attrs['href'])
            ? { href: attrs['href'] }
            : {}),
          ...(attrs['title'] ? { title: attrs['title'] } : {}),
          rel: 'noopener noreferrer',
        },
      }),
    },
  });
}
/**
 * The plain text of a STORED editor document, for search matching.
 *
 * STRUCTURAL, NOT MARKUP. It walks the validated editor JSON and collects text
 * nodes, one line per block, so no HTML — sanitised or otherwise — is ever
 * parsed or carried into the index, and nothing it returns can be rendered as
 * markup. The same node and depth bounds as rendering apply; a document outside
 * them is refused rather than partially read.
 */
export function editorialPlainText(source: string): string {
  if (source.length > 200_000) throw new EditorialRefusal('invalid');
  const lines: string[] = [];
  let current = '';
  let count = 0;
  function walk(value: unknown, depth: number): void {
    if (++count > 4000 || depth > 12) throw new EditorialRefusal('invalid');
    const node = nodeSchema.safeParse(value);
    if (!node.success) throw new EditorialRefusal('invalid');
    if (node.data.type === 'text') {
      current += node.data.text ?? '';
      return;
    }
    if (node.data.type === 'hardBreak') {
      current += ' ';
      return;
    }
    for (const child of node.data.content ?? []) walk(child, depth + 1);
    if (['paragraph', 'heading', 'listItem', 'blockquote'].includes(node.data.type)) {
      if (current.trim() !== '') lines.push(current.trim());
      current = '';
    }
  }
  try {
    walk(JSON.parse(source), 0);
  } catch (error) {
    if (error instanceof EditorialRefusal) throw error;
    throw new EditorialRefusal('invalid');
  }
  if (current.trim() !== '') lines.push(current.trim());
  return lines.join('\n');
}

export function renderEditorialDocument(source: string): {
  document: string;
  html: string;
} {
  if (source.length > 200_000) throw new EditorialRefusal('invalid');
  let count = 0;
  function inspect(value: unknown, depth: number): JSONContent {
    if (++count > 4000 || depth > 12) throw new EditorialRefusal('invalid');
    const parsed = nodeSchema.safeParse(value);
    if (!parsed.success) throw new EditorialRefusal('invalid');
    const node = parsed.data;
    if (depth === 0 && node.type !== 'doc') throw new EditorialRefusal('invalid');
    if (node.type !== 'text' && node.text !== undefined)
      throw new EditorialRefusal('invalid');
    if (node.attrs?.level !== undefined && node.type !== 'heading')
      throw new EditorialRefusal('invalid');
    if (node.attrs?.start !== undefined && node.type !== 'orderedList')
      throw new EditorialRefusal('invalid');
    return {
      ...node,
      ...(node.content
        ? { content: node.content.map((child) => inspect(child, depth + 1)) }
        : {}),
    } as JSONContent;
  }
  try {
    const content = inspect(JSON.parse(source), 0);
    const extensions = editorialExtensions();
    const document = getSchema(extensions).nodeFromJSON(content);
    document.check();
    const html = sanitizeEditorialHtml(
      renderToHTMLString({ extensions, content: document }),
    );
    return { document: JSON.stringify(content), html };
  } catch (error) {
    if (error instanceof EditorialRefusal) throw error;
    throw new EditorialRefusal('invalid');
  }
}
