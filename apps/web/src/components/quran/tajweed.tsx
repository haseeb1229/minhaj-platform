import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  isTajweedRule,
  type PublicTajweedOverlay,
  type PublicTajweedRule,
  type PublicTajweedRuleUse,
  type QuranAvailability,
  type TajweedRule,
} from '@minhaj/contracts/quran';

import { contentLanguages } from '@/composition/public-references';
import { quranReadRuntime } from '@/composition/quran-read';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData } from '@/components/media/parts';
import { Alert, PageHeading, Panel, SectionHeading, TextLink } from '@/components/ui';
import { QuranFrame, languageOf, quranTrail } from './parts';
import {
  ayahPath,
  quranPath,
  surahPath,
  tajweedLocales,
  tajweedRulePath,
  tajweedTextFor,
} from './presentation';
import { quranIndexable } from './read';
import { REFERENCE_LINKS } from './reference-sources';
import { tajweedChildren } from './scripture';
import {
  TajweedLegend,
  TajweedSwatch,
  tajweedKeyLabels,
  type TajweedKeyLabels,
} from './tajweed-key';
import { TAJWEED_FAMILIES } from './tajweed-layout';

/**
 * THE TAJWEED LEARNING HUB (Quran Part 9; ROUTE_MAP.md §3.3) — `/quran/tajweed`
 * and, for each rule a public colour overlay marks, `/quran/tajweed/{rule}`.
 *
 * EVERY RULE WITH ITS COLOUR AND REAL EXAMPLES. A rule is shown with its swatch
 * and name, how often the overlay marks it, and the SHORTEST ayat where it
 * occurs — the canonical text unchanged, only that rule's spans coloured — each
 * linked to its Ayah in the reader. Its guidance is an editor's: the Tajweed
 * rule of the same slug where one is published, and an honest "not yet"
 * otherwise. Nothing here explains a rule in words the platform's editors did
 * not write.
 *
 * SAID PLAINLY, WHEREVER THE COLOURS APPEAR: colour-coded tajweed, not yet
 * reviewed by a qari, and whose annotations they are — credited, with the
 * change made to them (re-aligned to the Tanzil text) — as CC BY 4.0 requires.
 *
 * Without a public overlay the hub is the published guidance alone, as before
 * (`./works`), and a rule's page is its guidance.
 */

/** Example ayat per rule: two on the hub, six on the rule's own page. */
const HUB_EXAMPLES = 2;
const RULE_EXAMPLES = 6;

type TajweedTranslator = Awaited<ReturnType<typeof getTranslations<'quran.tajweed'>>>;

/** One example Ayah: its text with only the rule's spans coloured, and its link. */
function Example({
  locale,
  example,
  t,
}: {
  readonly locale: Locale;
  readonly example: PublicTajweedRuleUse['examples'][number];
  readonly t: TajweedTranslator;
}) {
  const ref = { surah: example.surah, ayah: example.ayah };
  return (
    <li className="flex min-w-0 flex-col gap-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <p
        lang="ar"
        dir="rtl"
        translate="no"
        className="quran-text tajweed-colours text-[1.625rem] leading-[2.3] break-words"
      >
        {tajweedChildren(example.text, example.spans)}
      </p>
      <TextLink href={ayahPath(locale, ref)}>{t('hub.openAyah', ref)}</TextLink>
    </li>
  );
}

/** The overlay's standing, its credit and the change made to its data. */
function AboutColours({
  overlay,
  t,
}: {
  readonly overlay: PublicTajweedOverlay;
  readonly t: TajweedTranslator;
}) {
  return (
    <Panel>
      <div className="flex flex-col gap-3 text-sm">
        <SectionHeading>{t('hub.about')}</SectionHeading>
        <p className="max-w-[var(--measure-prose)]">{t('hub.aboutBody')}</p>
        {overlay.attribution === null ? null : (
          <p className="break-words text-foreground-muted" dir="ltr" lang="en">
            {overlay.attribution}
          </p>
        )}
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <li>
            <TextLink href={REFERENCE_LINKS.tajweed}>
              {t('hub.source')}: quran-tajweed
            </TextLink>
          </li>
          <li>
            <TextLink href={REFERENCE_LINKS.tajweedLicence}>
              {t('hub.licence')}: CC BY 4.0
            </TextLink>
          </li>
          <li>
            <TextLink href={REFERENCE_LINKS.tanzil}>Tanzil</TextLink>
          </li>
        </ul>
      </div>
    </Panel>
  );
}

/** A rule's swatch, its name and how often it is marked. */
function RuleHeading({
  rule,
  use,
  labels,
  t,
  href,
}: {
  readonly rule: TajweedRule;
  readonly use: PublicTajweedRuleUse | undefined;
  readonly labels: TajweedKeyLabels;
  readonly t: TajweedTranslator;
  readonly href: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="flex min-w-0 items-center gap-2.5 text-subheading font-semibold">
        <TajweedSwatch rule={rule} />
        {href === null ? (
          <span className="min-w-0 break-words">{labels.rules[rule]}</span>
        ) : (
          <TextLink href={href}>{labels.rules[rule]}</TextLink>
        )}
      </h3>
      {use === undefined ? null : (
        <p className="text-caption text-foreground-muted">
          {t('hub.uses', { ayat: use.ayat, spans: use.spans })}
        </p>
      )}
    </div>
  );
}

export async function TajweedHubPage({
  locale,
  availability,
  overlay,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly overlay: PublicTajweedOverlay;
}) {
  const reader = quranReadRuntime().reader;
  const [quran, t, labels, parts, uses, guidance, languages] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    getTranslations({ locale, namespace: 'quran.tajweed' }),
    tajweedKeyLabels(locale),
    quranTrail(locale),
    reader.tajweedRuleUses(overlay.id, HUB_EXAMPLES, null),
    reader.tajweedRules(),
    contentLanguages(),
  ]);
  const title = quran('sections.tajweed');
  const useOf = new Map(uses.rules.map((use) => [use.rule, use]));
  // Published guidance on a subject the overlay does not colour.
  const further = guidance.filter((rule) => !isTajweedRule(rule.slug));

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-4">
        <PageHeading>{title}</PageHeading>
        <p className="max-w-[var(--measure-prose)] text-lede text-foreground-muted">
          {t('hub.intro')}
        </p>
        <Alert tone="warning">{t('experimental')}</Alert>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a
            href={surahPath(locale, 1)}
            className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-semibold text-action-foreground hover:bg-action-hover"
          >
            {t('hub.read')}
          </a>
          <p className="text-sm text-foreground-muted">
            {t('hub.coverage', { ayat: uses.ayat })}
          </p>
        </div>
      </div>

      <Panel>
        <div className="tajweed-colours flex flex-col gap-4">
          <SectionHeading>{t('key')}</SectionHeading>
          <TajweedLegend labels={labels} />
        </div>
      </Panel>

      {TAJWEED_FAMILIES.map(({ family, rules }) => (
        <section
          key={family}
          aria-labelledby={`tajweed-${family}`}
          className="flex flex-col gap-4"
        >
          <SectionHeading id={`tajweed-${family}`}>
            {labels.families[family]}
          </SectionHeading>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rules.map((rule) => {
              const use = useOf.get(rule);
              return (
                <Panel key={rule} as="li">
                  <div className="flex min-w-0 flex-col gap-4">
                    <RuleHeading
                      rule={rule}
                      use={use}
                      labels={labels}
                      t={t}
                      href={tajweedRulePath(locale, rule)}
                    />
                    {use === undefined || use.examples.length === 0 ? null : (
                      <ul aria-label={t('hub.examples')} className="flex flex-col gap-3">
                        {use.examples.map((example) => (
                          <Example
                            key={`${String(example.surah)}:${String(example.ayah)}`}
                            locale={locale}
                            example={example}
                            t={t}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </Panel>
              );
            })}
          </ul>
        </section>
      ))}

      {further.length === 0 ? null : (
        <section aria-labelledby="tajweed-further" className="flex flex-col gap-4">
          <SectionHeading id="tajweed-further">{t('hub.moreGuidance')}</SectionHeading>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {further.map((rule) => {
              const shown = tajweedTextFor(rule, locale);
              if (shown === null) return null;
              const language = languageOf(languages, shown.text.languageCode);
              return (
                <Panel key={rule.slug} as="li">
                  <p
                    className="text-lg font-semibold break-words"
                    lang={language.code}
                    dir={language.direction}
                  >
                    <TextLink href={tajweedRulePath(locale, rule.slug)}>
                      {shown.text.title}
                    </TextLink>
                  </p>
                </Panel>
              );
            })}
          </ul>
        </section>
      )}

      <AboutColours overlay={overlay} t={t} />
    </QuranFrame>
  );
}

/**
 * One rule the overlay colours: its swatch and name, its guidance where an
 * editor published one (in the reader's language where it exists), how often
 * it is marked, and up to six of the shortest ayat with ONLY this rule
 * coloured.
 */
export async function TajweedRuleOverlayPage({
  locale,
  availability,
  overlay,
  rule,
  guidance,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly overlay: PublicTajweedOverlay;
  readonly rule: TajweedRule;
  readonly guidance: PublicTajweedRule | null;
}) {
  const reader = quranReadRuntime().reader;
  const [quran, t, labels, parts, uses, languages] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    getTranslations({ locale, namespace: 'quran.tajweed' }),
    tajweedKeyLabels(locale),
    quranTrail(locale),
    reader.tajweedRuleUses(overlay.id, RULE_EXAMPLES, rule),
    contentLanguages(),
  ]);
  const use = uses.rules.find((entry) => entry.rule === rule);
  const name = labels.rules[rule];
  const path = tajweedRulePath(locale, rule);
  const hub = quranPath(locale, 'tajweed');
  const shown = guidance === null ? null : tajweedTextFor(guidance, locale);
  const language = languageOf(languages, shown?.text.languageCode ?? 'und');
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: quran('sections.tajweed'), path: hub },
    { name, path },
  ];

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: name },
      ]}
    >
      <article aria-labelledby="rule-heading" className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1
            id="rule-heading"
            className="flex min-w-0 items-center gap-3 text-title font-semibold break-words"
          >
            <TajweedSwatch rule={rule} />
            <span className="min-w-0">{name}</span>
          </h1>
          {use === undefined ? null : (
            <p className="text-sm text-foreground-muted">
              {t('hub.uses', { ayat: use.ayat, spans: use.spans })}
            </p>
          )}
          <Alert tone="warning">{t('experimental')}</Alert>
        </div>

        <section aria-labelledby="rule-guidance" className="flex flex-col gap-3">
          <SectionHeading id="rule-guidance">{t('hub.guidance')}</SectionHeading>
          {shown === null ? (
            <p className="text-foreground-muted">{t('hub.noGuidance')}</p>
          ) : (
            <div
              lang={language.code}
              dir={language.direction}
              className="flex max-w-[var(--measure-prose)] flex-col gap-4"
            >
              {shown.fallback ? (
                <Alert tone="info">
                  {quran('tajweedFallback', { language: language.name })}
                </Alert>
              ) : null}
              <p className="font-semibold break-words">{shown.text.title}</p>
              {paragraphsOf(shown.text.body).map((paragraph, index) => (
                <p key={index} className="break-words">
                  {paragraph}
                </p>
              ))}
              {guidance === null || guidance.attribution === null ? null : (
                <p className="text-sm break-words text-foreground-muted" dir="auto">
                  {guidance.attribution}
                </p>
              )}
            </div>
          )}
        </section>

        {use === undefined || use.examples.length === 0 ? null : (
          <section aria-labelledby="rule-examples" className="flex flex-col gap-3">
            <SectionHeading id="rule-examples">{t('hub.examples')}</SectionHeading>
            <p className="text-caption text-foreground-muted">{t('hub.emphasised')}</p>
            <Panel>
              <ul className="flex flex-col gap-3">
                {use.examples.map((example) => (
                  <Example
                    key={`${String(example.surah)}:${String(example.ayah)}`}
                    locale={locale}
                    example={example}
                    t={t}
                  />
                ))}
              </ul>
            </Panel>
          </section>
        )}

        <AboutColours overlay={overlay} t={t} />
        <TextLink href={hub}>{t('hub.allRules')}</TextLink>
      </article>
      <BreadcrumbData
        contentLocales={
          quranIndexable(availability) && guidance !== null
            ? tajweedLocales(guidance)
            : []
        }
        trail={trail}
      />
    </QuranFrame>
  );
}
