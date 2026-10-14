import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  PERSONAL_LIMITS,
  personalIdSchema,
  targetKey,
} from '@minhaj/contracts/personalisation';

import { savedLinks } from '@/components/personal/nav';
import {
  ConfirmField,
  KindBadge,
  PersonalFrame,
  PersonalLinks,
  TargetTitle,
  refusalMessages,
} from '@/components/personal/parts';
import { encodeTarget } from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import {
  Alert,
  EmptyState,
  Field,
  Panel,
  SectionHeading,
  TextArea,
  TextInput,
} from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import { requireActiveSession } from '../../../guard';
import {
  removeCollectionAction,
  removeFromCollectionAction,
  reorderCollectionAction,
  updateCollectionAction,
} from '../../actions';

/**
 * One of the person's OWN private collections (ROUTE_MAP.md §5.1).
 *
 * SOMEBODY ELSE'S ID IS A 404 — the same answer an id that does not exist
 * gets, because the owner query filters by the signed-in account itself. The
 * page never says whether a collection exists for anybody else.
 *
 * ORDER IS KEYBOARD-REACHABLE. Each member has Move up and Move down buttons —
 * ordinary submit buttons, no drag handle — and each sends the WHOLE new order
 * under the version this page read, so a stale page is a conflict rather than
 * a reshuffle of something it never saw.
 *
 * Members are added from the public pages themselves; this page renames,
 * re-describes, reorders, removes members and deletes the list.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

/** The order with the member at `from` swapped with its neighbour at `to`. */
function moved(ids: readonly string[], from: number, to: number): readonly string[] {
  const next = [...ids];
  const [member] = next.splice(from, 1);
  if (member !== undefined) next.splice(to, 0, member);
  return next;
}

export default async function MyCollectionPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const valid = personalIdSchema.safeParse(id).success ? id : null;
  const session = await requireActiveSession(
    locale,
    valid === null
      ? `/${locale}/my/saved/collections`
      : `/${locale}/my/saved/collections/${valid}`,
  );
  if (valid === null) notFound();
  const t = await getTranslations({ locale, namespace: 'personal' });
  const read = await personalRead('personal-collection', () =>
    personalisationRuntime().saved.collection({ accountId: session.account.id }, valid),
  );
  const back = <PersonalLinks label={t('nav.label')} links={savedLinks(locale, t)} />;

  if (!read.ok)
    return (
      <PersonalFrame title={t('collection.title')} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );
  const collection = read.value;
  if (collection === null) notFound();

  const members = [...collection.members].sort((a, b) => a.position - b.position);
  const order = members.map((member) => member.savedItemId);
  const titles = await resolvePersonalTargets(
    members.map((member) => member.target),
    locale,
  );
  const limits = {
    title: PERSONAL_LIMITS.collectionTitle,
    description: PERSONAL_LIMITS.collectionDescription,
  };
  const messages = refusalMessages(t, {
    conflict: t('collection.conflict'),
    'not-found': t('collection.notFound'),
  });
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="collectionId" value={collection.id} />
      <input type="hidden" name="version" value={collection.version} />
    </>
  );

  return (
    <PersonalFrame
      title={
        <span dir="auto" className="wrap-anywhere">
          {collection.title}
        </span>
      }
      description={
        <>
          <p>{t('collection.private')}</p>
          {collection.description === null ? null : (
            <p dir="auto" className="whitespace-pre-wrap wrap-anywhere">
              {collection.description}
            </p>
          )}
        </>
      }
      back={back}
    >
      <section className="flex flex-col gap-3" aria-labelledby="collection-members">
        <span id="collection-members">
          <SectionHeading>{t('collection.members')}</SectionHeading>
        </span>
        {members.length === 0 ? (
          <EmptyState>{t('collection.empty')}</EmptyState>
        ) : (
          <ol aria-label={t('collection.members')} className="flex flex-col gap-3">
            {members.map((member, index) => (
              <Panel key={member.savedItemId} as="li">
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-[color:var(--color-foreground-muted)]">
                      {t('collection.position', { position: index + 1 })}
                    </span>
                    <KindBadge kind={member.target.kind} t={t} />
                  </div>
                  <TargetTitle resolved={titles.get(targetKey(member.target))} t={t} />
                  <div className="flex flex-wrap items-start gap-2">
                    {index === 0 ? null : (
                      <ActionForm
                        action={reorderCollectionAction}
                        submitLabel={t('collection.moveUp')}
                        pendingLabel={t('common.working')}
                        tone="secondary"
                        messages={messages}
                      >
                        {hidden}
                        {moved(order, index, index - 1).map((item) => (
                          <input key={item} type="hidden" name="item" value={item} />
                        ))}
                      </ActionForm>
                    )}
                    {index === members.length - 1 ? null : (
                      <ActionForm
                        action={reorderCollectionAction}
                        submitLabel={t('collection.moveDown')}
                        pendingLabel={t('common.working')}
                        tone="secondary"
                        messages={messages}
                      >
                        {hidden}
                        {moved(order, index, index + 1).map((item) => (
                          <input key={item} type="hidden" name="item" value={item} />
                        ))}
                      </ActionForm>
                    )}
                    <ActionForm
                      action={removeFromCollectionAction}
                      submitLabel={t('collection.removeMember')}
                      pendingLabel={t('common.working')}
                      tone="secondary"
                      messages={messages}
                    >
                      {hidden}
                      <input
                        type="hidden"
                        name="target"
                        value={encodeTarget(member.target)}
                      />
                    </ActionForm>
                  </div>
                </div>
              </Panel>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="collection-details">
        <span id="collection-details">
          <SectionHeading>{t('collection.details')}</SectionHeading>
        </span>
        <Panel>
          <ActionForm
            action={updateCollectionAction}
            submitLabel={t('collection.save')}
            pendingLabel={t('common.working')}
            preserveInput
            messages={{
              ...refusalMessages(t, {
                conflict: t('collection.conflict'),
                invalid: t('collections.invalid', {
                  title: limits.title,
                  description: limits.description,
                }),
              }),
              success: t('collection.saved'),
            }}
          >
            {hidden}
            <Field
              id="collection-title"
              label={t('collections.titleLabel')}
              help={t('collections.titleHelp', { title: limits.title })}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="title"
                  defaultValue={collection.title}
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
                  defaultValue={collection.description ?? ''}
                  maxLength={PERSONAL_LIMITS.collectionDescription}
                  dir="auto"
                />
              )}
            </Field>
          </ActionForm>
        </Panel>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="collection-delete">
        <span id="collection-delete">
          <SectionHeading>{t('collection.delete')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('collection.deleteHelp')}
        </p>
        <Panel>
          <ActionForm
            action={removeCollectionAction}
            submitLabel={t('collection.deleteSubmit')}
            pendingLabel={t('common.working')}
            tone="destructive"
            messages={messages}
          >
            {hidden}
            <ConfirmField
              id="collection-delete-confirm"
              label={t('collection.deleteConfirm')}
            />
          </ActionForm>
        </Panel>
      </section>
    </PersonalFrame>
  );
}
