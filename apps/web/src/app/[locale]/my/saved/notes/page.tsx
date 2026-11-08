import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { PERSONAL_LIMITS, targetKey } from '@minhaj/contracts/personalisation';

import { pageLinks } from '@/components/hadith/presentation';
import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { TargetItem } from '@/components/my/targets';
import { shortDate } from '@/components/my/time';
import { refusalMessages } from '@/components/personal/parts';
import {
  encodeTarget,
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState, Field, Pager, TextArea } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
import { savedLinks } from '@/components/personal/nav';
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
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'notes');
}

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
  const path = localizedPath(locale, '/my/saved/notes');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const related = { label: t('nav.label'), links: savedLinks(locale, t) };
  const my = await getTranslations({ locale, namespace: 'my' });
  const offset = readPersonalOffset(await searchParams);
  const read = await personalRead('personal-notes', () =>
    personalisationRuntime().saved.notes({ accountId: session.account.id }, offset),
  );

  if (!read.ok)
    return (
      <MyPage related={related} title={t('notes.title')}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
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
  const timeZone = session.account.timezone;

  return (
    <MyPage
      related={related}
      title={t('notes.title')}
      description={<p>{t('notes.description')}</p>}
      measure="reading"
    >
      {page.items.length === 0 ? (
        page.total === 0 ? (
          <EmptyState icon="list" title={my('notes.emptyTitle')}>
            {t('notes.empty')}
          </EmptyState>
        ) : (
          <EmptyState>{t('list.beyond')}</EmptyState>
        )
      ) : (
        <ol aria-label={t('notes.list')} className="flex flex-col border-t border-border">
          {page.items.map((note) => {
            const field = `note-${note.savedItemId}`;
            return (
              <TargetItem
                key={note.savedItemId}
                kind={note.target.kind}
                resolved={titles.get(targetKey(note.target))}
                words={{
                  kind: (kind) => t(`kinds.${kind}`),
                  unavailable: t('target.unavailable'),
                  unknown: t('target.unknown'),
                }}
                meta={[
                  my('notes.changed', {
                    date: shortDate(new Date(note.updatedAt), locale, timeZone),
                  }),
                ]}
                actions={
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
                }
              >
                <p
                  dir="auto"
                  className="mt-2 rounded-control bg-surface-sunken px-4 py-3 text-sm whitespace-pre-wrap wrap-anywhere"
                >
                  {note.body}
                </p>
                <details className="mt-1">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-action">
                    {t('notes.edit')}
                  </summary>
                  <div className="mt-2">
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
              </TargetItem>
            );
          })}
        </ol>
      )}

      <Pager
        label={t('notes.list')}
        previous={
          links.previous === null ? null : personalOffsetHref(path, links.previous)
        }
        next={links.next === null ? null : personalOffsetHref(path, links.next)}
        previousLabel={t('list.previous')}
        nextLabel={t('list.next')}
      />
    </MyPage>
  );
}
