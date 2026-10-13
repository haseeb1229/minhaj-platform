import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FatwaRulingPage } from '@/components/fatwa/detail';
import { readRulingSegment } from '@/components/fatwa/presentation';
import { fatwaAvailability, readFatwa, rulingMetadata } from '@/components/fatwa/read';
import { requireLocale } from '@/config/route-locale';
import { ReadBeacon } from '../read-beacon';

/**
 * `/{locale}/fatwa/{slug}` — THE CANONICAL PUBLISHED RULING (ROUTE_MAP.md §2.1,
 * §3.8), and the only Fatwa entity address.
 *
 * ONE CONTENT LANGUAGE. A ruling is written in one language, so its canonical
 * is that language's address and it lists no alternate it does not have; shown
 * under another interface locale it says which language it is in (§9.3). A
 * ruling in a language that is not an interface locale claims no canonical at
 * all.
 *
 * THE METADATA IS THE PUBLISHED RULING'S, NEVER A QUESTION'S. The title is the
 * ruling's title and the description the opening of the separately written,
 * anonymised public question; nothing private is reachable from this page.
 *
 * A READ IS COUNTED AFTER RENDER, BY POST. `ReadBeacon` calls a Server Action
 * once the page has mounted; this GET changes nothing.
 *
 * A slug that is not public now — never published, withdrawn, or the service
 * inactive — and any malformed slug is a 404. A slug can never be one of the
 * section's own path words, so this route never shadows a section page.
 */
export const dynamic = 'force-dynamic';

interface RulingParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

async function load(params: RulingParams['params']) {
  const { slug } = await params;
  const valid = readRulingSegment(slug);
  return valid === null ? null : readFatwa(valid);
}

export async function generateMetadata({ params }: RulingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const fatwa = await load(params);
  if (fatwa === null) return { robots: { index: false, follow: false } };
  return rulingMetadata(locale, await fatwaAvailability(), fatwa);
}

export default async function FatwaRulingRoute({ params }: RulingParams) {
  const locale = await requireLocale(params);
  // A malformed or reserved segment names no ruling whatever the service's
  // state: `/fatwa/latest` and `/fatwa/popular` are not paths (ROUTE_MAP.md
  // §2.3), so they are a 404 even while the service is inactive.
  if (readRulingSegment((await params).slug) === null) notFound();
  const availability = await fatwaAvailability();
  // A named ruling while the service is inactive is absent, not "unavailable":
  // there is no ruling to describe (the section pages say the service is off).
  if (!availability.active) notFound();
  const fatwa = await load(params);
  if (fatwa === null) notFound();
  return (
    <>
      <FatwaRulingPage locale={locale} availability={availability} fatwa={fatwa} />
      <ReadBeacon slug={fatwa.slug} />
    </>
  );
}
