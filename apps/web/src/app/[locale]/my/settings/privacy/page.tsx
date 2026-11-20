import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { refusalMessages } from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import {
  Alert,
  Icon,
  Panel,
  SectionHeading,
  StatusBadge,
  TextLink,
} from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { myTabs, myTrail } from '@/components/my/sections';
import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
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
 * Learning's own export (Phase 22), from its own handler, and "Download your
 * messaging data" is Messaging's (Phase 24), from its own, and "Download your
 * membership data" is Membership's (Phase 26), from its own, and "Download
 * your donation data" is Donations' (Phase 27), from its own, so no document
 * claims what another context keeps. Closing the account is Identity's,
 * on its own page behind its own password check: this page explains what
 * closing removes and links there, and builds no second closure form. The
 * newsletter is not the account's at all (DOMAIN_MODEL.md §14.5).
 *
 * NO LEGAL CLAIM. The page describes what the platform does; it does not say
 * which jurisdiction's rules that satisfies.
 *
 * MY MINHAJ PART 1: the trail, an index of the page's parts, and the five
 * downloads gathered under one "Download your data" heading as one card each
 * — what the file holds, what closing the account does to it, and the link to
 * that owner's OWN export handler, unchanged. The history switch, clearing,
 * the closure hand-off and the newsletter note keep their guarantees exactly.
 */

/** Each export: its owner's handler and its words (`personal.privacy.*`). */
const EXPORTS = [
  {
    key: 'personal',
    href: '/api/my/export',
    heading: 'exportHeading',
    body: 'exportBody',
    contents: ['exportSaved', 'exportHistory', 'exportSettings', 'exportNotifications'],
    note: 'exportScope',
    link: 'exportLink',
  },
  {
    key: 'learning',
    href: '/api/my/export/learning',
    heading: 'learningExportHeading',
    body: 'learningExportBody',
    contents: ['learningExportContents'],
    note: null,
    link: 'learningExportLink',
  },
  {
    key: 'messaging',
    href: '/api/my/export/messaging',
    heading: 'messagingExportHeading',
    body: 'messagingExportBody',
    contents: ['messagingExportContents'],
    note: 'messagingExportClosure',
    link: 'messagingExportLink',
  },
  {
    key: 'membership',
    href: '/api/my/export/membership',
    heading: 'membershipExportHeading',
    body: 'membershipExportBody',
    contents: ['membershipExportContents'],
    note: 'membershipExportClosure',
    link: 'membershipExportLink',
  },
  {
    key: 'donations',
    href: '/api/my/export/donations',
    heading: 'donationsExportHeading',
    body: 'donationsExportBody',
    contents: ['donationsExportContents'],
    note: 'donationsExportClosure',
    link: 'donationsExportLink',
  },
] as const;
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'privacy');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function PrivacyPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(
    locale,
    localizedPath(locale, '/my/settings/privacy'),
  );
  const t = await getTranslations({ locale, namespace: 'personal' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const tabs = {
    label: my('tabs.label.settings'),
    items: myTabs(locale, 'settings', 'privacy', (tab) => my(`tabs.${tab}`)),
  };
  const read = await personalRead('personal-privacy', () =>
    personalisationRuntime().settings.settings({ accountId: session.account.id }),
  );

  return (
    <MyPage
      tabs={tabs}
      measure="reading"
      title={t('privacy.title')}
      description={
        <>
          <p>{t('privacy.description')}</p>
          <p className="text-sm">{t('privacy.noLegalClaim')}</p>
        </>
      }
      trail={{
        label: my('trail.label'),
        crumbs: myTrail(locale, my('trail.home'), [
          { path: '/settings/profile', text: my('trail.settings') },
          { text: t('privacy.title') },
        ]),
      }}
    >
      <nav aria-label={my('settings.privacy.index')}>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {(
            [
              ['privacy-history', t('privacy.historyHeading')],
              ['privacy-downloads', my('settings.privacy.downloads')],
              ['privacy-closure', t('privacy.closureHeading')],
              ['privacy-newsletter', t('privacy.newsletterHeading')],
            ] as const
          ).map(([id, text]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="inline-flex min-h-11 items-center font-semibold text-action underline-offset-4 hover:underline"
              >
                {text}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* ---- History ----------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="privacy-history">
        <span id="privacy-history">
          <SectionHeading>{t('privacy.historyHeading')}</SectionHeading>
        </span>
        <p className="text-sm text-foreground-muted">{t('privacy.historyHelp')}</p>
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
              <TextLink href={localizedPath(locale, '/my/history/reading')}>
                {t('nav.reading')}
              </TextLink>
              {' · '}
              <TextLink href={localizedPath(locale, '/my/history/watch')}>
                {t('nav.watch')}
              </TextLink>
            </p>
          </Panel>
        )}
      </section>

      <ClearHistory locale={locale} t={t} />

      {/* ---- Downloads --------------------------------------------------- */}

      <section className="flex flex-col gap-4" aria-labelledby="privacy-downloads">
        <span id="privacy-downloads">
          <SectionHeading>{my('settings.privacy.downloads')}</SectionHeading>
        </span>
        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {my('settings.privacy.downloadsIntro')}
        </p>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {EXPORTS.map((entry) => (
            <li key={entry.key} className="min-w-0">
              <section
                aria-labelledby={`privacy-${entry.key}-export`}
                className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
              >
                <h3
                  id={`privacy-${entry.key}-export`}
                  className="flex items-center gap-2 text-subheading font-semibold"
                >
                  <Icon name="download" size={20} className="shrink-0 text-accent" />
                  {t(`privacy.${entry.heading}`)}
                </h3>
                <p className="text-sm">{t(`privacy.${entry.body}`)}</p>
                <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
                  {entry.contents.map((key) => (
                    <li key={key}>{t(`privacy.${key}`)}</li>
                  ))}
                </ul>
                {entry.note === null ? null : (
                  <p className="text-sm text-foreground-muted">
                    {t(`privacy.${entry.note}`)}
                  </p>
                )}
                <p>
                  <a
                    href={entry.href}
                    download
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-sunken"
                  >
                    <Icon name="download" size={16} />
                    {t(`privacy.${entry.link}`)}
                  </a>
                </p>
              </section>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Account closure --------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="privacy-closure">
        <span id="privacy-closure">
          <SectionHeading>{t('privacy.closureHeading')}</SectionHeading>
        </span>
        <p className="text-sm">{t('privacy.closureBody')}</p>
        <p>
          <TextLink href={localizedPath(locale, '/my/settings/security#close-heading')}>
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
          <TextLink href={localizedPath(locale, '/newsletter')}>
            {t('privacy.newsletterLink')}
          </TextLink>
        </p>
      </section>
    </MyPage>
  );
}
