import { getTranslations } from 'next-intl/server';

import {
  ConversationBadges,
  ConversationList,
  MessagingTime,
  UnreadBadge,
  messagingLinks,
  messagingMessages,
} from '@/components/messaging/parts';
import { conversationPath } from '@/components/messaging/presentation';
import { messagingRead } from '@/components/messaging/read';
import { PersonalFrame, PersonalLinks } from '@/components/personal/parts';
import { Alert, EmptyState, Panel, SectionHeading, TextLink } from '@/components/ui';
import { messagingRuntime } from '@/composition/messaging';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { openSupportAction } from '../actions';

/**
 * Messages → Support (INFORMATION_ARCHITECTURE.md §5; DELIVERY_PLAN.md
 * Phase 24): the signed-in person's own conversation with Minhaj Support.
 *
 * SUPPORT REUSES MESSAGING. A support conversation is a Messaging
 * conversation of its own kind — the same messages, attachments, read state
 * and reporting — not a ticket system. A person holds at most one OPEN
 * support conversation; once staff resolve it, the person may start another,
 * and the earlier ones stay readable here.
 *
 * ONE PERSON'S, AND NOBODY ELSE'S. Everything below is read as the session's
 * account; no address names another person's support conversation, and the
 * staff who answer are "Minhaj Support", never a personal name.
 *
 * This is distinct from the public `/contact` and `/feedback` forms, which are
 * Editorial correspondence and need no account.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MySupportPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(locale, `/${locale}/my/messages/support`);
  const t = await getTranslations({ locale, namespace: 'messages' });
  const actor = { accountId: session.account.id };
  const { service } = messagingRuntime();
  const timeZone = session.account.timezone;
  const back = <PersonalLinks label={t('nav.label')} links={messagingLinks(locale, t)} />;
  const description = <p>{t('support.description')}</p>;

  const read = await messagingRead('messaging-my-support', async () => {
    const capabilities = await service.capabilities();
    return capabilities.support
      ? { active: true as const, overview: await service.support(actor) }
      : { active: false as const };
  });

  if (!read.ok || !read.value.active)
    return (
      <PersonalFrame title={t('support.title')} description={description} back={back}>
        {read.ok || read.failure === 'not-found' ? (
          <Alert tone="info">{t('support.notActivated')}</Alert>
        ) : (
          <Alert tone="error">{t('failure.load')}</Alert>
        )}
        <p className="text-sm">
          {t('support.contactInstead')}{' '}
          <TextLink href={`/${locale}/contact`}>{t('support.contactLink')}</TextLink>
        </p>
      </PersonalFrame>
    );

  const { open, earlier } = read.value.overview;

  return (
    <PersonalFrame title={t('support.title')} description={description} back={back}>
      <Panel>
        <div className="flex min-w-0 flex-col gap-3">
          <SectionHeading>{t('support.openHeading')}</SectionHeading>
          {open === null ? (
            <>
              <p className="text-sm">{t('support.startHelp')}</p>
              <ActionForm
                action={openSupportAction}
                submitLabel={t('support.start')}
                pendingLabel={t('common.working')}
                messages={messagingMessages(t)}
              >
                <input type="hidden" name="locale" value={locale} />
              </ActionForm>
            </>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <UnreadBadge count={open.unread} t={t} />
                <ConversationBadges summary={open} t={t} />
                {open.lastMessageAt === null ? (
                  <span>{t('list.noMessages')}</span>
                ) : (
                  <span className="text-[color:var(--color-foreground-muted)]">
                    {t('list.lastActivity')}{' '}
                    <MessagingTime
                      value={open.lastMessageAt}
                      locale={locale}
                      timeZone={timeZone}
                    />
                  </span>
                )}
              </p>
              <p>
                <TextLink href={conversationPath('my', locale, open.id)}>
                  {t('support.continue')}
                </TextLink>
              </p>
            </>
          )}
        </div>
      </Panel>

      <section className="flex flex-col gap-3" aria-labelledby="support-earlier">
        <span id="support-earlier">
          <SectionHeading>{t('support.earlierHeading')}</SectionHeading>
        </span>
        {earlier.length === 0 ? (
          <EmptyState>{t('support.earlierEmpty')}</EmptyState>
        ) : (
          <ConversationList
            conversations={earlier}
            surface="my"
            names={new Map()}
            courses={new Map()}
            locale={locale}
            timeZone={timeZone}
            t={t}
          />
        )}
      </section>
    </PersonalFrame>
  );
}
