import { localizedPath } from '@minhaj/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NEWSLETTER_CONFIRMATION_HOURS } from '@minhaj/contracts/personalisation';

import {
  Breadcrumbs,
  Container,
  Field,
  Icon,
  PageHeading,
  Panel,
  SectionHeading,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';
import { subscribeNewsletter } from './actions';
import { NewsletterForm } from './newsletter-form';

/**
 * `/{locale}/newsletter` — asking for the newsletter (ROUTE_MAP.md §3.9,
 * DOMAIN_MODEL.md §14.5).
 *
 * DOUBLE OPT-IN, SAID BEFORE IT HAPPENS. The notice beside the form is the one
 * `NEWSLETTER_NOTICE_VERSION` names, and the consent evidence records that
 * version: what it says is what a subscriber agreed to. Changing its wording
 * (`newsletter.notice.*`) means a new version in the contract.
 *
 * ONE ANSWER FOR EVERY ADDRESS. Whatever the address's state — new, pending,
 * confirmed, unsubscribed or suppressed — a submission shows the same neutral
 * result, so the form cannot be used to learn who subscribes. Only malformed
 * input and a spent rate budget are told apart.
 *
 * NEWS & EVENTS PART 2 — the page around the UNCHANGED action: what the
 * newsletter will cover (the notice's own three kinds of material, and the
 * honest fact that no issue is sent yet — DELIVERY_PLAN.md Phase 21: broadcast
 * is not built), how subscribing works, the versioned notice beside the form
 * (its words unchanged), the privacy notice's address, and one neutral success
 * panel (`./newsletter-form`).
 *
 * SESSION-FREE. The page renders identically signed in or out and reads no
 * account: a subscription belongs to an address, and having an account neither
 * subscribes anyone nor is needed (§14.5). Dynamic only because the form is a
 * client island posting to a Server Action, like the correspondence forms.
 */
export const dynamic = 'force-dynamic';

interface NewsletterParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: NewsletterParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'newsletter' });

  return shellMetadata({
    locale,
    route: requireRoute('newsletter'),
    title: t('title'),
    description: t('description'),
  });
}

/** The three kinds of material the notice says the newsletter is about. */
const COVERS = [
  { key: 'news', icon: 'news' },
  { key: 'events', icon: 'calendar' },
  { key: 'material', icon: 'book' },
] as const;

export default async function NewsletterPage({ params }: NewsletterParams) {
  const locale = await requireLocale(params);
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'newsletter' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);

  return (
    <Container>
      <div className="flex flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: localizedPath(locale, ''), text: shell('nav.home') },
            { text: t('title') },
          ]}
        />
        <header className="flex max-w-3xl flex-col gap-3">
          <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
            {t('page.eyebrow')}
          </p>
          <PageHeading>{t('title')}</PageHeading>
          <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
            {t('description')}
          </p>
        </header>

        <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-16">
          <div className="flex min-w-0 flex-col gap-10">
            <section className="flex flex-col gap-5" aria-labelledby="newsletter-covers">
              <SectionHeading id="newsletter-covers">{t('page.covers')}</SectionHeading>
              <ul className="grid list-none gap-4 p-0 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                {COVERS.map((cover) => (
                  <li
                    key={cover.key}
                    className="flex min-w-0 flex-col gap-2 rounded-panel border border-border bg-surface-raised p-4"
                  >
                    <Icon name={cover.icon} size={24} className="text-accent" />
                    <h3 className="font-semibold">
                      {t(`page.cover.${cover.key}.title`)}
                    </h3>
                    <p className="text-sm text-foreground-muted">
                      {t(`page.cover.${cover.key}.body`)}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="flex max-w-[var(--measure-prose)] items-start gap-2 text-sm text-foreground-muted">
                <Icon name="info" size={16} className="mt-[0.2em] shrink-0 text-accent" />
                <span>{t('page.notYet')}</span>
              </p>
            </section>

            <section className="flex flex-col gap-5" aria-labelledby="newsletter-steps">
              <SectionHeading id="newsletter-steps">{t('page.steps')}</SectionHeading>
              <ol className="flex list-none flex-col gap-4 p-0">
                {(['enter', 'confirm', 'leave'] as const).map((step, index) => (
                  <li key={step} className="flex min-w-0 items-start gap-4">
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-accent-rule bg-accent-surface font-semibold text-accent tabular-nums"
                    >
                      {new Intl.NumberFormat(locale).format(index + 1)}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="font-semibold">
                        {t(`page.step.${step}.title`)}
                      </span>
                      <span className="text-sm text-foreground-muted">
                        {t(`page.step.${step}.body`, {
                          hours: NEWSLETTER_CONFIRMATION_HOURS,
                        })}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="min-w-0">
            <Panel>
              <div className="flex flex-col gap-5">
                <SectionHeading>{t('form.heading')}</SectionHeading>
                <section
                  className="flex flex-col gap-3"
                  aria-labelledby="newsletter-notice"
                >
                  <h3 id="newsletter-notice" className="font-semibold">
                    {t('notice.heading')}
                  </h3>
                  <ul className="flex list-disc flex-col gap-2 ps-5 text-sm">
                    <li>{t('notice.what')}</li>
                    <li>
                      {t('notice.confirm', { hours: NEWSLETTER_CONFIRMATION_HOURS })}
                    </li>
                    <li>{t('notice.unsubscribe')}</li>
                    <li>{t('notice.account')}</li>
                    <li>{t('notice.kept')}</li>
                  </ul>
                </section>
                <NewsletterForm
                  headingLevel="h3"
                  action={subscribeNewsletter}
                  labels={{
                    submit: t('form.submit'),
                    pending: t('form.pending'),
                    doneHeading: t('result.sentHeading'),
                    done: t('result.sent'),
                    again: t('result.again'),
                    failures: {
                      invalid: t('result.invalid'),
                      'rate-limited': t('result.rateLimited'),
                      unknown: t('result.unavailable'),
                    },
                  }}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <Field id="newsletter-email" label={t('form.email')}>
                    {(props) => (
                      <TextInput
                        {...props}
                        name="email"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        maxLength={320}
                        required
                      />
                    )}
                  </Field>
                </NewsletterForm>
                <p className="border-t border-border pt-4 text-sm">
                  <TextLink href={localizedPath(locale, '/legal/privacy')}>
                    {t('page.privacy')}
                  </TextLink>
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </Container>
  );
}
