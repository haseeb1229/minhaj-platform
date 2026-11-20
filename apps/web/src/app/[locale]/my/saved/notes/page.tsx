import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PERSONAL_LIMITS, targetKey } from '@minhaj/contracts/personalisation';

import { MyPage } from '@/components/my/frame';
import {
  MyListBeyond,
  MyListPager,
  MyListRefused,
  MyListStatus,
} from '@/components/my/list-parts';
import {
  myListHref,
  myListOffset,
  myListRange,
  readMyList,
  type MyListSpec,
} from '@/components/my/list-view';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs, myTrail } from '@/components/my/sections';
import { TargetItem } from '@/components/my/targets';
import { shortDate } from '@/components/my/time';
import { refusalMessages } from '@/components/personal/parts';
import { encodeTarget } from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState, Field, TextArea } from '@/components/ui';
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
 *
 * MY MINHAJ PART 1: the Saved views as tabs, "Showing n–m of N", numbered
 * pages (`?page=`, one address per view), a confirmation before a note is
 * deleted for good, and the deletion said aloud once its row has gone.
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
  const spec: MyListSpec<never> = { path };
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);
  const frame = {
    related,
    title: t('notes.title'),
    description: <p>{t('notes.description')}</p>,
    measure: 'reading' as const,
    tabs: {
      label: my('tabs.label.saved'),
      items: myTabs(locale, 'saved', 'notes', (key) => my(`tabs.${key}`)),
    },
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [
        { path: '/saved', text: my('trail.saved') },
        { text: t('notes.title') },
      ]),
    },
  };

  if (asked.outcome === 'refused')
    return (
      <MyPage {...frame}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </MyPage>
    );

  const view = asked.view;
  const read = await personalRead('personal-notes', () =>
    personalisationRuntime().saved.notes(
      { accountId: session.account.id },
      myListOffset(view.page),
    ),
  );

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const page = read.value;
  const titles = await resolvePersonalTargets(
    page.items.map((entry) => entry.target),
    locale,
  );
  const range = myListRange(view.page, page.items.length);
  const limits = { max: PERSONAL_LIMITS.noteMax };
  const messages = refusalMessages(t, {
    conflict: t('notes.conflict'),
    invalid: t('notes.invalid', limits),
  });
  const timeZone = session.account.timezone;

  return (
    <MyPage
      {...frame}
      announce={{
        value: String(page.total),
        message: my('live.list', { count: page.total }),
      }}
    >
      {range === null ? null : (
        <MyListStatus>{my('count.notes', { ...range, total: page.total })}</MyListStatus>
      )}

      {page.items.length === 0 ? (
        page.total === 0 ? (
          <EmptyState icon="list" title={my('notes.emptyTitle')}>
            {t('notes.empty')}
          </EmptyState>
        ) : (
          <MyListBeyond
            text={my('list.beyond')}
            first={myListHref(spec, { page: 1, filter: null })}
            firstText={my('list.first')}
          />
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
                    confirm={{
                      title: my('confirm.note.title'),
                      body: my('confirm.note.body'),
                      confirmLabel: my('confirm.note.confirm'),
                      cancelLabel: my('confirm.cancel'),
                    }}
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

      <MyListPager
        label={t('notes.list')}
        spec={spec}
        view={view}
        total={page.total}
        locale={locale}
        words={{
          previous: t('list.previous'),
          next: t('list.next'),
          page: (number) => my('list.page', { page: number }),
        }}
      />
    </MyPage>
  );
}
