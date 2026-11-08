import { localizedPath } from '@minhaj/contracts';
import { getFormatter, getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { readPresence } from '@/composition/presence';
import { publicIndexingEnabled } from '@/config/indexing';
import { requireLocale } from '@/config/route-locale';
import { hasSignal } from '@/shell/presence';
import { notFound, redirect } from 'next/navigation';
import {
  Alert,
  Badge,
  CardGrid,
  LinkCard,
  PageHeading,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { dashboardQueues, type QueueCard } from './dashboard';
import { groupedSurfaces, reachableSurfaces } from './surfaces';

/**
 * The administrative landing page — QUEUE FIRST (R2, audit F28).
 *
 * It opens on what is waiting: one count per queue the caller can act in,
 * each a link to that queue already filtered, counted by the area's own
 * service (`./dashboard`). Beside it, the latest recorded activity for a
 * holder of `audit.read`, and the platform's switches as a visitor meets them
 * — which public services are on, and whether search engines may index.
 * Below, every area the caller may open, grouped by purpose.
 *
 * It composes what the CALLER may actually reach, and nothing else. A dashboard
 * that listed every surface and let the unreachable ones 404 would be a map of
 * the platform's privileged shape handed to anyone with an account
 * (SECURITY_BASELINE.md §1.5). Its policy is the union of the delivered
 * administrative read permissions — the SAME list the shell's navigation is
 * filtered from (`./surfaces`). An account holding none receives the same 404
 * as any other denied admin route.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** The platform switches the dashboard reports. */
type StatusKey =
  'quran' | 'hadith' | 'fatwa' | 'live' | 'giving' | 'membership' | 'indexing';

/** How many audit rows the dashboard shows. */
const RECENT_ACTIVITY = 6;

export default async function AdminDashboard({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const format = await getFormatter({ locale });

  const active = await requireOwnSession(locale);
  if (active === null) {
    redirect(
      localizedPath(
        locale,
        `/signin?returnTo=${encodeURIComponent(localizedPath(locale, '/admin'))}`,
      ),
    );
  }

  const { authorization, privilegedSecurity, administration } = identityRuntime();
  const held = (await authorization.evaluate(active.session)).permissions;
  const reachable = reachableSurfaces(held);
  if (reachable.length === 0) notFound();

  const actor = { accountId: active.session.account.id };
  const [posture, queues, recent, presence] = await Promise.all([
    privilegedSecurity.describe(actor.accountId),
    dashboardQueues(actor, held),
    held.has('audit.read')
      ? administration.listAuditRecords({
          action: null,
          actorId: null,
          from: null,
          to: null,
          limit: RECENT_ACTIVITY,
          offset: 0,
        })
      : null,
    readPresence(),
  ]);

  const status: readonly {
    readonly key: StatusKey;
    readonly value: string;
  }[] = [
    {
      key: 'quran',
      value: hasSignal(presence, 'quranReference')
        ? t('home.status.quranReference')
        : hasSignal(presence, 'quran')
          ? t('home.status.quranApproved')
          : t('home.status.off'),
    },
    ...(['hadith', 'fatwa', 'live', 'giving', 'membership'] as const).map((signal) => ({
      key: signal,
      value: hasSignal(presence, signal) ? t('home.status.on') : t('home.status.off'),
    })),
    {
      key: 'indexing',
      value: publicIndexingEnabled()
        ? t('home.status.indexingOn')
        : t('home.status.indexingOff'),
    },
  ];

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('nav.dashboard')}</PageHeading>
        <p className="text-foreground-muted">{t('home.description')}</p>
      </header>

      {/*
       * The one thing a freshly bootstrapped administrator most needs to be
       * told, said before anything else: the role is held, and no privileged
       * change will work until the second factor and its recovery codes are
       * finished (SECURITY_BASELINE.md §8.3).
       */}
      {posture.complete ? null : (
        <Alert tone="warning">
          {t('denied.secondFactorRequired')}{' '}
          <TextLink href={localizedPath(locale, '/my/settings/security')}>
            {t('security.manage')}
          </TextLink>
        </Alert>
      )}

      {queues.length === 0 ? null : (
        <section aria-labelledby="queues-heading" className="flex flex-col gap-3">
          <h2 id="queues-heading" className="text-lg font-semibold">
            {t('home.queues.title')}
          </h2>
          <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {queues.map((queue) => (
              <QueueTile
                key={queue.key}
                queue={queue}
                href={localizedPath(locale, `/admin/${queue.path}`)}
                label={t(`home.queues.${queue.key}`)}
                value={
                  queue.count === null
                    ? null
                    : queue.count.more
                      ? t('home.queues.more', { count: queue.count.count })
                      : format.number(queue.count.count)
                }
                waiting={t('home.queues.waiting')}
                none={t('home.queues.none')}
                unavailable={t('home.queues.unavailable')}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {recent === null ? null : (
          <section
            aria-labelledby="activity-heading"
            className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
          >
            <SectionHeading id="activity-heading">
              {t('home.activity.title')}
            </SectionHeading>
            {recent.items.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('home.activity.empty')}</p>
            ) : (
              <ol className="flex list-none flex-col divide-y divide-border p-0">
                {recent.items.map((record) => (
                  <li
                    key={record.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                  >
                    <code className="min-w-0 text-xs break-all">{record.action}</code>
                    <time
                      dateTime={record.occurredAt.toISOString()}
                      className="text-xs text-foreground-muted tabular-nums"
                    >
                      {format.dateTime(record.occurredAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-sm">
              <TextLink href={localizedPath(locale, '/admin/system/audit')}>
                {t('home.activity.all')}
              </TextLink>
            </p>
          </section>
        )}

        <section
          aria-labelledby="status-heading"
          className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
        >
          <SectionHeading id="status-heading">{t('home.status.title')}</SectionHeading>
          <dl className="flex flex-col divide-y divide-border">
            {status.map((entry) => (
              <div
                key={entry.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
              >
                <dt className="text-sm">{t(`home.status.${entry.key}`)}</dt>
                <dd className="text-sm font-semibold">{entry.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-foreground-muted">{t('home.status.note')}</p>
        </section>
      </div>

      <section aria-labelledby="areas-heading" className="flex flex-col gap-6">
        <h2 id="areas-heading" className="text-lg font-semibold">
          {t('home.areas')}
        </h2>
        {groupedSurfaces(reachable).map(({ group, surfaces }) => (
          <section key={group} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground-muted">
              {t(`groups.${group}`)}
            </h3>
            <CardGrid columns={3}>
              {surfaces.map((surface) => (
                <LinkCard
                  key={surface.key}
                  href={localizedPath(locale, `/admin/${surface.path}`)}
                  title={t(`nav.${surface.key}`)}
                  description={t(`summary.${surface.key}`)}
                />
              ))}
            </CardGrid>
          </section>
        ))}
      </section>
    </main>
  );
}

/**
 * One queue: its count as the figure, what it counts, and a link to the queue
 * itself. A queue with work in it is marked in words (a "Waiting" badge) as
 * well as by its accent border; an empty one is quiet; an unanswered read says so.
 */
function QueueTile({
  queue,
  href,
  label,
  value,
  waiting,
  none,
  unavailable,
}: {
  readonly queue: QueueCard;
  readonly href: string;
  readonly label: string;
  /** The formatted count, or `null` when the area did not answer. */
  readonly value: string | null;
  readonly waiting: string;
  readonly none: string;
  readonly unavailable: string;
}) {
  const busy = queue.count !== null && (queue.count.count > 0 || queue.count.more);
  return (
    <li className="min-w-0">
      <a
        href={href}
        className={`flex h-full min-h-24 flex-col gap-1.5 rounded-panel border bg-surface-raised p-4 no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken ${
          busy ? 'border-accent-rule' : 'border-border'
        }`}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={`font-serif text-title leading-none font-semibold tabular-nums ${
              busy ? 'text-foreground' : 'text-foreground-muted'
            }`}
          >
            {value ?? '—'}
          </span>
          {busy ? (
            <Badge kind="status" tone="accent">
              {waiting}
            </Badge>
          ) : (
            <span className="text-xs font-semibold text-foreground-muted">
              {value === null ? unavailable : none}
            </span>
          )}
        </span>
        <span className="text-sm text-foreground">{label}</span>
      </a>
    </li>
  );
}
