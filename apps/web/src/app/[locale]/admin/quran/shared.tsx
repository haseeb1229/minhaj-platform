import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  QURAN_PAGE,
  quranIdSchema,
  type QuranActor,
  type QuranLayerState,
  type QuranSourceAuthority,
  type QuranSourceRecord,
  type SurahRecord,
} from '@minhaj/contracts/quran';

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
import { changeQuranState } from './actions';

/**
 * The parts every Quran administration screen shares (ROUTE_MAP.md §7:
 * `/admin/quran/*`), Phase 18.
 *
 * THE SAME CONVENTIONS AS THE MEDIA AND GLOBAL ADMINISTRATION. `quran.read`
 * opens a screen and `quran.administer` is what every layered-work action
 * re-checks, live; every form carries its record's expected version, so a stale
 * save is a visible conflict rather than a silent overwrite.
 *
 * CANONICAL TEXT IS ONLY EVER SHOWN HERE. Nothing in this module writes it:
 * the one path that changes an Ayah's Arabic is the protected correction flow
 * on the Ayah's own page, behind `quran.editCanonical` and a step-up grant for
 * `quran-canonical-edit` (SECURITY_BASELINE.md §5.1, §8.1).
 *
 * SCRIPTURE IS MARKED UP AS SCRIPTURE. Canonical Arabic is always inside an
 * element with `lang="ar" dir="rtl"`, whatever the interface locale, so a
 * screen reader announces it in the right voice and the bidirectional algorithm
 * never reorders it around the interface's own direction (§16.2).
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

/** The copy every Quran screen needs, and a message for every refusal. */
export async function quranCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'quranAdmin' });
  return {
    t,
    messages: {
      success: t('saved'),
      // The Quran service's refusals (`QuranRefusal.reason`).
      denied: t('denied'),
      'not-found': t('notFound'),
      conflict: t('conflict'),
      invalid: t('invalid'),
      'duplicate-slug': t('duplicateSlug'),
      'source-required': t('sourceRequired'),
      'text-required': t('textRequired'),
      'audio-required': t('audioRequired'),
      overlap: t('overlap'),
      'outside-surah': t('outsideSurah'),
      'not-cleared': t('notCleared'),
      'too-large': t('tooLarge'),
      'type-not-allowed': t('typeNotAllowed'),
      infected: t('notCleared'),
      'corpus-exists': t('corpusExists'),
      unchanged: t('unchanged'),
      'fixture-over-approved': t('fixtureOverApproved'),
      // The upload route's own transport refusals.
      unsupported: t('typeNotAllowed'),
      'rate-limited': t('rateLimited'),
      // The privileged gate's refusals, for the canonical correction.
      'no-session': t('noSession'),
      'no-permission': t('denied'),
      'second-factor-required': t('secondFactorRequired'),
      'step-up-required': t('stepUpRequired'),
      'account-inactive': t('accountInactive'),
      'confirm-required': t('correction.confirmRequired'),
      'verification-failed': t('correction.failed'),
      unavailable: t('unknown'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

export type Copy = Awaited<ReturnType<typeof quranCopy>>;

/** `new` is not a Quran route: a record exists, or the segment is a 404. */
export function recordTarget(id: string): string {
  if (quranIdSchema.safeParse(id).success) return id;
  notFound();
}

export function actorOf(context: {
  readonly session: { readonly account: { readonly id: string } };
}): QuranActor {
  return { accountId: context.session.account.id };
}

/* ===========================================================================
 * States, sources and dates
 * ========================================================================= */

export function StateBadge({
  state,
  copy,
}: {
  readonly state: QuranLayerState;
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
 * What a registered source IS, in words. A fixture is cautioned every time it
 * appears, so nobody mistakes engineering text for an approved source.
 */
export function AuthorityBadge({
  authority,
  copy,
}: {
  readonly authority: QuranSourceAuthority;
  readonly copy: Copy;
}) {
  return (
    <StatusBadge tone={authority === 'approved' ? 'positive' : 'caution'}>
      {copy.t(`authority.${authority}`)}
    </StatusBadge>
  );
}

/** A source named by its code and title, with its authority — or "none". */
export function SourceName({
  source,
  copy,
}: {
  readonly source: QuranSourceRecord | undefined;
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

/** A source as one line of option text. */
export function sourceOption(source: QuranSourceRecord, copy: Copy): string {
  return `${source.title} (${source.code} · ${source.version}) — ${copy.t(
    `authority.${source.authority}`,
  )}`;
}

/**
 * The registered-source selector. CHOOSE ONLY: sources are registered by the
 * owner/operator principal and nothing on these screens can create one.
 */
export function SourceSelect({
  id,
  sources,
  selected,
  copy,
}: {
  readonly id: string;
  readonly sources: readonly QuranSourceRecord[];
  readonly selected: string | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <Field id={id} label={t('source')} help={t('sourceHelp')}>
      {(props) => (
        <Select {...props} name="sourceId" defaultValue={selected ?? ''}>
          <option value="">{t('sourceNone')}</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {sourceOption(source, copy)}
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

/* ===========================================================================
 * Scripture and Surahs
 * ========================================================================= */

/**
 * Canonical Arabic, exactly as stored: `lang="ar" dir="rtl"`, line breaks
 * kept, nothing trimmed or re-composed for display.
 */
export function Scripture({
  text,
  as = 'p',
}: {
  readonly text: string;
  readonly as?: 'p' | 'span';
}) {
  const Tag = as;
  return (
    <Tag lang="ar" dir="rtl" className="text-xl leading-loose whitespace-pre-wrap">
      {text}
    </Tag>
  );
}

/** A Surah as one line of text: its number, and its display name in this locale. */
export function surahText(surah: SurahRecord, locale: Locale, copy: Copy): string {
  const name = surah.names[locale] ?? surah.nameArabic;
  return name === null || name === undefined
    ? copy.t('surahNumber', { number: surah.number })
    : copy.t('surahNamed', { number: surah.number, name });
}

/**
 * A narrowing GET form choosing one Surah — the first step of every per-Surah
 * screen. No script: the page reloads with the Surah in the query.
 */
export function SurahPicker({
  action,
  surahs,
  selected,
  locale,
  copy,
  keep = {},
}: {
  readonly action: string;
  readonly surahs: readonly SurahRecord[];
  readonly selected: number | null;
  readonly locale: Locale;
  readonly copy: Copy;
  /** Query values the reload must keep. */
  readonly keep?: Readonly<Record<string, string>>;
}) {
  const { t } = copy;
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field id="surah-picker" label={t('surah')}>
        {(props) => (
          <Select
            {...props}
            name="surah"
            required
            defaultValue={selected === null ? '' : String(selected)}
          >
            <option value="">{t('chooseSurah')}</option>
            {surahs.map((surah) => (
              <option key={surah.number} value={String(surah.number)}>
                {surahText(surah, locale, copy)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <button type="submit" className={SUBMIT_CLASSES}>
        {t('chooseSurahSubmit')}
      </button>
    </form>
  );
}

export const SUBMIT_CLASSES =
  'inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium';

/* ===========================================================================
 * Owner references — languages from Taxonomy, people from People
 * ========================================================================= */

/**
 * Every content language Taxonomy knows, retired ones included, so a work
 * recorded in a language since retired still shows its name and direction.
 * Only ACTIVE languages are offered as a new choice.
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

export function LanguageSelect({
  id,
  languages,
  selected,
  copy,
}: {
  readonly id: string;
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly selected: string | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const offered = [...languages.values()].filter(
    (language) => language.status === 'active' || language.code === selected,
  );
  return (
    <Field id={id} label={t('language.label')} help={t('language.help')}>
      {(props) => (
        <Select {...props} name="languageCode" required defaultValue={selected ?? ''}>
          <option value="">{t('language.choose')}</option>
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
  const hasMore = offset + QURAN_PAGE < total;
  if (offset === 0 && !hasMore) return null;
  const current = offset / QURAN_PAGE + 1;
  return (
    <nav className="flex gap-6" aria-label={label}>
      {offset > 0 ? (
        <TextLink href={hrefFor(current - 1)}>{copy.t('previous')}</TextLink>
      ) : null}
      {hasMore ? <TextLink href={hrefFor(current + 1)}>{copy.t('next')}</TextLink> : null}
    </nav>
  );
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
  copy,
}: {
  readonly prefix: string;
  readonly slug: string | null;
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
    <Field id={`${prefix}-slug`} label={t('slug')} help={t('slugHelp')}>
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

/** The heading block of an editor: back link, name, state, version and update. */
export function EditorHeading({
  base,
  locale,
  title,
  record,
  copy,
  children,
}: {
  readonly base: string;
  readonly locale: Locale;
  readonly title: ReactNode;
  readonly record: {
    readonly slug: string;
    readonly state: QuranLayerState;
    readonly version: number;
    readonly updatedAt: Date;
  };
  readonly copy: Copy;
  readonly children?: ReactNode;
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
          {children}
        </p>
      </div>
    </>
  );
}

export type StateKind =
  'translation' | 'transliteration' | 'tafsir' | 'recitation' | 'tajweed';

/**
 * The lifecycle controls: one small form per reachable state, each carrying the
 * expected version. Publishing is further gated by the service — a registered
 * source, text or audio to show, and never a fixture beside an approved corpus —
 * and its refusal is shown here in words.
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
    readonly state: QuranLayerState;
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
            action={changeQuranState}
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
