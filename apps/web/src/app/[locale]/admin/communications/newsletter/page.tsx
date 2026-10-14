import { getFormatter, getTranslations } from 'next-intl/server';

import {
  NEWSLETTER_PERMISSIONS,
  NEWSLETTER_STATES,
  PERSONAL_LIMITS,
  type NewsletterAdminEntry,
  type NewsletterState,
} from '@minhaj/contracts/personalisation';

import { requireAdminPage } from '@/composition/authorization';
import { personalisationRuntime } from '@/composition/personalisation';
import { requireLocale } from '@/config/route-locale';
import {
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  FilterLink,
  PageHeading,
  Panel,
  SectionHeading,
  StatusBadge,
  TextLink,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { adminCopy, queryValue } from '../../shared';
import { reinstateNewsletterSubscriber, suppressNewsletterSubscriber } from './actions';

/**
 * Newsletter subscribers — states and consent dates (ROUTE_MAP.md §7:
 * `/admin/communications/newsletter`), Phase 21, under `newsletter.read`.
 *
 * WHAT IS NOT ON THIS PAGE. No full address: a held address is masked to its
 * first character and domain by the adapter, and one that has left is not
 * held at all, only a keyed digest. No campaign, no sending, no export of the
 * list. And nothing of anyone's account — the newsletter is independent of
 * User (DOMAIN_MODEL.md §14.5), so `newsletter.read` opens no saved item,
 * note, history or notification.
 *
 * TWO ACTS, under `newsletter.operate` and re-checked by each action:
 * suppress, and reinstate a suppression back to `unsubscribed`. Provider
 * bounce and complaint suppression is a different mechanism, owned by outbound
 * mail delivery and counted on its own page; it overrides anything here.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Query = Record<string, string | string[] | undefined>;

/** The requested offset, or 0. The service bounds it again. */
function offsetFrom(query: Query): number {
  const raw = queryValue(query, 'offset');
  return raw !== null && /^[0-9]{1,5}$/.test(raw) ? Number(raw) : 0;
}

function tone(state: NewsletterState): 'neutral' | 'positive' | 'caution' {
  if (state === 'confirmed') return 'positive';
  if (state === 'suppressed') return 'caution';
  return 'neutral';
}

export default async function NewsletterAdminPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/communications/newsletter`;

  const page = await requireAdminPage(locale, NEWSLETTER_PERMISSIONS.read, base);
  const t = await getTranslations({ locale, namespace: 'newsletter.admin' });
  const format = await getFormatter({ locale });
  const copy = await adminCopy(locale);

  const requested = queryValue(query, 'state');
  const state = NEWSLETTER_STATES.find((entry) => entry === requested) ?? null;

  const actor = { accountId: page.session.account.id };
  const { newsletter } = personalisationRuntime();
  const [counts, listed] = await Promise.all([
    newsletter.counts(actor),
    newsletter.list(actor, state, offsetFrom(query)),
  ]);

  const mayOperate = page.authorization.can(NEWSLETTER_PERMISSIONS.operate);
  const mayReadDelivery = page.authorization.can('delivery.read');
  const total = NEWSLETTER_STATES.reduce((sum, entry) => sum + counts[entry], 0);

  const href = (filter: NewsletterState | null, offset: number): string => {
    const search = new URLSearchParams();
    if (filter !== null) search.set('state', filter);
    if (offset > 0) search.set('offset', String(offset));
    const suffix = search.toString();
    return suffix === '' ? base : `${base}?${suffix}`;
  };

  const size = listed.items.length;
  const previous =
    listed.offset > 0 ? Math.max(0, listed.offset - PERSONAL_LIMITS.page) : null;
  const next =
    size > 0 && listed.offset + size < listed.total ? listed.offset + size : null;

  const messages = {
    ...copy.messages,
    denied: t('refused.denied'),
    'not-found': t('refused.notFound'),
    conflict: t('refused.conflict'),
    invalid: t('refused.invalid'),
    'invalid-state': t('refused.invalidState'),
    'confirm-required': t('refused.confirmRequired'),
    'rate-limited': t('refused.rateLimited'),
    unavailable: t('unknown'),
    unknown: t('unknown'),
  };

  const when = (value: string | null) =>
    value === null ? (
      <span className="text-xs text-[color:var(--color-foreground-muted)]">—</span>
    ) : (
      format.dateTime(new Date(value), { dateStyle: 'short', timeStyle: 'short' })
    );

  const operation = (entry: NewsletterAdminEntry) =>
    entry.state === 'suppressed' ? (
      <ActionForm
        action={reinstateNewsletterSubscriber}
        submitLabel={t('reinstate.submit')}
        pendingLabel={t('pending')}
        tone="secondary"
        messages={{ ...messages, success: t('reinstate.done') }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="subscriberId" value={entry.id} />
        <input type="hidden" name="expectedVersion" value={entry.version} />
        <p className="text-xs text-[color:var(--color-foreground-muted)]">
          {t('reinstate.explain')}
        </p>
        <Confirm id={`reinstate-${entry.id}`} label={t('reinstate.confirm')} />
      </ActionForm>
    ) : (
      <ActionForm
        action={suppressNewsletterSubscriber}
        submitLabel={t('suppress.submit')}
        pendingLabel={t('pending')}
        tone="destructive"
        messages={{ ...messages, success: t('suppress.done') }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="subscriberId" value={entry.id} />
        <input type="hidden" name="expectedVersion" value={entry.version} />
        <Confirm id={`suppress-${entry.id}`} label={t('suppress.confirm')} />
      </ActionForm>
    );

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('description')}
        </p>
      </header>

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('scope.heading')}</SectionHeading>
          <ul className="flex list-disc flex-col gap-2 ps-5 text-sm">
            <li>{t('scope.noSending')}</li>
            <li>
              {t('scope.provider')}{' '}
              {mayReadDelivery ? (
                <TextLink href={`/${locale}/admin/communications/delivery`}>
                  {t('scope.providerLink')}
                </TextLink>
              ) : null}
            </li>
            <li>{t('scope.private')}</li>
          </ul>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('counts')}</SectionHeading>
          <dl className="flex flex-wrap gap-x-8">
            {NEWSLETTER_STATES.map((entry) => (
              <DetailRow key={entry} term={t(`states.${entry}`)}>
                {counts[entry]}
              </DetailRow>
            ))}
            <DetailRow term={t('total')}>{total}</DetailRow>
          </dl>
        </div>
      </Panel>

      <nav className="flex flex-wrap gap-2" aria-label={t('filter')}>
        <FilterLink href={href(null, 0)} current={state === null}>
          {t('all')}
        </FilterLink>
        {NEWSLETTER_STATES.map((entry) => (
          <FilterLink key={entry} href={href(entry, 0)} current={state === entry}>
            {t(`states.${entry}`)}
          </FilterLink>
        ))}
      </nav>

      {size === 0 ? (
        <EmptyState>{t('none')}</EmptyState>
      ) : (
        <Panel>
          <DataTable
            caption={t('showing', {
              from: listed.offset + 1,
              to: listed.offset + size,
              total: listed.total,
            })}
            columns={[
              t('columns.address'),
              t('columns.state'),
              t('columns.locale'),
              t('columns.submitted'),
              t('columns.confirmed'),
              t('columns.ended'),
              ...(mayOperate ? [t('columns.actions')] : []),
            ]}
          >
            {listed.items.map((entry) => (
              <DataRow key={entry.id}>
                <DataCell>
                  {entry.maskedEmail === null ? (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">{t('noAddress')}</span>
                    </>
                  ) : (
                    <bdi>{entry.maskedEmail}</bdi>
                  )}
                </DataCell>
                <DataCell>
                  <StatusBadge tone={tone(entry.state)}>
                    {t(`states.${entry.state}`)}
                  </StatusBadge>
                </DataCell>
                <DataCell>{t(`locales.${entry.locale}`)}</DataCell>
                <DataCell>{when(entry.submittedAt)}</DataCell>
                <DataCell>{when(entry.confirmedAt)}</DataCell>
                <DataCell>{when(entry.endedAt)}</DataCell>
                {mayOperate ? (
                  <DataCell wrap>
                    <div className="max-w-64 min-w-48">{operation(entry)}</div>
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>
        </Panel>
      )}

      {previous === null && next === null ? null : (
        <nav className="flex flex-wrap gap-6" aria-label={t('pages')}>
          {previous === null ? null : (
            <TextLink href={href(state, previous)}>{t('previous')}</TextLink>
          )}
          {next === null ? null : (
            <TextLink href={href(state, next)}>{t('next')}</TextLink>
          )}
        </nav>
      )}
    </main>
  );
}

/** The explicit confirmation each operation requires; the action checks it. */
function Confirm({ id, label }: { readonly id: string; readonly label: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <input id={id} type="checkbox" name="confirm" required className="mt-0.5" />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
