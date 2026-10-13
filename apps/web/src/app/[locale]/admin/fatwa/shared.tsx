import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  FATWA_PAGE_SIZE,
  FATWA_PERMISSIONS,
  FATWA_STEP_UP_PURPOSE,
  fatwaCategoryName,
  fatwaIdSchema,
  type FatwaActor,
  type FatwaAnswererChoice,
  type FatwaCategoryRecord,
  type FatwaQuestionStage,
  type FatwaRevisionRecord,
} from '@minhaj/contracts/fatwa';
import type { PermissionKey } from '@minhaj/contracts/identity';

import {
  requireAdminPage,
  requireOwnSession,
  type AdminPageContext,
} from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { DetailRow, StatusBadge, TextLink } from '@/components/ui';
import { adminCopy } from '../shared';
import { StepUpPrompt } from '../step-up';

/**
 * The parts every Fatwa administration screen shares (ROUTE_MAP.md §7:
 * `/admin/fatwa/*`), Phase 20.
 *
 * ITS OWN SURFACE. Fatwa is a bounded context of its own, never the editorial
 * CMS: nothing here lives under `/admin/editorial`, and `content.*` opens
 * nothing here (DOMAIN_MODEL.md §12).
 *
 * THREE KEYS, THREE STAGES. `question.receive` opens intake and assignment,
 * `fatwa.answer` opens the actor's own drafts, `fatwa.publish` opens review and
 * the published record, and any of the three reads the categories. Every page
 * re-checks its own key server-side, every action re-checks it again, and the
 * workflow service and the database procedure check it a third and fourth time
 * — the navigation hiding a link is presentation only (SECURITY_BASELINE.md
 * §3.4 rule 1).
 *
 * A QUESTION IS PRIVATE. A list never shows its text, a person is named rather
 * than shown as an account identifier, and the asker is never shown at all. A
 * question's text appears only on a detail page whose read is an audited data
 * access, and the page says so.
 */

export type Query = Record<string, string | string[] | undefined>;

export interface ListParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}

/** The three keys, in the order the root page prefers them. */
export const FATWA_KEYS = Object.freeze([
  FATWA_PERMISSIONS.receive,
  FATWA_PERMISSIONS.answer,
  FATWA_PERMISSIONS.publish,
] as const) satisfies readonly PermissionKey[];

/** The copy every Fatwa screen needs, and a message for every refusal. */
export async function fatwaCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'fatwaAdmin' });
  return {
    t,
    messages: {
      success: t('saved'),
      // The Fatwa services' refusals (`FATWA_REFUSAL_REASONS`).
      denied: t('denied'),
      'not-found': t('notFound'),
      conflict: t('conflict'),
      invalid: t('invalid'),
      inactive: t('inactive'),
      'invalid-state': t('invalidState'),
      'invalid-assignee': t('invalidAssignee'),
      'invalid-category': t('invalidCategory'),
      'slug-frozen': t('slugFrozen'),
      'duplicate-slug': t('duplicateSlug'),
      'self-publication': t('selfPublication'),
      'correction-reason': t('correctionReasonRefused'),
      'step-up-required': t('stepUpRequired'),
      'rate-limited': t('rateLimited'),
      unavailable: t('unknown'),
      // The gates' refusals.
      'no-session': t('noSession'),
      'no-permission': t('denied'),
      'second-factor-required': t('secondFactorRequired'),
      'account-inactive': t('accountInactive'),
      'confirm-required': t('confirmRequired'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

export type Copy = Awaited<ReturnType<typeof fatwaCopy>>;

export function actorOf(context: AdminPageContext): FatwaActor {
  return { accountId: context.session.account.id };
}

/**
 * The route guard for a screen ANY Fatwa key opens — the area's root and its
 * categories. The first key the session holds is handed to `requireAdminPage`,
 * which re-resolves the session and re-checks that key itself, so the screen is
 * guarded by the same gate as every other administrative page. A signed-out
 * visitor is sent to sign in; a session holding none of the three gets 404.
 */
export async function requireFatwaAreaPage(
  locale: Locale,
  returnPath: string,
): Promise<AdminPageContext> {
  const active = await requireOwnSession(locale);
  if (active === null) {
    redirect(`/${locale}/signin?returnTo=${encodeURIComponent(returnPath)}`);
  }
  const held = (await identityRuntime().authorization.evaluate(active.session))
    .permissions;
  const key = FATWA_KEYS.find((candidate) => held.has(candidate));
  if (key === undefined) notFound();
  return requireAdminPage(locale, key, returnPath);
}

/** A route segment that must name a record, or the segment is a 404. */
export function recordTarget(id: string): string {
  if (fatwaIdSchema.safeParse(id).success) return id;
  notFound();
}

/**
 * A short opaque reference — never a primary label, only a way to tell two rows
 * apart when talking about them. It carries nothing about the asker.
 */
export function shortReference(id: string): string {
  return id.slice(0, 8);
}

/* ===========================================================================
 * Names for identifiers — categories, answerers, topics, languages
 * ========================================================================= */

export function categoryNames(
  categories: readonly FatwaCategoryRecord[],
  locale: Locale,
): ReadonlyMap<string, string> {
  return new Map(
    categories.map((category) => [
      category.id,
      fatwaCategoryName(category.names, locale) ?? category.slug,
    ]),
  );
}

export function answererNames(
  answerers: readonly FatwaAnswererChoice[],
): ReadonlyMap<string, string> {
  return new Map(answerers.map((answerer) => [answerer.accountId, answerer.name]));
}

/**
 * The name to show for an assignee. An account that no longer holds
 * `fatwa.answer` is not listed as an answerer any more, so it is shown as a
 * former answerer — never as its account identifier.
 */
export function assigneeLabel(
  assigneeId: string | null,
  names: ReadonlyMap<string, string>,
  copy: Copy,
): string {
  if (assigneeId === null) return copy.t('unassigned');
  return names.get(assigneeId) ?? copy.t('formerAnswerer');
}

/** Topic names in the interface locale, for every topic a screen shows. */
export async function topicNames(
  ids: readonly string[],
  locale: Locale,
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const found = await taxonomyRuntime().taxonomy.topicReferences(unique, locale);
  return new Map(found.map((topic) => [topic.id, topic.name]));
}

/**
 * Every content language Taxonomy knows, retired ones included, by its OWN
 * name — so a revision kept in a language since retired still shows its name.
 */
export async function languageNames(): Promise<ReadonlyMap<string, string>> {
  const languages = await taxonomyRuntime().taxonomy.listLanguages({
    includeRetired: true,
  });
  return new Map(
    languages.map((language) => [
      language.code,
      `${language.nativeName} (${language.code})`,
    ]),
  );
}

/* ===========================================================================
 * Presentation
 * ========================================================================= */

export function StageBadge({
  stage,
  copy,
}: {
  readonly stage: FatwaQuestionStage;
  readonly copy: Copy;
}) {
  const tone =
    stage === 'published'
      ? 'positive'
      : stage === 'declined' || stage === 'closed' || stage === 'returned'
        ? 'caution'
        : 'neutral';
  return <StatusBadge tone={tone}>{copy.t(`stageName.${stage}`)}</StatusBadge>;
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
 * Text a person wrote, exactly as stored: line breaks kept, long runs wrapped,
 * the direction left to the text itself. Its language is declared when known.
 */
export function WrittenText({
  text,
  language = null,
}: {
  readonly text: string;
  readonly language?: string | null;
}) {
  return (
    <p
      {...(language === null ? {} : { lang: language })}
      dir="auto"
      className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed"
    >
      {text}
    </p>
  );
}

/** A bounded listing's previous and next links, from what the page returned. */
export function Pager({
  offset,
  shown,
  total,
  base,
  copy,
}: {
  readonly offset: number;
  readonly shown: number;
  readonly total: number;
  readonly base: string;
  readonly copy: Copy;
}) {
  const hasMore = offset + shown < total;
  if (offset === 0 && !hasMore) return null;
  const current = Math.floor(offset / FATWA_PAGE_SIZE) + 1;
  const href = (page: number) => (page <= 1 ? base : `${base}?page=${String(page)}`);
  return (
    <nav className="flex gap-6" aria-label={copy.t('pagerLabel')}>
      {offset > 0 ? (
        <TextLink href={href(current - 1)}>{copy.t('previous')}</TextLink>
      ) : null}
      {hasMore ? <TextLink href={href(current + 1)}>{copy.t('next')}</TextLink> : null}
    </nav>
  );
}

/** The back link and heading of a detail screen. */
export function DetailHeading({
  back,
  children,
  copy,
}: {
  readonly back: string;
  readonly children: ReactNode;
  readonly copy: Copy;
}) {
  return (
    <>
      <p className="text-sm">
        <TextLink href={back}>{copy.t('backToList')}</TextLink>
      </p>
      <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{children}</h1>
    </>
  );
}

/** The explicit confirmation a destructive or publication action requires. */
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
 * The step-up prompt for exactly `fatwa-publication`. A grant earned for any
 * other purpose does not count; the action, the workflow service and the
 * publication procedure each re-check it.
 */
export async function FatwaPublicationStepUp({ locale }: { readonly locale: Locale }) {
  const [admin, stepUp] = await Promise.all([
    adminCopy(locale),
    getTranslations({ locale, namespace: 'admin.stepUp' }),
  ]);
  return (
    <StepUpPrompt
      locale={locale}
      purpose={FATWA_STEP_UP_PURPOSE}
      labels={{ ...admin.stepUp, description: stepUp('fatwaPublication') }}
    />
  );
}

/**
 * One revision in full — its title, public question, ruling, language,
 * category, topics and correction reason. Shown read-only wherever it is shown:
 * a revision is immutable once saved.
 */
export function RevisionView({
  revision,
  categories,
  topics,
  languages,
  copy,
}: {
  readonly revision: FatwaRevisionRecord;
  readonly categories: ReadonlyMap<string, string>;
  readonly topics: ReadonlyMap<string, string>;
  readonly languages: ReadonlyMap<string, string>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <div className="flex flex-col gap-4">
      <h3
        lang={revision.language}
        dir="auto"
        className="text-base font-semibold wrap-anywhere"
      >
        {revision.title}
      </h3>
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium">{t('draft.publicQuestion')}</h4>
        <WrittenText text={revision.publicQuestion} language={revision.language} />
      </div>
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium">{t('draft.ruling')}</h4>
        <WrittenText text={revision.ruling} language={revision.language} />
      </div>
      <dl className="grid gap-x-6 sm:grid-cols-2">
        <DetailRow term={t('draft.language')}>
          <span dir="auto">{languages.get(revision.language) ?? revision.language}</span>
        </DetailRow>
        <DetailRow term={t('category')}>
          <span dir="auto">
            {categories.get(revision.categoryId) ?? t('categoryUnavailable')}
          </span>
        </DetailRow>
        <DetailRow term={t('draft.topics')}>
          {revision.topicIds.length === 0 ? (
            t('none')
          ) : (
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {revision.topicIds.map((id) => (
                <li key={id} dir="auto">
                  {topics.get(id) ?? t('topicUnavailable')}
                </li>
              ))}
            </ul>
          )}
        </DetailRow>
        <DetailRow term={t('revision.number')}>{revision.number}</DetailRow>
      </dl>
      {revision.correctionReason === null ? null : (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium">{t('draft.correctionReason')}</h4>
          <WrittenText text={revision.correctionReason} language={revision.language} />
        </div>
      )}
    </div>
  );
}
