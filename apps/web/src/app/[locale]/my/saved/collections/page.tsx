import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { PERSONAL_LIMITS } from '@minhaj/contracts/personalisation';

import { MyPage, MySection } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { shortDate } from '@/components/my/time';
import { refusalMessages } from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import {
  Alert,
  EmptyState,
  Field,
  MetaRow,
  Panel,
  TextArea,
  TextInput,
} from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { createCollectionAction } from '../actions';

/**
 * My collections — the person's OWN private lists (ROUTE_MAP.md §5.1;
 * Personalisation-owned, Phase 21; redesigned in R2).
 *
 * NOT THE PLATFORM'S COLLECTIONS. The editors' public Collections are curated
 * content; these are the person's own lists, seen by nobody else — said in
 * words on the page.
 *
 * BOUNDED: an account holds at most `PERSONAL_LIMITS.collections` lists, so
 * the whole set is one page.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'collections');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyCollectionsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(
    locale,
    localizedPath(locale, '/my/saved/collections'),
  );
  const t = await getTranslations({ locale, namespace: 'personal' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const read = await personalRead('personal-collections', () =>
    personalisationRuntime().saved.collections({ accountId: session.account.id }),
  );
  const limits = {
    title: PERSONAL_LIMITS.collectionTitle,
    description: PERSONAL_LIMITS.collectionDescription,
    collections: PERSONAL_LIMITS.collections,
  };

  return (
    <MyPage
      title={t('collections.title')}
      description={
        <>
          <p>{t('collections.description')}</p>
          <p className="text-sm">{t('collections.distinct')}</p>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {!read.ok ? (
            <Alert tone="error">{t('failure.load')}</Alert>
          ) : read.value.length === 0 ? (
            <EmptyState icon="grid" title={my('collections.emptyTitle')}>
              {t('collections.empty')}
            </EmptyState>
          ) : (
            <ul
              aria-label={t('collections.list')}
              className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2"
            >
              {read.value.map((collection) => (
                <li
                  key={collection.id}
                  className="group card-surface relative flex min-w-0 flex-col gap-2 rounded-panel border border-border bg-surface-raised p-5 shadow-panel"
                >
                  <h2 className="text-subheading font-semibold text-balance wrap-anywhere">
                    <a
                      href={localizedPath(
                        locale,
                        `/my/saved/collections/${collection.id}`,
                      )}
                      dir="auto"
                      className="card-link text-foreground no-underline decoration-accent-rule underline-offset-4 group-hover:underline"
                    >
                      {collection.title}
                    </a>
                  </h2>
                  {collection.description === null ? null : (
                    <p
                      dir="auto"
                      className="line-clamp-3 text-sm wrap-anywhere text-foreground-muted"
                    >
                      {collection.description}
                    </p>
                  )}
                  <div className="mt-auto pt-1">
                    <MetaRow
                      items={[
                        t('collections.items', { count: collection.itemCount }),
                        my('collections.changed', {
                          date: shortDate(
                            new Date(collection.updatedAt),
                            locale,
                            session.account.timezone,
                          ),
                        }),
                      ]}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <MySection id="collection-create" heading={t('collections.create')}>
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
                help={t('collections.descriptionHelp', {
                  description: limits.description,
                })}
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
        </MySection>
      </div>
    </MyPage>
  );
}
