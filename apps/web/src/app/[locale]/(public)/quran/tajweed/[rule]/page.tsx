import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { quranReadRuntime } from '@/composition/quran-read';
import {
  readSlugSegment,
  tajweedLocales,
  tajweedRulePath,
  tajweedTextFor,
} from '@/components/quran/presentation';
import { quranAvailability, quranContentMetadata } from '@/components/quran/read';
import { TajweedRulePage } from '@/components/quran/works';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/tajweed/{rule}` — one public Tajweed rule.
 *
 * A RULE EXISTS IN THE LANGUAGES ITS SOURCE SUPPLIED, so its alternates are
 * exactly those interface locales and its canonical is the existing-language
 * address (ROUTE_MAP.md §9.2, §9.3). Shown in another language it says so.
 */
export const dynamic = 'force-dynamic';

interface RuleParams {
  readonly params: Promise<{ readonly locale: string; readonly rule: string }>;
}

const readRule = cache((slug: string) => quranReadRuntime().reader.tajweedRule(slug));

async function load(params: RuleParams['params']) {
  const { rule } = await params;
  const valid = readSlugSegment(rule);
  return valid === null ? null : readRule(valid);
}

export async function generateMetadata({ params }: RuleParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const rule = await load(params);
  if (rule === null) return { robots: { index: false, follow: false } };
  const contentLocales = tajweedLocales(rule);
  return quranContentMetadata(await quranAvailability(), {
    locale,
    contentLocales,
    primaryLocale: contentLocales[0] ?? locale,
    pathFor: (target) => tajweedRulePath(target, rule.slug),
    title: tajweedTextFor(rule, locale)?.text.title ?? rule.slug,
  });
}

export default async function TajweedRuleRoute({ params }: RuleParams) {
  const locale = await requireLocale(params);
  const [availability, rule] = await Promise.all([quranAvailability(), load(params)]);
  if (!availability.active || rule === null) notFound();
  return <TajweedRulePage locale={locale} availability={availability} rule={rule} />;
}
