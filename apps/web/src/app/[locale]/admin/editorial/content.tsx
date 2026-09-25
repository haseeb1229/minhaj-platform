import { notFound } from 'next/navigation';
import { getMessages, getTranslations } from 'next-intl/server';
import type { Locale } from '@minhaj/contracts';
import { localeSchema } from '@minhaj/contracts';
import {
  PAGE_BINDINGS,
  editorialStateSchema,
  type EditorialKind,
  type WorkflowAction,
} from '@minhaj/contracts/editorial';
import { CONTRIBUTION_ROLES } from '@minhaj/contracts/people';
import { requireAdminPage } from '@/composition/authorization';
import { editorialRuntime, editorialReferenceChoices } from '@/composition/editorial';
import {
  Alert,
  EmptyState,
  Field,
  Panel,
  SectionHeading,
  Select,
  Button,
  TextInput,
  TextLink,
} from '@/components/ui';
import { EditorIsland } from '@/components/editorial/editor-island';
import { ActionForm } from '../../(identity)/form-state';
import { saveEditorial, transitionEditorial } from './actions';
import { EDITORIAL_SEGMENTS } from './segments';

const blank = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
export async function ContentDirectory({
  locale,
  kind,
  offset,
  queue = false,
  state = null,
}: {
  locale: Locale;
  kind: EditorialKind;
  offset: number;
  queue?: boolean;
  state?: string | null;
}) {
  if (state && !editorialStateSchema.safeParse(state).success) notFound();
  const segment = EDITORIAL_SEGMENTS[kind];
  const path = `/${locale}/admin/editorial/${queue ? 'queue' : segment}`;
  const context = await requireAdminPage(locale, 'content.read', path);
  const t = await getTranslations({ locale, namespace: 'editorial' });
  const data = await editorialRuntime().editorial.directory(
    { accountId: context.session.account.id },
    kind,
    offset,
    queue ? 'in-review' : state,
  );
  return (
    <Panel>
      <SectionHeading>{t(segment)}</SectionHeading>
      {!queue && context.authorization.can('content.author') ? (
        <TextLink href={`${path}/new`}>{t('create')}</TextLink>
      ) : null}
      {!queue ? (
        <form className="flex flex-wrap gap-3">
          <label htmlFor="state-filter">{t('state')}</label>
          <Select id="state-filter" name="state" defaultValue={state ?? ''}>
            <option value="">—</option>
            {editorialStateSchema.options.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </Select>
          <Button>{t('reload')}</Button>
        </form>
      ) : null}
      {data.items.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.items.map((row) => (
            <li key={row.id} className="flex flex-wrap gap-3">
              <TextLink href={`/${locale}/admin/editorial/${segment}/${row.id}`}>
                {row.title}
              </TextLink>
              <span>{t(row.state)}</span>
              <span>
                {t('version')}: {row.version}
              </span>
              {row.scheduledAt ? (
                <time dateTime={row.scheduledAt.toISOString()}>
                  {row.scheduledAt.toISOString()}
                </time>
              ) : null}
              {row.scheduleStatus &&
              ['authority-revoked', 'execution-failed'].includes(row.scheduleStatus) ? (
                <Alert tone="error">
                  {t(row.scheduleStatus as 'authority-revoked' | 'execution-failed')}
                </Alert>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <nav className="flex gap-4" aria-label={t('title')}>
        {offset > 0 ? (
          <TextLink
            href={`${path}?offset=${Math.max(0, offset - 25)}${state ? `&state=${state}` : ''}`}
          >
            {t('previous')}
          </TextLink>
        ) : null}
        {data.more ? (
          <TextLink
            href={`${path}?offset=${offset + 25}${state ? `&state=${state}` : ''}`}
          >
            {t('next')}
          </TextLink>
        ) : null}
      </nav>
    </Panel>
  );
}

export async function ContentEditor({
  locale,
  kind,
  id,
  revisionOffset = 0,
  referenceQuery = '',
}: {
  locale: Locale;
  kind: EditorialKind;
  id: string;
  revisionOffset?: number;
  referenceQuery?: string;
}) {
  const path = `/${locale}/admin/editorial/${EDITORIAL_SEGMENTS[kind]}/${id}`;
  const context = await requireAdminPage(locale, 'content.read', path);
  const actor = { accountId: context.session.account.id };
  const t = await getTranslations({ locale, namespace: 'editorial' });
  const messages = (await getMessages({ locale })).editorial;
  const record =
    id === 'new' ? null : await editorialRuntime().editorial.detail(actor, kind, id);
  const revision = record?.revision;
  const canAuthor = context.authorization.can('content.author');
  const choices = canAuthor
    ? await editorialReferenceChoices(locale, referenceQuery)
    : { people: [], topics: [] };
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={record?.id ?? ''} />
      <input type="hidden" name="version" value={record?.version ?? 0} />
    </>
  );
  const input = (
    name: string,
    label: string,
    value: string,
    maxLength: number,
    required = false,
    list?: string,
  ) => (
    <Field id={name} label={label}>
      {(props) => (
        <TextInput
          {...props}
          name={name}
          defaultValue={value}
          maxLength={maxLength}
          required={required}
          list={list}
        />
      )}
    </Field>
  );
  const history = record
    ? await editorialRuntime().editorial.revisions(actor, kind, record.id, revisionOffset)
    : null;
  const actions: WorkflowAction[] = record
    ? [
        ...(record.state === 'draft' ? ['submit' as const] : []),
        ...(record.state === 'in-review' ? ['approve' as const, 'reject' as const] : []),
        ...(record.approvedRevision !== null &&
        ['in-review', 'scheduled'].includes(record.state)
          ? ['publish' as const, 'schedule' as const]
          : []),
        ...(record.state === 'scheduled' ? ['cancel' as const] : []),
        ...(record.state !== 'archived' ? ['archive' as const] : []),
      ]
    : [];
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading>{record?.title ?? t('create')}</SectionHeading>
      {record ? (
        <p role="status">
          {t(record.state)} · {t('version')} {record.version}
        </p>
      ) : null}
      <TextLink href={path}>{t('reload')}</TextLink>
      {canAuthor ? (
        <Panel>
          <form className="flex flex-wrap items-end gap-3" action={path}>
            {input('referenceQuery', t('referenceQuery'), referenceQuery, 100)}
            <Button>{t('findReferences')}</Button>
          </form>
          <p>{t('referenceHelp')}</p>
          <datalist id="editorial-people">
            {choices.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </datalist>
          <datalist id="editorial-topics">
            {choices.topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </datalist>
          <ActionForm
            action={saveEditorial}
            submitLabel={t('save')}
            pendingLabel={t('pending')}
            messages={messages}
            preserveInput
          >
            {hidden}
            {record ? <Alert tone="info">{t('revisionWarning')}</Alert> : null}
            {kind === 'page' && !record ? (
              <Field id="routeBinding" label={t('routeBinding')}>
                {(props) => (
                  <Select {...props} name="routeBinding">
                    {PAGE_BINDINGS.map((binding) => (
                      <option key={binding}>{binding}</option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {input(
              'slug',
              t('slug'),
              revision?.slug ?? (kind === 'page' ? 'page' : ''),
              120,
              true,
            )}
            {kind === 'news-article' ? (
              <p className="text-xs text-[color:var(--color-foreground-muted)]">
                {t('slugReserved')}
              </p>
            ) : null}
            {kind === 'media-coverage' ? (
              <fieldset className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-[color:var(--color-border)] p-4">
                <legend className="px-1 text-sm font-semibold">{t('coverage')}</legend>
                <p className="text-xs text-[color:var(--color-foreground-muted)]">
                  {t('sourceHelp')}
                </p>
                {input(
                  'coverage-outlet',
                  t('outlet'),
                  revision?.coverage?.outlet ?? '',
                  200,
                  true,
                )}
                <Field id="coverage-sourceUrl" label={t('sourceUrl')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      type="url"
                      name="coverage-sourceUrl"
                      defaultValue={revision?.coverage?.sourceUrl ?? ''}
                      maxLength={2048}
                      dir="ltr"
                    />
                  )}
                </Field>
                <Field id="coverage-sourceDate" label={t('sourceDate')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      type="date"
                      name="coverage-sourceDate"
                      defaultValue={revision?.coverage?.sourceDate ?? ''}
                    />
                  )}
                </Field>
              </fieldset>
            ) : null}
            <Field id="primaryLanguage" label={t('primaryLanguage')}>
              {(props) => (
                <Select
                  {...props}
                  name="primaryLanguage"
                  defaultValue={revision?.primaryLanguage ?? locale}
                >
                  {localeSchema.options.map((language) => (
                    <option key={language}>{language}</option>
                  ))}
                </Select>
              )}
            </Field>
            {localeSchema.options.map((language) => {
              const translation = revision?.translations.find(
                (entry) => entry.languageCode === language,
              );
              return (
                <details
                  key={language}
                  open={language === (revision?.primaryLanguage ?? locale)}
                >
                  <summary className="min-h-11 cursor-pointer py-2">
                    {t('language')}: {language}
                  </summary>
                  <div className="flex flex-col gap-4">
                    <label>
                      <input
                        type="checkbox"
                        name={`${language}-enabled`}
                        defaultChecked={!!translation || (!record && language === locale)}
                      />{' '}
                      {t('enabled')}
                    </label>
                    {input(
                      `${language}-title`,
                      t('contentTitle'),
                      translation?.title ?? '',
                      200,
                    )}
                    {kind === 'statement' ? (
                      <Field
                        id={`${language}-issuer`}
                        label={t('issuer')}
                        help={t('issuerHelp')}
                      >
                        {(props) => (
                          <TextInput
                            {...props}
                            name={`${language}-issuer`}
                            defaultValue={translation?.issuer ?? ''}
                            maxLength={200}
                            lang={language}
                            dir={language === 'en' ? 'ltr' : 'rtl'}
                          />
                        )}
                      </Field>
                    ) : null}
                    {input(
                      `${language}-excerpt`,
                      t('excerpt'),
                      translation?.excerpt ?? '',
                      600,
                    )}
                    {input(
                      `${language}-seoTitle`,
                      t('seoTitle'),
                      translation?.seoTitle ?? '',
                      200,
                    )}
                    {input(
                      `${language}-seoDescription`,
                      t('seoDescription'),
                      translation?.seoDescription ?? '',
                      300,
                    )}
                    <p>{t('body')}</p>
                    <EditorIsland
                      name={`${language}-document`}
                      initial={translation?.document ?? blank}
                      label={`${t('body')} (${language})`}
                      language={language}
                      labels={messages}
                    />
                  </div>
                </details>
              );
            })}
            <details>
              <summary className="min-h-11 cursor-pointer py-2">{t('topics')}</summary>
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index}>
                  {input(
                    'topic-' + index,
                    t('topics') + ' ' + (index + 1),
                    revision?.topicIds[index] ?? '',
                    36,
                    false,
                    'editorial-topics',
                  )}
                </div>
              ))}
            </details>
            <details>
              <summary className="min-h-11 cursor-pointer py-2">
                {t('contributors')}
              </summary>
              <div className="flex flex-col gap-3">
                {Array.from({ length: 12 }, (_, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-2">
                    {input(
                      `person-${index}`,
                      `${t('contributors')} ${index + 1}`,
                      revision?.contributors[index]?.personId ?? '',
                      36,
                      false,
                      'editorial-people',
                    )}
                    <Field id={`role-${index}`} label={t('role')}>
                      {(props) => (
                        <Select
                          {...props}
                          name={`role-${index}`}
                          defaultValue={revision?.contributors[index]?.role ?? 'author'}
                        >
                          {CONTRIBUTION_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {t(role)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                ))}
              </div>
            </details>
          </ActionForm>
        </Panel>
      ) : null}
      {actions.map((action) => {
        const permission =
          action === 'submit'
            ? 'content.author'
            : ['approve', 'reject'].includes(action)
              ? 'content.review'
              : 'content.publish';
        if (!context.authorization.can(permission)) return null;
        if (
          action === 'approve' &&
          (record?.creatorId === actor.accountId ||
            record?.revision.editorId === actor.accountId)
        )
          return null;
        return (
          <Panel key={action}>
            <ActionForm
              action={transitionEditorial}
              submitLabel={t(action)}
              pendingLabel={t('pending')}
              messages={messages}
            >
              {hidden}
              <input type="hidden" name="action" value={action} />
              {action === 'schedule' ? (
                <>
                  {input('scheduledAt', t('scheduledAt'), '', 32, true)}
                  {input(
                    'timezone',
                    t('timezone'),
                    context.session.account.timezone ?? 'UTC',
                    64,
                    true,
                  )}
                </>
              ) : null}
            </ActionForm>
          </Panel>
        );
      })}
      {history ? (
        <Panel>
          <SectionHeading>{t('revisions')}</SectionHeading>
          {history.items.map((item) => (
            <details key={item.number}>
              <summary className="min-h-11 cursor-pointer py-2">
                {t('version')} {item.number} · {item.createdAt.toISOString()}
              </summary>
              {item.coverage ? (
                <dl className="text-sm">
                  <dt>{t('outlet')}</dt>
                  <dd dir="auto">{item.coverage.outlet}</dd>
                  {item.coverage.sourceUrl ? (
                    <>
                      <dt>{t('sourceUrl')}</dt>
                      <dd dir="ltr" className="break-all">
                        {item.coverage.sourceUrl}
                      </dd>
                    </>
                  ) : null}
                  {item.coverage.sourceDate ? (
                    <>
                      <dt>{t('sourceDate')}</dt>
                      <dd>{item.coverage.sourceDate}</dd>
                    </>
                  ) : null}
                </dl>
              ) : null}
              {item.translations.map((translation) => (
                <article
                  key={translation.languageCode}
                  lang={translation.languageCode}
                  dir={translation.languageCode === 'en' ? 'ltr' : 'rtl'}
                >
                  <h3>{translation.title}</h3>
                  {translation.issuer ? (
                    <p>
                      {t('issuer')}: {translation.issuer}
                    </p>
                  ) : null}
                  <div
                    className="editorial-prose"
                    dangerouslySetInnerHTML={{ __html: translation.html }}
                  />
                </article>
              ))}
            </details>
          ))}
          <nav className="flex gap-4" aria-label={t('revisions')}>
            {revisionOffset > 0 ? (
              <TextLink
                href={`${path}?revisionOffset=${Math.max(0, revisionOffset - 25)}`}
              >
                {t('previous')}
              </TextLink>
            ) : null}
            {history.more ? (
              <TextLink href={`${path}?revisionOffset=${revisionOffset + 25}`}>
                {t('next')}
              </TextLink>
            ) : null}
          </nav>
        </Panel>
      ) : null}
    </div>
  );
}
