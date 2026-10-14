import { getTranslations } from 'next-intl/server';

import { PERSONAL_LIMITS, targetKey } from '@minhaj/contracts/personalisation';

import { pageLinks } from '@/components/hadith/presentation';
import { Pagination } from '@/components/media/parts';
import { savedLinks } from '@/components/personal/nav';
import {
  KindBadge,
  PersonalFrame,
  PersonalLinks,
  PersonalTime,
  TargetTitle,
  refusalMessages,
} from '@/components/personal/parts';
import {
  encodeTarget,
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState, Field, Panel, TextArea } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { removeNoteAction, writeNoteAction } from '../actions';

/**
 * Notes — the person's OWN private annotations (ROUTE_MAP.md §5.1;
 * INFORMATION_ARCHITECTURE.md §5).
 *
 * PLAIN TEXT, ALWAYS. A note is rendered as text with its line breaks kept by
 * CSS — never as HTML, never through a rich renderer — so nothing typed into
 * one can become markup on this page.
 *
 * EDITS ARE VERSIONED. Each form carries the version this page read; a note
 * changed since, in another tab or on another device, is a conflict the person
 * is told about, never a silent overwrite.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function NotesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/my/saved/notes`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const offset = readPersonalOffset(await searchParams);
  const read = await personalRead('personal-notes', () =>
    personalisationRuntime().saved.notes({ accountId: session.account.id }, offset),
  );
  const back = <PersonalLinks label={t('nav.label')} links={savedLinks(locale, t)} />;

  if (!read.ok)
    return (
      <PersonalFrame title={t('notes.title')} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const page = read.value;
  const titles = await resolvePersonalTargets(
    page.items.map((entry) => entry.target),
    locale,
  );
  const links = pageLinks(page.offset, PERSONAL_LIMITS.page, page.total);
  const limits = { max: PERSONAL_LIMITS.noteMax };
  const messages = refusalMessages(t, {
    conflict: t('notes.conflict'),
    invalid: t('notes.invalid', limits),
  });

  return (
    <PersonalFrame
      title={t('notes.title')}
      description={<p>{t('notes.description')}</p>}
      back={back}
    >
      {page.items.length === 0 ? (
        <EmptyState>{page.total === 0 ? t('notes.empty') : t('list.beyond')}</EmptyState>
      ) : (
        <ol aria-label={t('notes.list')} className="flex flex-col gap-3">
          {page.items.map((note) => {
            const field = `note-${note.savedItemId}`;
            return (
              <Panel key={note.savedItemId} as="li">
                <article className="flex min-w-0 flex-col gap-3">
                  <TargetTitle resolved={titles.get(targetKey(note.target))} t={t} />
                  <div className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--color-foreground-muted)]">
                    <KindBadge kind={note.target.kind} t={t} />
                    <span>
                      {t('notes.updatedAt')}{' '}
                      <PersonalTime
                        value={note.updatedAt}
                        locale={locale}
                        timeZone={session.account.timezone}
                      />
                    </span>
                  </div>
                  <p dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                    {note.body}
                  </p>

                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      {t('notes.edit')}
                    </summary>
                    <div className="mt-3">
                      <ActionForm
                        action={writeNoteAction}
                        submitLabel={t('notes.save')}
                        pendingLabel={t('common.working')}
                        preserveInput
                        messages={{ ...messages, success: t('notes.saved') }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input
                          type="hidden"
                          name="target"
                          value={encodeTarget(note.target)}
                        />
                        <input type="hidden" name="version" value={note.version} />
                        <Field
                          id={field}
                          label={t('notes.label')}
                          help={t('notes.help', limits)}
                        >
                          {(props) => (
                            <TextArea
                              {...props}
                              name="body"
                              rows={6}
                              maxLength={PERSONAL_LIMITS.noteMax}
                              defaultValue={note.body}
                              dir="auto"
                              required
                            />
                          )}
                        </Field>
                      </ActionForm>
                    </div>
                  </details>

                  <div className="self-start">
                    <ActionForm
                      action={removeNoteAction}
                      submitLabel={t('notes.delete')}
                      pendingLabel={t('common.working')}
                      tone="destructive"
                      messages={messages}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input
                        type="hidden"
                        name="target"
                        value={encodeTarget(note.target)}
                      />
                      <input type="hidden" name="version" value={note.version} />
                    </ActionForm>
                  </div>
                </article>
              </Panel>
            );
          })}
        </ol>
      )}

      <Pagination
        label={t('notes.list')}
        previous={
          links.previous === null ? null : personalOffsetHref(path, links.previous)
        }
        next={links.next === null ? null : personalOffsetHref(path, links.next)}
        previousLabel={t('list.previous')}
        nextLabel={t('list.next')}
      />
    </PersonalFrame>
  );
}
