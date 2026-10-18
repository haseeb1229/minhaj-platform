import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { TypeWords } from '@/components/membership/parts';
import { myMembershipPath } from '@/components/membership/presentation';
import {
  Container,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { membershipReadRuntime } from '@/composition/membership-read';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/membership` — what Membership is, the types open for application
 * and how an application is considered (DELIVERY_PLAN.md Phase 26;
 * DOMAIN_MODEL.md §17.2).
 *
 * AN ORGANISATIONAL RELATIONSHIP, EXPLAINED BEFORE IT IS ASKED FOR. The page
 * says what applying records, who decides, what each status means and what
 * closing an account does and does not do — and promises no outcome and no
 * response time. Reading it needs no account; applying happens in My Minhaj,
 * which this page links to and never embeds.
 *
 * PUBLISHED TYPES ONLY, through Membership's PUBLIC root. A draft or an
 * archived type does not exist here, and when nothing is published the page
 * says so in words rather than inventing a catalogue. A type described only
 * in another language is shown in that language, marked as such, with a
 * notice that it has not been translated.
 *
 * SESSION-FREE. `membershipReadRuntime()` reaches no Identity and no request;
 * the page renders identically signed in or out. `force-dynamic` because
 * operators publish and archive types; there is no per-type address and no
 * sitemap segment beyond this one page.
 */
export const dynamic = 'force-dynamic';

interface MembershipParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: MembershipParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'membership' });
  return shellMetadata({
    locale,
    route: requireRoute('membership'),
    title: t('title'),
    description: t('description'),
  });
}

const STEPS = ['apply', 'review', 'decision', 'mail', 'close'] as const;

export default async function MembershipPage({ params }: MembershipParams) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'membership' });
  const types = await membershipReadRuntime().catalogue.publishedTypes();

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-10 py-12">
        <Prose>
          <PageHeading>{t('title')}</PageHeading>
          <p>{t('intro')}</p>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('signedOut')}
          </p>
        </Prose>

        <section
          className="flex max-w-[var(--measure-prose)] flex-col gap-3"
          aria-labelledby="membership-process"
        >
          <SectionHeading>
            <span id="membership-process">{t('process.heading')}</span>
          </SectionHeading>
          <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm">
            {STEPS.map((step) => (
              <li key={step}>{t(`process.${step}`)}</li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="membership-types">
          <SectionHeading>
            <span id="membership-types">{t('types.heading')}</span>
          </SectionHeading>
          {types.length === 0 ? (
            <EmptyState>{t('types.empty')}</EmptyState>
          ) : (
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {types.map((type) => (
                <Panel key={type.id} as="li">
                  <TypeWords type={type} locale={locale} t={t} headingLevel="h3" />
                </Panel>
              ))}
            </ul>
          )}
        </section>

        <section
          className="flex max-w-[var(--measure-prose)] flex-col gap-3"
          aria-labelledby="membership-apply"
        >
          <SectionHeading>
            <span id="membership-apply">{t('cta.heading')}</span>
          </SectionHeading>
          <p className="text-sm">{t('cta.body')}</p>
          <p>
            <TextLink href={myMembershipPath(locale)}>{t('cta.link')}</TextLink>
          </p>
        </section>
      </div>
    </Container>
  );
}
