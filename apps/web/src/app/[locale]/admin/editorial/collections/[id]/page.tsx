import { z } from 'zod';
import { notFound } from 'next/navigation';
import {
  COLLECTION_LIMITS,
  memberOfToken,
  type CollectionMember,
} from '@minhaj/contracts/editorial';
import { requireLocale } from '@/config/route-locale';
import { ContentEditor } from '../../content';

/**
 * The editor's unsaved member list, carried through the reference search so
 * searching again never loses it. It only ever re-seeds the editor's own list:
 * the labels are still resolved public-only and the save still decides. Any
 * malformed, repeated or excess token discards the whole list, so the editor
 * falls back to the saved revision rather than a partial one.
 */
function pendingOf(
  tokens: string | string[] | undefined,
  version: string | undefined,
): { readonly version: number; readonly members: readonly CollectionMember[] } | null {
  const parsedVersion = z.coerce.number().int().min(0).safeParse(version);
  if (version === undefined || !parsedVersion.success) return null;
  const list = tokens === undefined ? [] : Array.isArray(tokens) ? tokens : [tokens];
  if (list.length > COLLECTION_LIMITS.members || new Set(list).size !== list.length)
    return null;
  const members = list.map(memberOfToken);
  return members.every((member) => member !== null)
    ? { version: parsedVersion.data, members }
    : null;
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{
    revisionOffset?: string;
    referenceQuery?: string;
    pending?: string | string[];
    pendingVersion?: string;
  }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  if (id !== 'new' && !z.uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  return (
    <ContentEditor
      locale={locale}
      kind="collection"
      id={id}
      referenceQuery={z
        .string()
        .max(100)
        .catch('')
        .parse(query.referenceQuery ?? '')}
      revisionOffset={z.coerce
        .number()
        .int()
        .min(0)
        .max(10000000)
        .catch(0)
        .parse(query.revisionOffset)}
      pendingMembers={pendingOf(query.pending, query.pendingVersion)}
    />
  );
}
