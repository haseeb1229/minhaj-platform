import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  LEGACY_MAPPING_STATES,
  TOPIC_MAPPING_STATES,
  type TopicMappingRow,
} from '@minhaj/contracts/migration';

import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  FilterLink,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { migrationRuntime } from '@/composition/migration';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { legacyMappingAction, topicMappingAction } from '../actions';
import {
  Code,
  MIGRATION_PAGE,
  MigrationTime,
  Pager,
  RowIdentity,
  actorOf,
  adminMigrationCopy,
  migrationPath,
  migrationRead,
  offsetOf,
  vocabularyOf,
  withQuery,
  type AdminMigrationCopy,
  type Query,
} from '../shared';
import { LegacyMappingBadge, TopicMappingBadge } from '../status';

/**
 * `/{locale}/admin/migration/url-mapping` — where legacy addresses and legacy
 * categories lead, under `migration.read`; every decision re-checks
 * `migration.administer`, at the version shown.
 *
 * THREE BOUNDED LISTS, each paged on its own: the legacy URL mappings a
 * publication created (an active one records where a legacy address now
 * leads — no redirect is served from it before the Phase-35 cutover; disabling
 * one keeps it as history); the topic mappings of legacy categories (a person
 * confirms one to a Topic Taxonomy lists now, excludes it, or reopens it —
 * never by similarity alone); and the links staging could not resolve.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

/** Topics Taxonomy offers now, by name in the interface locale. */
async function topicChoices(
  locale: Locale,
): Promise<readonly { readonly id: string; readonly name: string }[] | null> {
  try {
    const topics = await taxonomyRuntime().taxonomy.listTree({
      locale,
      includeArchived: false,
    });
    return topics.map(({ id, label }) => ({ id, name: label.name }));
  } catch {
    appLogger().error(
      { operation: 'migration-admin-topic-choices' },
      'Topics unavailable.',
    );
    return null;
  }
}

export default async function MigrationUrlMappingPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = migrationPath(locale, '/url-mapping');
  const context = await requireAdminPage(locale, 'migration.read', base);
  const query = await searchParams;
  const legacyOffset = offsetOf(query, 'lpage');
  const topicOffset = offsetOf(query, 'tpage');
  const linkOffset = offsetOf(query, 'upage');
  const legacyState = vocabularyOf(query, 'lstate', LEGACY_MAPPING_STATES);
  const topicState = vocabularyOf(query, 'tstate', TOPIC_MAPPING_STATES);
  if (
    legacyOffset === null ||
    topicOffset === null ||
    linkOffset === null ||
    legacyState === undefined ||
    topicState === undefined
  )
    notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const timeZone = context.session.account.timezone;
  const administer = context.authorization.can('migration.administer');
  const { read } = migrationRuntime();

  const [legacy, topics, links, choices] = await Promise.all([
    migrationRead('migration-admin-legacy-mappings', () =>
      read.legacyMappings(actor, { state: legacyState, offset: legacyOffset }),
    ),
    migrationRead('migration-admin-topic-mappings', () =>
      read.topicMappings(actor, { state: topicState, offset: topicOffset }),
    ),
    migrationRead('migration-admin-unresolved-links', () =>
      read.unresolvedLinks(actor, { offset: linkOffset }),
    ),
    administer ? topicChoices(locale) : Promise.resolve(null),
  ]);
  if (
    (!legacy.ok && legacy.failure === 'denied') ||
    (!topics.ok && topics.failure === 'denied') ||
    (!links.ok && links.failure === 'denied')
  )
    notFound();

  // Every list keeps the others' filters and pages when it moves.
  const current = {
    lstate: legacyState,
    tstate: topicState,
    lpage: legacyOffset > 0 ? String(legacyOffset / MIGRATION_PAGE + 1) : null,
    tpage: topicOffset > 0 ? String(topicOffset / MIGRATION_PAGE + 1) : null,
    upage: linkOffset > 0 ? String(linkOffset / MIGRATION_PAGE + 1) : null,
  };
  const href = (change: Readonly<Record<string, string | null>>) =>
    withQuery(base, { ...current, ...change });
  const names = new Map((choices ?? []).map((topic) => [topic.id, topic.name]));

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('mapping.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('mapping.description')}
        </p>
      </header>

      {/* ---- Legacy URL mappings ------------------------------------------ */}
      <section className="flex flex-col gap-3" aria-labelledby="legacy-mappings">
        <SectionHeading>
          <span id="legacy-mappings">{t('mapping.legacy.heading')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('mapping.legacy.help')}
        </p>
        <nav aria-label={t('mapping.legacy.filter')} className="flex flex-wrap gap-2">
          <FilterLink
            href={href({ lstate: null, lpage: null })}
            current={legacyState === null}
          >
            {t('filter.any')}
          </FilterLink>
          {LEGACY_MAPPING_STATES.map((value) => (
            <FilterLink
              key={value}
              href={href({ lstate: value, lpage: null })}
              current={legacyState === value}
            >
              {t(`legacyMappingState.${value}`)}
            </FilterLink>
          ))}
        </nav>
        {!legacy.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : legacy.value.rows.length === 0 ? (
          <EmptyState>
            {legacyOffset === 0 ? t('mapping.legacy.empty') : t('beyond')}
          </EmptyState>
        ) : (
          <DataTable
            caption={t('mapping.legacy.caption', { total: legacy.value.total })}
            columns={[
              t('mapping.column.legacyUrl'),
              t('mapping.column.canonicalPath'),
              t('mapping.column.state'),
              t('mapping.column.created'),
              t('mapping.column.action'),
            ]}
          >
            {legacy.value.rows.map((row) => (
              <DataRow key={row.id}>
                <DataCell wrap>
                  <Code>{row.legacyUrl}</Code>
                  <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                    <Code>{row.sourceKey}</Code>
                  </span>
                </DataCell>
                <DataCell wrap>
                  <Code>{row.canonicalPath}</Code>
                </DataCell>
                <DataCell>
                  <LegacyMappingBadge state={row.state} copy={copy} />
                </DataCell>
                <DataCell>
                  <MigrationTime
                    value={row.createdAt}
                    locale={locale}
                    timeZone={timeZone}
                  />
                </DataCell>
                <DataCell>
                  {administer ? (
                    <ActionForm
                      action={legacyMappingAction}
                      submitLabel={
                        row.state === 'active'
                          ? t('mapping.legacy.disable')
                          : t('mapping.legacy.enable')
                      }
                      pendingLabel={t('pending')}
                      tone="secondary"
                      messages={copy.messages}
                    >
                      <RowIdentity locale={locale} row={row} />
                      <input
                        type="hidden"
                        name="state"
                        value={row.state === 'active' ? 'disabled' : 'active'}
                      />
                    </ActionForm>
                  ) : (
                    t('none')
                  )}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
        {legacy.ok ? (
          <Pager
            offset={legacyOffset}
            total={legacy.value.total}
            hrefFor={(page) => href({ lpage: page > 1 ? String(page) : null })}
            label={t('mapping.legacy.pages')}
            copy={copy}
          />
        ) : null}
      </section>

      {/* ---- Topic mappings ----------------------------------------------- */}
      <section className="flex flex-col gap-3" aria-labelledby="topic-mappings">
        <SectionHeading>
          <span id="topic-mappings">{t('mapping.topics.heading')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('mapping.topics.help')}
        </p>
        <nav aria-label={t('mapping.topics.filter')} className="flex flex-wrap gap-2">
          <FilterLink
            href={href({ tstate: null, tpage: null })}
            current={topicState === null}
          >
            {t('filter.any')}
          </FilterLink>
          {TOPIC_MAPPING_STATES.map((value) => (
            <FilterLink
              key={value}
              href={href({ tstate: value, tpage: null })}
              current={topicState === value}
            >
              {t(`topicMappingState.${value}`)}
            </FilterLink>
          ))}
        </nav>
        {administer && choices === null ? (
          <Alert tone="warning">{t('mapping.topics.choicesUnavailable')}</Alert>
        ) : null}
        {!topics.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : topics.value.rows.length === 0 ? (
          <EmptyState>
            {topicOffset === 0 ? t('mapping.topics.empty') : t('beyond')}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('mapping.topics.heading')}>
            {topics.value.rows.map((row) => (
              <TopicMapping
                key={row.id}
                row={row}
                locale={locale}
                administer={administer}
                choices={choices}
                names={names}
                copy={copy}
              />
            ))}
          </ul>
        )}
        {topics.ok ? (
          <Pager
            offset={topicOffset}
            total={topics.value.total}
            hrefFor={(page) => href({ tpage: page > 1 ? String(page) : null })}
            label={t('mapping.topics.pages')}
            copy={copy}
          />
        ) : null}
      </section>

      {/* ---- Unresolved links --------------------------------------------- */}
      <section className="flex flex-col gap-3" aria-labelledby="unresolved-links">
        <SectionHeading>
          <span id="unresolved-links">{t('mapping.unresolved.heading')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('mapping.unresolved.help')}
        </p>
        {!links.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : links.value.rows.length === 0 ? (
          <EmptyState>
            {linkOffset === 0 ? t('mapping.unresolved.empty') : t('beyond')}
          </EmptyState>
        ) : (
          <DataTable
            caption={t('mapping.unresolved.caption', { total: links.value.total })}
            columns={[t('mapping.column.record'), t('mapping.column.href')]}
          >
            {links.value.rows.map((row, index) => (
              <DataRow key={`${row.stagedRecordId}-${String(index)}`}>
                <DataCell wrap>
                  <TextLink
                    href={migrationPath(
                      locale,
                      `/staging/${encodeURIComponent(row.stagedRecordId)}`,
                    )}
                  >
                    <bdi>{row.title}</bdi>
                  </TextLink>
                </DataCell>
                <DataCell wrap>
                  <Code>{row.href}</Code>
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
        {links.ok ? (
          <Pager
            offset={linkOffset}
            total={links.value.total}
            hrefFor={(page) => href({ upage: page > 1 ? String(page) : null })}
            label={t('mapping.unresolved.pages')}
            copy={copy}
          />
        ) : null}
      </section>
    </main>
  );
}

function TopicMapping({
  row,
  locale,
  administer,
  choices,
  names,
  copy,
}: {
  readonly row: TopicMappingRow;
  readonly locale: Locale;
  readonly administer: boolean;
  readonly choices: readonly { readonly id: string; readonly name: string }[] | null;
  readonly names: ReadonlyMap<string, string>;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  const topicName = (id: string | null) =>
    id === null ? t('none') : (names.get(id) ?? t('mapping.topicUnknown'));
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TopicMappingBadge state={row.state} copy={copy} />
          <span className="font-medium">
            <bdi>{row.label}</bdi>
          </span>
          <Code>{row.categoryKey}</Code>
        </div>
        <p className="text-sm">
          {t('mapping.topics.summary', {
            source: row.sourceKey,
            count: row.stagedCount,
          })}
        </p>
        <p className="text-sm">
          {t('mapping.topics.current', { topic: topicName(row.topicId) })}
          {row.suggestedTopicId === null
            ? null
            : ` · ${t('mapping.topics.suggested', { topic: topicName(row.suggestedTopicId) })}`}
        </p>
        {!administer ? null : row.state === 'unmapped' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {choices === null || choices.length === 0 ? (
              <p className="text-sm">{t('mapping.topics.noTopics')}</p>
            ) : (
              <ActionForm
                action={topicMappingAction}
                submitLabel={t('mapping.topics.confirm')}
                pendingLabel={t('pending')}
                messages={copy.messages}
              >
                <RowIdentity locale={locale} row={row} />
                <input type="hidden" name="decision" value="confirm" />
                <Field id={`topic-${row.id}`} label={t('mapping.topics.topic')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="topicId"
                      required
                      defaultValue={row.suggestedTopicId ?? ''}
                    >
                      <option value="">{t('mapping.topics.choose')}</option>
                      {choices.map((topic) => (
                        <option key={topic.id} value={topic.id}>
                          {topic.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </ActionForm>
            )}
            <ActionForm
              action={topicMappingAction}
              submitLabel={t('mapping.topics.exclude')}
              pendingLabel={t('pending')}
              tone="secondary"
              messages={copy.messages}
            >
              <RowIdentity locale={locale} row={row} />
              <input type="hidden" name="decision" value="exclude" />
            </ActionForm>
          </div>
        ) : (
          <ActionForm
            action={topicMappingAction}
            submitLabel={t('mapping.topics.reopen')}
            pendingLabel={t('pending')}
            tone="secondary"
            messages={copy.messages}
          >
            <RowIdentity locale={locale} row={row} />
            <input type="hidden" name="decision" value="reopen" />
          </ActionForm>
        )}
      </div>
    </Panel>
  );
}
