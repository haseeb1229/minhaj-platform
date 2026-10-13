import { getTranslations } from 'next-intl/server';

import { FATWA_LIMITS } from '@minhaj/contracts/fatwa';

import { fatwaRuntime } from '@/composition/fatwa';
import { Alert, Field, PageHeading, Panel, TextArea, TextLink } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { submitFatwaQuestion } from './actions';

/**
 * Ask a question — Fatwa-owned, authenticated (ROUTE_MAP.md §5.1).
 *
 * THE PRIVACY TERMS COME BEFORE THE BOX. Who can read the question, that it is
 * never published as written, that a separate anonymised question is written
 * if it is answered, and that no response time is promised — all said before
 * anything is typed.
 *
 * NOTHING IS ASKED FOR WHILE THE SERVICE IS INACTIVE. No form is rendered at
 * all, so no sensitive text can be typed into a service nobody is authorised
 * to answer; the action and the database refuse it again regardless.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function AskQuestionPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  await requireActiveSession(locale, `/${locale}/my/questions/ask`);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const availability = await fatwaRuntime().ask.availability();
  const limits = { min: FATWA_LIMITS.questionMin, max: FATWA_LIMITS.questionMax };

  return (
    <main className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('ask.title')}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">{t('ask.intro')}</p>
      </header>

      {availability.active ? (
        <>
          <section className="flex flex-col gap-2" aria-labelledby="ask-privacy">
            <h2 id="ask-privacy" className="text-lg font-semibold">
              {t('ask.privacy.heading')}
            </h2>
            <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
              <li>{t('ask.privacy.who')}</li>
              <li>{t('ask.privacy.never')}</li>
              <li>{t('ask.privacy.anonymised')}</li>
              <li>{t('ask.privacy.noPromise')}</li>
            </ul>
          </section>

          <Panel>
            <ActionForm
              action={submitFatwaQuestion}
              submitLabel={t('ask.submit')}
              pendingLabel={t('ask.pending')}
              preserveInput
              messages={{
                inactive: t('ask.failure.inactive'),
                invalid: t('ask.failure.invalid', limits),
                'rate-limited': t('ask.failure.rateLimited'),
                'no-session': t('ask.failure.noSession'),
                unavailable: t('ask.failure.unavailable'),
                unknown: t('ask.failure.unavailable'),
              }}
            >
              <input type="hidden" name="locale" value={locale} />
              <Field
                id="question-body"
                label={t('ask.label')}
                help={t('ask.help', limits)}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name="body"
                    rows={10}
                    minLength={FATWA_LIMITS.questionMin}
                    maxLength={FATWA_LIMITS.questionMax}
                    dir="auto"
                    required
                  />
                )}
              </Field>
            </ActionForm>
          </Panel>
        </>
      ) : (
        <Alert tone="info">{t('ask.unavailable')}</Alert>
      )}

      <nav className="flex flex-col gap-2" aria-label={t('my.title')}>
        <TextLink href={`/${locale}/my/questions`}>{t('my.back')}</TextLink>
        <TextLink href={`/${locale}/fatwa/how-it-works`}>
          {t('sections.howItWorks')}
        </TextLink>
      </nav>
    </main>
  );
}
