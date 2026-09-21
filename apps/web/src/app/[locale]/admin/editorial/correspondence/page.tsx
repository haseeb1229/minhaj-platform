import { z } from 'zod';
import { getMessages, getTranslations } from 'next-intl/server';
import {
  correspondenceKindSchema,
  correspondenceStateSchema,
} from '@minhaj/contracts/editorial';
import { requireLocale } from '@/config/route-locale';
import { requireAdminPage } from '@/composition/authorization';
import { editorialRuntime } from '@/composition/editorial';
import {
  EmptyState,
  Field,
  Panel,
  SectionHeading,
  Select,
  TextArea,
  TextLink,
  Button,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { triageCorrespondence } from '../actions';
export default async function Correspondence({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string; state?: string; offset?: string }>;
}) {
  const locale = await requireLocale(params),
    query = await searchParams;
  const path = '/' + locale + '/admin/editorial/correspondence';
  const context = await requireAdminPage(locale, 'correspondence.read', path);
  const t = await getTranslations({ locale, namespace: 'editorial' }),
    messages = (await getMessages({ locale })).editorial;
  const kind = correspondenceKindSchema.catch('contact').parse(query.kind);
  const state = correspondenceStateSchema
    .nullable()
    .catch(null)
    .parse(query.state || null);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .catch(0)
    .parse(query.offset);
  const data = await editorialRuntime().correspondence.directory(
    { accountId: context.session.account.id },
    kind,
    offset,
    state,
  );
  const href = (start: number) =>
    path + '?kind=' + kind + '&offset=' + start + (state ? '&state=' + state : '');
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading>{t('correspondence')}</SectionHeading>
      <form className="flex flex-wrap gap-3">
        <Field id="kind" label={t('correspondence')}>
          {(props) => (
            <Select {...props} name="kind" defaultValue={kind}>
              {correspondenceKindSchema.options.map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="state-filter" label={t('state')}>
          {(props) => (
            <Select {...props} name="state" defaultValue={state ?? ''}>
              <option value="">—</option>
              {correspondenceStateSchema.options.map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button>{t('reload')}</Button>
      </form>
      {data.items.length ? (
        data.items.map((row) => (
          <Panel key={row.id}>
            <h3>{'subject' in row ? row.subject : t(row.category as 'suggestion')}</h3>
            {'email' in row ? (
              <p dir="auto">
                {row.name} · {row.email}
              </p>
            ) : null}
            <p className="whitespace-pre-wrap break-words" dir="auto">
              {row.body}
            </p>
            <p>
              {t(row.state)} · {t('version')} {row.version}
            </p>
            <p>
              {t('retention')}:{' '}
              <time dateTime={row.retainUntil.toISOString()}>
                {row.retainUntil.toISOString()}
              </time>
            </p>
            {context.authorization.can('correspondence.administer') ? (
              <ActionForm
                action={triageCorrespondence}
                submitLabel={t('triage')}
                pendingLabel={t('pending')}
                messages={messages}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="version" value={row.version} />
                <Field id={'state-' + row.id} label={t('state')}>
                  {(props) => (
                    <Select {...props} name="state" defaultValue={row.state}>
                      {correspondenceStateSchema.options.map((value) => (
                        <option key={value} value={value}>
                          {t(value)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id={'note-' + row.id} label={t('note')}>
                  {(props) => (
                    <TextArea
                      {...props}
                      name="note"
                      defaultValue={row.note}
                      maxLength={2000}
                      rows={4}
                    />
                  )}
                </Field>
              </ActionForm>
            ) : (
              <p className="whitespace-pre-wrap break-words">{row.note}</p>
            )}
          </Panel>
        ))
      ) : (
        <EmptyState>{t('empty')}</EmptyState>
      )}
      <nav className="flex gap-4" aria-label={t('correspondence')}>
        {offset > 0 ? (
          <TextLink href={href(Math.max(0, offset - 25))}>{t('previous')}</TextLink>
        ) : null}
        {data.more ? <TextLink href={href(offset + 25)}>{t('next')}</TextLink> : null}
      </nav>
    </div>
  );
}
