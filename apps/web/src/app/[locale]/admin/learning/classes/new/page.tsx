import { learningIdSchema, type TeachingScopeView } from '@minhaj/contracts/learning';

import {
  Alert,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Select,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import { queryValue } from '../../../shared';
import { createSessionAction } from '../../actions';
import { learningCopy, titleText, type ListParams } from '../../shared';
import {
  ActivationNotice,
  ScheduleFields,
  classesBase,
  defaultTimeZone,
  participantNameMap,
  scopeOptionText,
} from '../parts';

/**
 * `/{locale}/admin/learning/classes/new?scope=` — a regular Course session on
 * a current teaching scope (ROUTE_MAP.md §7; DELIVERY_PLAN.md Phase 23).
 *
 * A CLASS BELONGS TO A SCOPE, never to a bare account: the choice is among
 * current scopes — a Course and the teacher scoped to it — and the service
 * re-asks Identity for that teacher's live assignment before anything is
 * written. `?scope=` preselects one, as the scopes page links it.
 *
 * THE MEETING ADDRESS IS OPTIONAL AND VALIDATED: an HTTPS `meet.google.com`
 * address pasted by the operator, canonicalised by the provider abstraction
 * and refused otherwise. It is never shown again except by the disclosure
 * read on the class's own page.
 */
export const dynamic = 'force-dynamic';

/** The most scope pages consulted to fill the choice. */
const SCOPE_PAGES = 4;

async function currentScopes(actor: { readonly accountId: string }) {
  const { classes } = learningRuntime();
  const found: TeachingScopeView[] = [];
  let truncated = false;
  for (let page = 0; page < SCOPE_PAGES; page += 1) {
    const result = await classes.scopes(actor, { current: true }, page * 24);
    found.push(...result.items);
    if (!result.hasMore) break;
    if (page === SCOPE_PAGES - 1) truncated = true;
  }
  return { scopes: found, truncated };
}

export default async function NewClassPage({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = classesBase(locale);
  const context = await requireAdminPage(locale, 'learning.classes.read', `${base}/new`);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('learning.classes.administer');
  const requested = queryValue(query, 'scope');
  const preselected =
    requested !== null && learningIdSchema.safeParse(requested).success ? requested : '';

  const [mode, { scopes, truncated }] = await Promise.all([
    learningRuntime().classes.activation(actor),
    currentScopes(actor),
  ]);
  const names = await participantNameMap(scopes.map((scope) => scope.scope.accountId));

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <PageHeading>{t('classes.create')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('classes.createHelp')}
        </p>
        <p>
          <TextLink href={base}>{t('backToList')}</TextLink>
        </p>
      </div>
      <ActivationNotice mode={mode} copy={copy} />

      {!administer ? (
        <Alert tone="info">{t('classes.readOnly')}</Alert>
      ) : scopes.length === 0 ? (
        <div className="flex flex-col gap-2">
          <EmptyState>{t('classes.noScopes')}</EmptyState>
          <p>
            <TextLink href={`${base}/scopes`}>{t('classes.scopes')}</TextLink>
          </p>
        </div>
      ) : (
        <Panel>
          <ActionForm
            action={createSessionAction}
            submitLabel={t('classes.createSubmit')}
            pendingLabel={t('pending')}
            messages={copy.messages}
            preserveInput
          >
            <input type="hidden" name="locale" value={locale} />
            <Field
              id="new-scope"
              label={t('classes.scope')}
              help={t('classes.scopeHelp')}
            >
              {(props) => (
                <Select {...props} name="scopeId" required defaultValue={preselected}>
                  <option value="" disabled>
                    {t('classes.chooseScope')}
                  </option>
                  {scopes.map((scope) => (
                    <option key={scope.scope.id} value={scope.scope.id}>
                      {scopeOptionText(
                        scope,
                        names,
                        titleText(
                          scope.course.labels,
                          locale,
                          scope.course.primaryLocale,
                        ),
                        copy,
                      )}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {truncated ? (
              <p className="text-xs text-[color:var(--color-foreground-muted)]">
                {t('classes.scopesTruncated')}
              </p>
            ) : null}
            <ScheduleFields
              prefix="new"
              copy={copy}
              session={null}
              timeZone={defaultTimeZone(context.session.account.timezone)}
            />
            <Field
              id="new-meeting"
              label={t('classes.meetingUrl')}
              help={t('classes.meetingUrlHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="url"
                  name="meetingUrl"
                  inputMode="url"
                  maxLength={200}
                  placeholder="https://meet.google.com/abc-defg-hij"
                  dir="ltr"
                />
              )}
            </Field>
          </ActionForm>
        </Panel>
      )}
    </main>
  );
}
