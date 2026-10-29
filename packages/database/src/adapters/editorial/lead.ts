import 'server-only';

import type {
  EditorialLeadFamily,
  EditorialLeadImage,
  PublicLeadImage,
  SafeEditorialContent,
} from '@minhaj/contracts/editorial';

import { getDatabaseClient } from '../../client.ts';
import { EditorialDataError } from './workflow.ts';

/**
 * PHASE 30-R — Editorial's optional lead image and source date, written once
 * for the four families that carry them (Article, Page, NewsArticle,
 * PressRelease).
 *
 * THE IMAGE IS A TYPED FOREIGN KEY ON THE REVISION, never a URL: changing it is
 * an ordinary edit that returns the record to draft and needs fresh review,
 * exactly like its words. Its measured box travels with it, and the database
 * ties the box and the credit to the key (`*Revision_lead_ck`).
 */

/** The revision columns that hold a lead image. */
export interface LeadColumns {
  readonly leadAssetId?: string | null;
  readonly leadWidth?: number | null;
  readonly leadHeight?: number | null;
  readonly leadCredit?: string | null;
}

/** A revision's lead image, or null; the box is read only with its key. */
export function leadImageOf(row: LeadColumns): EditorialLeadImage | null {
  if (
    row.leadAssetId === null ||
    row.leadAssetId === undefined ||
    row.leadWidth === null ||
    row.leadWidth === undefined ||
    row.leadHeight === null ||
    row.leadHeight === undefined
  )
    return null;
  return {
    assetId: row.leadAssetId,
    width: row.leadWidth,
    height: row.leadHeight,
    credit: row.leadCredit ?? null,
  };
}

/** The same image as a public page needs it: whose, so its address names its owner. */
export function publicLeadOf(
  family: EditorialLeadFamily,
  recordId: string,
  row: LeadColumns,
): PublicLeadImage | null {
  const image = leadImageOf(row);
  return image === null ? null : { family, recordId, ...image };
}

/** A `date` column as the calendar date it holds, never shifted by a zone. */
export function dateOnly(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString().slice(0, 10);
}

/** A calendar date as the `date` column value Prisma writes: its UTC midnight. */
export function dateColumn(value: string | null | undefined): Date | null {
  return value === null || value === undefined
    ? null
    : new Date(`${value}T00:00:00.000Z`);
}

/**
 * The revision columns a write records. A lead family ALWAYS names all four
 * lead columns (null when there is no image); a dated family also its source
 * date. Any other family supplying either is refused rather than dropped.
 */
export function leadColumnsOf(
  content: SafeEditorialContent,
  shape: { readonly lead: boolean; readonly dated: boolean },
): Record<string, unknown> {
  if (!shape.lead && content.leadImage !== undefined && content.leadImage !== null)
    throw new EditorialDataError('invalid');
  if (
    !shape.dated &&
    content.sourcePublishedOn !== undefined &&
    content.sourcePublishedOn !== null
  )
    throw new EditorialDataError('invalid');
  const image = content.leadImage ?? null;
  return {
    ...(shape.lead
      ? {
          leadAssetId: image?.assetId ?? null,
          leadWidth: image?.width ?? null,
          leadHeight: image?.height ?? null,
          leadCredit: image?.credit ?? null,
        }
      : {}),
    ...(shape.dated ? { sourcePublishedOn: dateColumn(content.sourcePublishedOn) } : {}),
  };
}

/** A translation row's columns: its alt text only where the family has an image. */
export function leadAltOf(
  translation: { readonly leadAlt?: string | undefined },
  lead: boolean,
): { leadAlt?: string } {
  if (!lead) {
    if (translation.leadAlt !== undefined && translation.leadAlt !== '')
      throw new EditorialDataError('invalid');
    return {};
  }
  return { leadAlt: translation.leadAlt ?? '' };
}

/**
 * An Article's or a Page's translation rows as written: every column named, so
 * nothing the caller supplied reaches the table unless it has a place, and the
 * alt text always written (empty when there is none).
 */
export function leadTranslationRows(translations: SafeEditorialContent['translations']): {
  languageCode: string;
  title: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  document: string;
  html: string;
  leadAlt: string;
}[] {
  return translations.map((t) => ({
    languageCode: t.languageCode,
    title: t.title,
    excerpt: t.excerpt,
    seoTitle: t.seoTitle,
    seoDescription: t.seoDescription,
    document: t.document,
    html: t.html,
    leadAlt: t.leadAlt ?? '',
  }));
}

/**
 * Which revision of a record a lead-image question asks about: the PUBLISHED
 * one (the public route — the record is published, so its current revision is
 * the one shown) or the CURRENT one, whatever its state (the administrative
 * preview a reviewer sees before approval).
 */
type Which = 'published' | 'current';

interface LeadOwnerDelegate {
  findFirst(args: object): Promise<{
    readonly current: { readonly leadAssetId: string | null } | null;
  } | null>;
}

const OWNERS: Readonly<
  Record<EditorialLeadFamily, (client: ReturnType<typeof getDatabaseClient>) => unknown>
> = {
  article: (c) => c.article,
  page: (c) => c.page,
  'news-article': (c) => c.newsArticle,
  'press-release': (c) => c.pressRelease,
};

/**
 * Does this record's revision name exactly this asset as its lead image? The
 * one fact Editorial's serving policy needs, read from Editorial's own tables;
 * the family decides the table from a code-owned map, never from input text.
 */
export async function leadImageNamed(
  family: EditorialLeadFamily,
  recordId: string,
  assetId: string,
  which: Which,
): Promise<boolean> {
  const owner = OWNERS[family](getDatabaseClient()) as LeadOwnerDelegate;
  const row = await owner.findFirst({
    where: { id: recordId, ...(which === 'published' ? { state: 'published' } : {}) },
    select: { current: { select: { leadAssetId: true } } },
  });
  return row?.current?.leadAssetId === assetId;
}
