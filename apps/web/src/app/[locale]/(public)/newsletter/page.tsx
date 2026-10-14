import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NEWSLETTER_CONFIRMATION_HOURS } from '@minhaj/contracts/personalisation';

import {
  Container,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  TextInput,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';
import { ActionForm } from '../../(identity)/form-state';
import { subscribeNewsletter } from './actions';

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

export default async function NewsletterPage({ params }: NewsletterParams) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'newsletter' });

  return (
    <Container>
      <div className="flex max-w-[var(--measure-prose)] flex-col gap-6 py-12">
        <header className="flex flex-col gap-2">
          <PageHeading>{t('title')}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">{t('description')}</p>
        </header>

        <section className="flex flex-col gap-3" aria-labelledby="newsletter-notice">
          <h2 id="newsletter-notice" className="text-lg font-semibold tracking-tight">
            {t('notice.heading')}
          </h2>
          <ul className="flex list-disc flex-col gap-2 ps-5 text-sm">
            <li>{t('notice.what')}</li>
            <li>{t('notice.confirm', { hours: NEWSLETTER_CONFIRMATION_HOURS })}</li>
            <li>{t('notice.unsubscribe')}</li>
            <li>{t('notice.account')}</li>
            <li>{t('notice.kept')}</li>
          </ul>
        </section>

        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('form.heading')}</SectionHeading>
            <ActionForm
              action={subscribeNewsletter}
              submitLabel={t('form.submit')}
              pendingLabel={t('form.pending')}
              messages={{
                success: t('result.sent'),
                invalid: t('result.invalid'),
                'rate-limited': t('result.rateLimited'),
                unknown: t('result.unavailable'),
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
            </ActionForm>
          </div>
        </Panel>
      </div>
    </Container>
  );
}
