import { getTranslations } from 'next-intl/server';

import { PERSONAL_LIMITS } from '@minhaj/contracts/personalisation';

import { savedLinks } from '@/components/personal/nav';
import {
  PersonalFrame,
  PersonalLinks,
  PersonalTime,
  refusalMessages,
} from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import {
  Alert,
  EmptyState,
  Field,
  Panel,
  SectionHeading,
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { createCollectionAction } from '../actions';

/**
 * My collections — the person's OWN private lists (ROUTE_MAP.md §5.1;
 * INFORMATION_ARCHITECTURE.md §5).
 *
 * NOT EDITORIAL COLLECTIONS. Those are public, curated and permissioned; these
 * are private and the person's alone. The page says "My collections" and says
 * the difference, so the shared word never misleads (IA §5 naming note).
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyCollectionsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(locale, `/${locale}/my/saved/collections`);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const read = await personalRead('personal-collections', () =>
    personalisationRuntime().saved.collections({ accountId: session.account.id }),
  );
  const back = <PersonalLinks label={t('nav.label')} links={savedLinks(locale, t)} />;
  const limits = {
    title: PERSONAL_LIMITS.collectionTitle,
    description: PERSONAL_LIMITS.collectionDescription,
    collections: PERSONAL_LIMITS.collections,
  };

  return (
    <PersonalFrame
      title={t('collections.title')}
      description={
        <>
          <p>{t('collections.description')}</p>
          <p>{t('collections.distinct')}</p>
        </>
      }
      back={back}
    >
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.length === 0 ? (
        <EmptyState>{t('collections.empty')}</EmptyState>
      ) : (
        <ul aria-label={t('collections.list')} className="flex flex-col gap-3">
          {read.value.map((collection) => (
            <Panel key={collection.id} as="li">
              <div className="flex min-w-0 flex-col gap-2">
                <TextLink href={`/${locale}/my/saved/collections/${collection.id}`}>
                  <span dir="auto" className="wrap-anywhere">
                    {collection.title}
                  </span>
                </TextLink>
                {collection.description === null ? null : (
                  <p dir="auto" className="text-sm whitespace-pre-wrap wrap-anywhere">
                    {collection.description}
                  </p>
                )}
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t('collections.items', { count: collection.itemCount })} ·{' '}
                  {t('collections.updatedAt')}{' '}
                  <PersonalTime
                    value={collection.updatedAt}
                    locale={locale}
                    timeZone={session.account.timezone}
                  />
                </p>
              </div>
            </Panel>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="collection-create">
        <span id="collection-create">
          <SectionHeading>{t('collections.create')}</SectionHeading>
        </span>
        <Panel>
          <ActionForm
            action={createCollectionAction}
            submitLabel={t('collections.createSubmit')}
            pendingLabel={t('common.working')}
            preserveInput
            messages={refusalMessages(t, {
              invalid: t('collections.invalid', {
                title: limits.title,
                description: limits.description,
              }),
              limit: t('collections.limit', { collections: limits.collections }),
            })}
          >
            <input type="hidden" name="locale" value={locale} />
            <Field
              id="collection-title"
              label={t('collections.titleLabel')}
              help={t('collections.titleHelp', { title: limits.title })}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="title"
                  maxLength={PERSONAL_LIMITS.collectionTitle}
                  dir="auto"
                  required
                />
              )}
            </Field>
            <Field
              id="collection-description"
              label={t('collections.descriptionLabel')}
              help={t('collections.descriptionHelp', { description: limits.description })}
            >
              {(props) => (
                <TextArea
                  {...props}
                  name="description"
                  rows={3}
                  maxLength={PERSONAL_LIMITS.collectionDescription}
                  dir="auto"
                />
              )}
            </Field>
          </ActionForm>
        </Panel>
      </section>
    </PersonalFrame>
  );
}
