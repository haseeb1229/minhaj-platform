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
import { isTajweedRule, type TajweedRule } from '@minhaj/contracts/quran';

import {
  quranAvailability,
  quranContentMetadata,
  quranMetadata,
  readTajweedOverlays,
} from '@/components/quran/read';
import { TajweedRuleOverlayPage } from '@/components/quran/tajweed';
import { tajweedKeyLabels } from '@/components/quran/tajweed-key';
import { TajweedRulePage } from '@/components/quran/works';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/tajweed/{rule}` — one Tajweed rule. A rule a public colour
 * overlay marks (Quran Part 9) is shown with its colour, its guidance where
 * one is published, and real examples; any other published rule is its
 * guidance alone.
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

type PublicOverlay = Awaited<ReturnType<typeof readTajweedOverlays>>[number];

/** The overlay rule this address names, with the public overlay, or null. */
async function loadColoured(
  params: RuleParams['params'],
): Promise<{ readonly rule: TajweedRule; readonly overlay: PublicOverlay } | null> {
  const { rule } = await params;
  if (!isTajweedRule(rule)) return null;
  const [overlay] = await readTajweedOverlays();
  return overlay === undefined ? null : { rule, overlay };
}

export async function generateMetadata({ params }: RuleParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const coloured = await loadColoured(params);
  if (coloured !== null)
    return quranMetadata({
      locale,
      availability: await quranAvailability(),
      canonicalPath: `/quran/tajweed/${coloured.rule}`,
      title: (await tajweedKeyLabels(locale)).rules[coloured.rule],
    });
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
  const [availability, coloured, rule] = await Promise.all([
    quranAvailability(),
    loadColoured(params),
    load(params),
  ]);
  if (!availability.active) notFound();
  if (coloured !== null)
    return (
      <TajweedRuleOverlayPage
        locale={locale}
        availability={availability}
        overlay={coloured.overlay}
        rule={coloured.rule}
        guidance={rule}
      />
    );
  if (rule === null) notFound();
  return <TajweedRulePage locale={locale} availability={availability} rule={rule} />;
}
