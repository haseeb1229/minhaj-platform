import { getTranslations } from 'next-intl/server';

import { settingsLinks } from '@/components/personal/nav';
import {
  PersonalFrame,
  PersonalLinks,
  refusalMessages,
} from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import { Alert, Panel, SectionHeading, StatusBadge, TextLink } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { ClearHistory } from '../../history/shared';
import { setHistoryAction } from './actions';

/**
 * Privacy — composed at Layer 4 over each owner (ROUTE_MAP.md §5.1; Phase 21).
 *
 * WHAT IS HERE, AND WHOSE IT IS. The history switch and clearing are
 * Personalisation's. "Download my data" is Personalisation's export of what it
 * keeps for this account — and only that; it is fetched by the private export
 * handler, never rendered into this page. "Download your learning data" is
 * Learning's own export (Phase 22), from its own handler, so neither document
 * claims what the other context keeps. Closing the account is Identity's,
 * on its own page behind its own password check: this page explains what
 * closing removes and links there, and builds no second closure form. The
 * newsletter is not the account's at all (DOMAIN_MODEL.md §14.5).
 *
 * NO LEGAL CLAIM. The page describes what the platform does; it does not say
 * which jurisdiction's rules that satisfies.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function PrivacyPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(locale, `/${locale}/my/settings/privacy`);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const read = await personalRead('personal-privacy', () =>
    personalisationRuntime().settings.settings({ accountId: session.account.id }),
  );
  const back = <PersonalLinks label={t('nav.label')} links={settingsLinks(locale, t)} />;

  return (
    <PersonalFrame
      title={t('privacy.title')}
      description={
        <>
          <p>{t('privacy.description')}</p>
          <p className="text-sm">{t('privacy.noLegalClaim')}</p>
        </>
      }
      back={back}
    >
      {/* ---- History ----------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="privacy-history">
        <span id="privacy-history">
          <SectionHeading>{t('privacy.historyHeading')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('privacy.historyHelp')}
        </p>
        {!read.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : (
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p>
                <StatusBadge tone={read.value.historyEnabled ? 'positive' : 'neutral'}>
                  {read.value.historyEnabled
                    ? t('privacy.historyOn')
                    : t('privacy.historyOff')}
                </StatusBadge>
              </p>
              <ActionForm
                action={setHistoryAction}
                submitLabel={
                  read.value.historyEnabled ? t('privacy.turnOff') : t('privacy.turnOn')
                }
                pendingLabel={t('common.working')}
                tone="secondary"
                messages={refusalMessages(t, { conflict: t('privacy.conflict') })}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="version" value={read.value.version} />
                <input
                  type="hidden"
                  name="enabled"
                  value={read.value.historyEnabled ? 'false' : 'true'}
                />
              </ActionForm>
            </div>
            <p className="mt-3 text-sm">
              <TextLink href={`/${locale}/my/history/reading`}>
                {t('nav.reading')}
              </TextLink>
              {' · '}
              <TextLink href={`/${locale}/my/history/watch`}>{t('nav.watch')}</TextLink>
            </p>
          </Panel>
        )}
      </section>

      <ClearHistory locale={locale} t={t} />

      {/* ---- Export ------------------------------------------------------ */}

      <section className="flex flex-col gap-3" aria-labelledby="privacy-export">
        <span id="privacy-export">
          <SectionHeading>{t('privacy.exportHeading')}</SectionHeading>
        </span>
        <p className="text-sm">{t('privacy.exportBody')}</p>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
          <li>{t('privacy.exportSaved')}</li>
          <li>{t('privacy.exportHistory')}</li>
          <li>{t('privacy.exportSettings')}</li>
          <li>{t('privacy.exportNotifications')}</li>
        </ul>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('privacy.exportScope')}
        </p>
        <p>
          <a
            href="/api/my/export"
            download
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--color-surface-sunken)]"
          >
            {t('privacy.exportLink')}
          </a>
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="privacy-learning-export">
        <span id="privacy-learning-export">
          <SectionHeading>{t('privacy.learningExportHeading')}</SectionHeading>
        </span>
        <p className="text-sm">{t('privacy.learningExportBody')}</p>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
          <li>{t('privacy.learningExportContents')}</li>
        </ul>
        <p>
          <a
            href="/api/my/export/learning"
            download
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--color-surface-sunken)]"
          >
            {t('privacy.learningExportLink')}
          </a>
        </p>
      </section>

      {/* ---- Account closure --------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="privacy-closure">
        <span id="privacy-closure">
          <SectionHeading>{t('privacy.closureHeading')}</SectionHeading>
        </span>
        <p className="text-sm">{t('privacy.closureBody')}</p>
        <p>
          <TextLink href={`/${locale}/my/settings/security#close-heading`}>
            {t('privacy.closureLink')}
          </TextLink>
        </p>
      </section>

      {/* ---- Newsletter -------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="privacy-newsletter">
        <span id="privacy-newsletter">
          <SectionHeading>{t('privacy.newsletterHeading')}</SectionHeading>
        </span>
        <p className="text-sm">{t('privacy.newsletterBody')}</p>
        <p>
          <TextLink href={`/${locale}/newsletter`}>
            {t('privacy.newsletterLink')}
          </TextLink>
        </p>
      </section>
    </PersonalFrame>
  );
}
