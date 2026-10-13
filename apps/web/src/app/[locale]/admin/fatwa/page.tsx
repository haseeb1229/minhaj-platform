import { redirect } from 'next/navigation';

import { FATWA_PERMISSIONS } from '@minhaj/contracts/fatwa';

import { requireLocale } from '@/config/route-locale';
import { requireFatwaAreaPage } from './shared';

/**
 * `/{locale}/admin/fatwa` — no screen of its own. It sends the actor to the
 * first stage their keys open: intake for `question.receive`, their own drafts
 * for `fatwa.answer`, review for `fatwa.publish`. A session holding none of the
 * three gets the same 404 as any other denied administrative route.
 */
export const dynamic = 'force-dynamic';

export default async function FatwaAdminRoot({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/fatwa`;
  const context = await requireFatwaAreaPage(locale, base);
  const { authorization } = context;

  if (authorization.can(FATWA_PERMISSIONS.receive)) redirect(`${base}/questions`);
  if (authorization.can(FATWA_PERMISSIONS.answer)) redirect(`${base}/drafts`);
  redirect(`${base}/review`);
}
