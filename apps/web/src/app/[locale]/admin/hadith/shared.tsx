import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  HADITH_PAGE,
  hadithIdSchema,
  type HadithActor,
  type HadithLayerState,
  type HadithPage,
  type HadithSourceAuthority,
  type HadithSourceSystemRecord,
} from '@minhaj/contracts/hadith';
import type { LanguageView } from '@minhaj/contracts/taxonomy';

import { ownerReferenceChoices } from '@/composition/owner-references';
import { peopleReadRuntime } from '@/composition/people-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import {
  Field,
  PageHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { ActionForm } from '../../(identity)/form-state';
import { adminCopy } from '../shared';
import { StepUpPrompt } from '../step-up';
import { changeHadithState } from './actions';

/**
 * The parts every Hadith administration screen shares (ROUTE_MAP.md §7:
 * `/admin/hadith/*`), Phase 19.
 *
 * THE SAME CONVENTIONS AS THE QURAN ADMINISTRATION, KEPT SEPARATE FROM IT.
 * Hadith and the Quran are distinct contexts, so nothing here is imported from
 * the Quran screens. `hadith.read` opens a screen, `hadith.administer` is what
 * every layered-work action re-checks, live, and every form carries its
 * record's expected version, so a stale save is a visible conflict rather than
 * a silent overwrite.
 *
 * SOURCED TEXT IS SHOWN, NEVER REPAIRED. A record's original text, chain and
 * gradings are written only through the canonical forms — behind
 * `hadith.editCanonical` and a step-up grant for `hadith-canonical-edit` — and
 * are displayed exactly as stored: line breaks kept, nothing trimmed, the
 * direction left to the text itself where its language is not known.
 */

export type Query = Record<string, string | string[] | undefined>;

export interface ListParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}

export interface EditorParams {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Query>;
}

/** The copy every Hadith screen needs, and a message for every refusal. */
export async function hadithCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'hadithAdmin' });
  return {
    t,
    messages: {
      success: t('saved'),
      // The Hadith services' refusals (`HadithRefusal.reason`).
      denied: t('denied'),
      'not-found': t('notFound'),
      conflict: t('conflict'),
      invalid: t('invalid'),
      'duplicate-slug': t('duplicateSlug'),
      'duplicate-reference': t('duplicateReference'),
      'source-required': t('sourceRequired'),
      'text-required': t('textRequired'),
      unchanged: t('unchanged'),
      'structure-mismatch': t('structureMismatch'),
      'citation-kept': t('citationKept'),
      'not-candidate': t('notCandidate'),
      'citation-conflicted': t('citationConflicted'),
      'not-verified': t('notVerified'),
      'fixture-over-approved': t('fixtureOverApproved'),
      // The privileged gate's refusals, for every canonical write.
      'no-session': t('noSession'),
      'no-permission': t('denied'),
      'second-factor-required': t('secondFactorRequired'),
      'step-up-required': t('stepUpRequired'),
      'account-inactive': t('accountInactive'),
      'confirm-required': t('confirmRequired'),
      unavailable: t('unknown'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

export type Copy = Awaited<ReturnType<typeof hadithCopy>>;

/** `new` is not a Hadith route: a record exists, or the segment is a 404. */
export function recordTarget(id: string): string {
  if (hadithIdSchema.safeParse(id).success) return id;
  notFound();
}

/** One identifier from the query, or `null` when absent or not an identifier. */
export function queryId(query: Query, key: string): string | null {
  const parsed = hadithIdSchema.safeParse(query[key]);
  return parsed.success ? parsed.data : null;
}

export function actorOf(context: {
  readonly session: { readonly account: { readonly id: string } };
}): HadithActor {
  return { accountId: context.session.account.id };
}

/**
 * Every page of a bounded administrative listing, for a CHOICE list — the
 * books of one collection, the chapters of one book. Capped, and says so: a
 * selector silently missing its tail would look like a complete list.
 */
export const CHOICES_MAX = 1_000;

export async function everyPage<T>(
  load: (offset: number) => Promise<HadithPage<T>>,
): Promise<{ readonly items: readonly T[]; readonly truncated: boolean }> {
  const items: T[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (items.length < total && items.length < CHOICES_MAX) {
    const page = await load(items.length);
    total = page.total;
    if (page.items.length === 0) break;
    items.push(...page.items);
  }
  const kept = items.slice(0, CHOICES_MAX);
  return { items: kept, truncated: kept.length < total };
}

/* ===========================================================================
 * States, sources and dates
 * ========================================================================= */

export function StateBadge({
  state,
  copy,
}: {
  readonly state: HadithLayerState;
  readonly copy: Copy;
}) {
  return (
    <StatusBadge
      tone={
        state === 'published' ? 'positive' : state === 'archived' ? 'caution' : 'neutral'
      }
    >
      {copy.t(`stateName.${state}`)}
    </StatusBadge>
  );
}

/**
 * What a registered source system IS, in words. A fixture is cautioned every
 * time it appears, so nobody mistakes engineering text for an approved source.
 */
export function AuthorityBadge({
  authority,
  copy,
}: {
  readonly authority: HadithSourceAuthority;
  readonly copy: Copy;
}) {
  return (
    <StatusBadge tone={authority === 'approved' ? 'positive' : 'caution'}>
      {copy.t(`authority.${authority}`)}
    </StatusBadge>
  );
}

/** A source system named by its title and code, with its authority — or "none". */
export function SourceName({
  source,
  copy,
}: {
  readonly source: HadithSourceSystemRecord | undefined;
  readonly copy: Copy;
}) {
  if (source === undefined) return <span>{copy.t('sourceNone')}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span dir="auto">{source.title}</span>
      <span dir="ltr" className="text-xs">
        ({source.code} · {source.version})
      </span>
      <AuthorityBadge authority={source.authority} copy={copy} />
    </span>
  );
}

/**
 * The registered-source selector. CHOOSE ONLY: source systems are registered
 * by the owner/operator principal and nothing on these screens can create one.
 */
export function SourceSelect({
  id,
  sources,
  selected,
  copy,
}: {
  readonly id: string;
  readonly sources: readonly HadithSourceSystemRecord[];
  readonly selected: string | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <Field id={id} label={t('source')} help={t('sourceHelp')}>
      {(props) => (
        <Select {...props} name="sourceSystemId" defaultValue={selected ?? ''}>
          <option value="">{t('sourceNone')}</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {`${source.title} (${source.code} · ${source.version}) — ${t(
                `authority.${source.authority}`,
              )}`}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function DateText({
  date,
  locale,
  time = false,
}: {
  readonly date: Date;
  readonly locale: Locale;
  readonly time?: boolean;
}) {
  return (
    <time dateTime={date.toISOString()}>
      {new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        ...(time ? { timeStyle: 'short' } : {}),
        timeZone: 'UTC',
      }).format(date)}
    </time>
  );
}

/**
 * Sourced text exactly as stored: line breaks kept, nothing trimmed or
 * re-composed, long runs wrapped. Its language is declared when the record
 * names one, and its direction follows the text itself.
 */
export function ExactText({
  text,
  language,
  as = 'p',
  large = false,
}: {
  readonly text: string;
  readonly language: string | null;
  readonly as?: 'p' | 'span';
  readonly large?: boolean;
}) {
  const Tag = as;
  return (
    <Tag
      {...(language === null ? {} : { lang: language })}
      dir="auto"
      className={`whitespace-pre-wrap wrap-anywhere ${large ? 'text-lg leading-loose' : 'text-sm'}`}
    >
      {text}
    </Tag>
  );
}

export const SUBMIT_CLASSES =
  'inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium';

/* ===========================================================================
 * Owner references — languages from Taxonomy, people from People
 * ========================================================================= */

/**
 * Every content language Taxonomy knows, retired ones included, so a record
 * kept in a language since retired still shows its name. Only ACTIVE
 * languages are offered as a new choice.
 */
export async function languageIndex(): Promise<ReadonlyMap<string, LanguageView>> {
  const languages = await taxonomyRuntime().taxonomy.listLanguages({
    includeRetired: true,
  });
  return new Map(languages.map((language) => [language.code, language]));
}

/** A content language by its OWN name, with its code — never translated. */
export function languageText(
  code: string,
  languages: ReadonlyMap<string, LanguageView>,
): string {
  const language = languages.get(code);
  return language === undefined ? code : `${language.nativeName} (${code})`;
}

/**
 * A content-language selector. `optional` offers "none" — for a value whose
 * absence is meaningful, such as a chain that is not given — and otherwise the
 * choice is required.
 */
export function LanguageSelect({
  id,
  name = 'languageCode',
  label,
  help,
  languages,
  selected,
  optional = false,
  copy,
}: {
  readonly id: string;
  readonly name?: string;
  readonly label?: string;
  readonly help?: string;
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly selected: string | null;
  readonly optional?: boolean;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const offered = [...languages.values()].filter(
    (language) => language.status === 'active' || language.code === selected,
  );
  return (
    <Field id={id} label={label ?? t('language.label')} help={help ?? t('language.help')}>
      {(props) => (
        <Select {...props} name={name} required={!optional} defaultValue={selected ?? ''}>
          <option value="">{optional ? t('none') : t('language.choose')}</option>
          {offered.map((language) => (
            <option key={language.code} value={language.code}>
              {languageText(language.code, languages)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export interface PersonChoice {
  readonly id: string;
  readonly name: string;
}

/**
 * The People a form may choose from: published contributors narrowed by the
 * operator's search, PLUS every person the record already names — by name,
 * read from People — so a saved choice is never silently cleared because it
 * fell off the bounded first page.
 */
export async function peopleChoices(
  locale: Locale,
  query: string,
  named: readonly string[],
  copy: Copy,
): Promise<{
  readonly options: readonly PersonChoice[];
  readonly names: ReadonlyMap<string, string>;
}> {
  const unique = [...new Set(named)];
  const [choices, references] = await Promise.all([
    ownerReferenceChoices(locale, query),
    unique.length === 0
      ? Promise.resolve([])
      : peopleReadRuntime().people.contributorReferences(unique, locale),
  ]);
  const names = new Map(references.map((person) => [person.id, person.name]));
  const listed = new Set(choices.people.map((person) => person.id));
  const missing = unique
    .filter((id) => !listed.has(id))
    .map((id) => ({ id, name: names.get(id) ?? copy.t('personUnavailable') }));
  return { options: [...missing, ...choices.people], names };
}

/** A narrowing GET form for the People selectors, beside — never inside — a save form. */
export function PeopleSearch({
  query,
  copy,
  keep = {},
}: {
  readonly query: string;
  readonly copy: Copy;
  readonly keep?: Readonly<Record<string, string>>;
}) {
  const { t } = copy;
  return (
    <div className="flex flex-col gap-2">
      <form method="get" className="flex flex-wrap items-end gap-3">
        {Object.entries(keep).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Field id="people-search" label={t('people.search')}>
          {(props) => (
            <TextInput {...props} name="q" defaultValue={query} maxLength={200} />
          )}
        </Field>
        <button type="submit" className={SUBMIT_CLASSES}>
          {t('people.searchSubmit')}
        </button>
      </form>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('people.searchHelp')}
      </p>
    </div>
  );
}

/* ===========================================================================
 * Paging, headings and forms
 * ========================================================================= */

export function Pager({
  offset,
  total,
  hrefFor,
  label,
  copy,
}: {
  readonly offset: number;
  readonly total: number;
  readonly hrefFor: (page: number) => string;
  readonly label: string;
  readonly copy: Copy;
}) {
  const hasMore = offset + HADITH_PAGE < total;
  if (offset === 0 && !hasMore) return null;
  const current = offset / HADITH_PAGE + 1;
  return (
    <nav className="flex gap-6" aria-label={label}>
      {offset > 0 ? (
        <TextLink href={hrefFor(current - 1)}>{copy.t('previous')}</TextLink>
      ) : null}
      {hasMore ? <TextLink href={hrefFor(current + 1)}>{copy.t('next')}</TextLink> : null}
    </nav>
  );
}

/** A URL with its query, leaving out empty values. */
export function withQuery(
  path: string,
  values: Readonly<Record<string, string | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text === '' ? path : `${path}?${text}`;
}

/** The hidden fields that make an edit an edit: its record and expected version. */
export function EditIdentity({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: { readonly id: string; readonly version: number } | null;
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      {record === null ? null : (
        <>
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="version" value={String(record.version)} />
        </>
      )}
    </>
  );
}

/** The slug: chosen once at creation, then shown as fixed text — it never changes. */
export function SlugField({
  prefix,
  slug,
  help,
  copy,
}: {
  readonly prefix: string;
  readonly slug: string | null;
  readonly help?: string;
  readonly copy: Copy;
}) {
  const { t } = copy;
  if (slug !== null)
    return (
      <p className="text-sm">
        <input type="hidden" name="slug" value={slug} />
        {t('slug')}: <span dir="ltr">{slug}</span>
        <span className="block text-xs text-[color:var(--color-foreground-muted)]">
          {t('slugFixed')}
        </span>
      </p>
    );
  return (
    <Field id={`${prefix}-slug`} label={t('slug')} help={help ?? t('slugHelp')}>
      {(props) => (
        <TextInput
          {...props}
          name="slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={120}
          dir="ltr"
        />
      )}
    </Field>
  );
}

/** The explicit confirmation every canonical write requires before it is attempted. */
export function ConfirmField({
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <input id={id} type="checkbox" name="confirm" required className="mt-1" />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/**
 * The step-up prompt for exactly `hadith-canonical-edit`. A grant earned for
 * any other purpose does not count; the action, the canonical service and the
 * database procedure each re-check it.
 */
export async function CanonicalStepUp({ locale }: { readonly locale: Locale }) {
  const [admin, stepUp] = await Promise.all([
    adminCopy(locale),
    getTranslations({ locale, namespace: 'admin.stepUp' }),
  ]);
  return (
    <StepUpPrompt
      locale={locale}
      purpose="hadith-canonical-edit"
      labels={{ ...admin.stepUp, description: stepUp('hadithCanonicalEdit') }}
    />
  );
}

/** The heading block of an editor: back link, name, state, version and update. */
export function EditorHeading({
  base,
  locale,
  title,
  record,
  copy,
}: {
  readonly base: string;
  readonly locale: Locale;
  readonly title: ReactNode;
  readonly record: {
    readonly slug: string;
    readonly state: HadithLayerState;
    readonly version: number;
    readonly updatedAt: Date;
  };
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <>
      <p className="text-sm">
        <TextLink href={base}>{t('backToList')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <StateBadge state={record.state} copy={copy} />
          <span>
            {t('slug')}: <span dir="ltr">{record.slug}</span>
          </span>
          <span>
            {t('version')}: {record.version}
          </span>
          <span>
            {t('updated')}: <DateText date={record.updatedAt} locale={locale} />
          </span>
        </p>
      </div>
    </>
  );
}

export type StateKind = 'translation' | 'commentary' | 'science';

/**
 * The lifecycle controls: one small form per reachable state, each carrying the
 * expected version. Publishing is further gated by the service — a registered
 * source, text to show, and never a fixture beside an approved section — and
 * its refusal is shown here in words.
 */
export function StateControls({
  kind,
  locale,
  record,
  copy,
}: {
  readonly kind: StateKind;
  readonly locale: Locale;
  readonly record: {
    readonly id: string;
    readonly version: number;
    readonly state: HadithLayerState;
  };
  readonly copy: Copy;
}) {
  const { t } = copy;
  const targets = (['published', 'draft', 'archived'] as const).filter(
    (state) => state !== record.state,
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('stateHelp')}
      </p>
      <div className="flex flex-wrap gap-4">
        {targets.map((state) => (
          <ActionForm
            key={state}
            action={changeHadithState}
            submitLabel={t(`stateAction.${state}`)}
            pendingLabel={t('pending')}
            messages={copy.messages}
            tone={state === 'archived' ? 'destructive' : 'secondary'}
          >
            <EditIdentity locale={locale} record={record} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="state" value={state} />
          </ActionForm>
        ))}
      </div>
    </div>
  );
}
