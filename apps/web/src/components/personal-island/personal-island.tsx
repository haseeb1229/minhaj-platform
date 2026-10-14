'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { PersonalTarget, TargetState } from '@minhaj/contracts/personalisation';

import { Button, Field, TextArea, TextLink } from '@/components/ui';
import { readTargetState, sendPersonal, type PersonalWrite } from './requests';

/**
 * A person's own controls on a PUBLIC content page — save, a private note,
 * their collections and, on an Ayah, their reading position (DELIVERY_PLAN.md
 * Phase 21; ARCHITECTURE.md §8.2).
 *
 * THE PAGE IS THE SAME FOR EVERYBODY. The server renders this island as an
 * empty frame whatever the request carries — no session is read, no personal
 * value is in the HTML, so the public document stays shareable by any cache
 * (§8.1, SECURITY_BASELINE.md §17). Only after the page has mounted does the
 * browser ask `/api/my/target-state`, a private `no-store` answer, and fill the
 * frame in.
 *
 * A PAGE NEVER BREAKS BECAUSE OF IT. Signed out, it offers "sign in to save"
 * with a return to this page; if the private answer fails, it renders nothing.
 * Every write sends the version it was shown and reports a refusal in words;
 * a write from another window is a conflict the person is told about, never a
 * silent overwrite.
 *
 * HISTORY IS ONE POST, AFTER RENDER, AND ONLY WHEN THE PERSON TURNED IT ON —
 * the ref keeps a development double-mount from recording twice, as the Fatwa
 * read beacon does.
 *
 * Labels arrive as a plain object built on the server from the public message
 * catalogue: this module reaches no server code and no translation provider.
 */

export interface PersonalIslandLabels {
  readonly heading: string;
  readonly privacy: string;
  readonly signedOutPrompt: string;
  readonly signIn: string;
  readonly save: string;
  readonly savedStatus: string;
  readonly unsavedStatus: string;
  readonly noteAdd: string;
  readonly noteEdit: string;
  readonly noteLabel: string;
  readonly noteHelp: string;
  readonly noteSave: string;
  readonly noteDelete: string;
  readonly noteSaved: string;
  readonly noteDeleted: string;
  readonly noteConflict: string;
  readonly collections: string;
  readonly collectionsLegend: string;
  readonly collectionsEmpty: string;
  readonly collectionsManage: string;
  readonly collectionAdded: string;
  readonly collectionRemoved: string;
  readonly collectionConflict: string;
  readonly positionSet: string;
  readonly positionCurrent: string;
  readonly positionSaved: string;
  readonly positionConflict: string;
  readonly working: string;
  readonly sessionEnded: string;
  /** One message per refusal category; `unavailable` is the fallback. */
  readonly failures: Readonly<Record<string, string>> & { readonly unavailable: string };
}

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'signed-out'; readonly ended: boolean }
  | { readonly kind: 'ready'; readonly state: TargetState };

interface Status {
  readonly tone: 'neutral' | 'success' | 'error';
  readonly text: string;
}

type Collection = TargetState['collections'][number];

const PANEL =
  'flex flex-col gap-4 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] ' +
  'bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]';

const SUMMARY = 'inline-flex min-h-11 cursor-pointer items-center text-sm font-medium';

const STATUS_TONES: Record<Status['tone'], string> = {
  neutral: 'text-[color:var(--color-foreground-muted)]',
  success: 'text-[color:var(--color-foreground)]',
  error: 'font-medium text-[color:var(--color-error)]',
};

export function PersonalIsland({
  locale,
  target,
  noteMax,
  labels,
}: {
  readonly locale: string;
  readonly target: PersonalTarget;
  readonly noteMax: number;
  readonly labels: PersonalIslandLabels;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [returnTo, setReturnTo] = useState('');
  const recorded = useRef(false);
  const id = useId();
  const headingId = `${id}-heading`;
  const noteId = `${id}-note`;

  function signedOut(ended: boolean) {
    setReturnTo(window.location.pathname);
    setPhase({ kind: 'signed-out', ended });
  }

  useEffect(() => {
    const controller = new AbortController();
    void readTargetState(target, controller.signal).then((read) => {
      if (controller.signal.aborted) return;
      if (read.state === 'failed') {
        setPhase({ kind: 'hidden' });
        return;
      }
      if (read.state === 'signed-out') {
        setReturnTo(window.location.pathname);
        setPhase({ kind: 'signed-out', ended: false });
        return;
      }
      setDraft(read.value.note?.body ?? '');
      setPhase({ kind: 'ready', state: read.value });

      if (read.value.historyEnabled && !recorded.current) {
        recorded.current = true;
        void sendPersonal(
          'history',
          target.kind === 'video'
            ? { kind: 'watch', videoId: target.id }
            : { kind: 'read', target },
        );
      }
    });
    return () => controller.abort();
  }, [target]);

  /** Applies a confirmed change to the state this island shows. */
  function patch(change: (state: TargetState) => Partial<TargetState>) {
    setPhase((current) =>
      current.kind === 'ready'
        ? { kind: 'ready', state: { ...current.state, ...change(current.state) } }
        : current,
    );
  }

  /** Re-reads the versions after a conflict; the note being typed is kept. */
  async function refresh() {
    const read = await readTargetState(target, new AbortController().signal);
    if (read.state === 'signed-in') setPhase({ kind: 'ready', state: read.value });
    else if (read.state === 'signed-out') signedOut(true);
  }

  async function mutate(
    run: () => Promise<PersonalWrite>,
    done: (version: number | null) => void,
    success: string,
    conflict: string,
  ) {
    if (busy) return;
    setBusy(true);
    setStatus({ tone: 'neutral', text: labels.working });
    const result = await run();
    if (result.ok) {
      done(result.version);
      setStatus({ tone: 'success', text: success });
    } else if (result.failure === 'no-session') {
      setStatus(null);
      signedOut(true);
    } else if (result.failure === 'conflict') {
      await refresh();
      setStatus({ tone: 'error', text: conflict });
    } else {
      setStatus({
        tone: 'error',
        text: labels.failures[result.failure] ?? labels.failures.unavailable,
      });
    }
    setBusy(false);
  }

  const frame = (body: ReactNode) => (
    <div className="flex flex-col gap-3">
      {body}
      <p
        role="status"
        aria-live="polite"
        className={`text-sm empty:hidden ${status === null ? '' : STATUS_TONES[status.tone]}`}
      >
        {status?.text}
      </p>
    </div>
  );

  if (phase.kind === 'loading' || phase.kind === 'hidden') return frame(null);

  if (phase.kind === 'signed-out') {
    return frame(
      <section aria-labelledby={headingId} className={PANEL}>
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {labels.heading}
        </h2>
        <p className="text-sm">
          {phase.ended ? labels.sessionEnded : labels.signedOutPrompt}
        </p>
        <p className="text-sm">
          <TextLink href={`/${locale}/signin?returnTo=${encodeURIComponent(returnTo)}`}>
            {labels.signIn}
          </TextLink>
        </p>
      </section>,
    );
  }

  const { state } = phase;
  const note = state.note;

  const toggleBookmark = () =>
    mutate(
      () =>
        sendPersonal('bookmarks', {
          action: state.bookmarked ? 'remove' : 'add',
          target,
        }),
      () => patch((current) => ({ bookmarked: !current.bookmarked })),
      state.bookmarked ? labels.unsavedStatus : labels.savedStatus,
      labels.failures['conflict'] ?? labels.failures.unavailable,
    );

  const saveNote = () => {
    const body = draft.trim();
    return mutate(
      () =>
        sendPersonal('notes', {
          action: 'write',
          target,
          body,
          expectedVersion: note?.version ?? 0,
        }),
      (version) => {
        if (version !== null) patch(() => ({ note: { body, version } }));
        setDraft(body);
      },
      labels.noteSaved,
      labels.noteConflict,
    );
  };

  const deleteNote = () => {
    if (note === null) return;
    return mutate(
      () =>
        sendPersonal('notes', {
          action: 'remove',
          target,
          expectedVersion: note.version,
        }),
      () => {
        patch(() => ({ note: null }));
        setDraft('');
      },
      labels.noteDeleted,
      labels.noteConflict,
    );
  };

  const toggleCollection = (collection: Collection) =>
    mutate(
      () =>
        sendPersonal('collection-items', {
          action: collection.member ? 'remove' : 'add',
          collectionId: collection.id,
          target,
          expectedVersion: collection.version,
        }),
      (version) =>
        patch((current) => ({
          collections: current.collections.map((row) =>
            row.id === collection.id
              ? { ...row, member: !row.member, version: version ?? row.version }
              : row,
          ),
        })),
      collection.member ? labels.collectionRemoved : labels.collectionAdded,
      labels.collectionConflict,
    );

  const setPosition = () => {
    if (target.kind !== 'ayah') return;
    return mutate(
      () =>
        sendPersonal('quran-progress', {
          surah: target.surah,
          ayah: target.ayah,
          expectedVersion: state.quranProgressVersion,
        }),
      (version) =>
        patch((current) => ({
          quranPosition: true,
          quranProgressVersion: version ?? current.quranProgressVersion,
        })),
      labels.positionSaved,
      labels.positionConflict,
    );
  };

  return frame(
    <section aria-labelledby={headingId} className={PANEL}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {labels.heading}
        </h2>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {labels.privacy}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          tone={state.bookmarked ? 'primary' : 'secondary'}
          aria-pressed={state.bookmarked}
          disabled={busy}
          onClick={() => void toggleBookmark()}
        >
          {/* ONE label, state in `aria-pressed` and a visible mark — a toggle
              whose name changed with its state would be announced twice. */}
          {state.bookmarked ? <span aria-hidden="true">✓ </span> : null}
          {labels.save}
        </Button>

        {target.kind !== 'ayah' ? null : state.quranPosition ? (
          <p className="text-sm font-medium">{labels.positionCurrent}</p>
        ) : (
          <Button
            type="button"
            tone="secondary"
            disabled={busy}
            onClick={() => void setPosition()}
          >
            {labels.positionSet}
          </Button>
        )}
      </div>

      <details>
        <summary className={SUMMARY}>
          {note === null ? labels.noteAdd : labels.noteEdit}
        </summary>
        <div className="flex flex-col gap-3 pt-2">
          <Field id={noteId} label={labels.noteLabel} help={labels.noteHelp}>
            {(field) => (
              <TextArea
                {...field}
                rows={4}
                dir="auto"
                maxLength={noteMax}
                value={draft}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={busy || draft.trim() === ''}
              onClick={() => void saveNote()}
            >
              {labels.noteSave}
            </Button>
            {note === null ? null : (
              <Button
                type="button"
                tone="destructive"
                disabled={busy}
                onClick={() => void deleteNote()}
              >
                {labels.noteDelete}
              </Button>
            )}
          </div>
        </div>
      </details>

      <details>
        <summary className={SUMMARY}>{labels.collections}</summary>
        <div className="flex flex-col gap-3 pt-2">
          {state.collections.length === 0 ? (
            <p className="text-sm">{labels.collectionsEmpty}</p>
          ) : (
            <fieldset className="flex min-w-0 flex-col gap-1" disabled={busy}>
              <legend className="pb-1 text-sm font-medium">
                {labels.collectionsLegend}
              </legend>
              {state.collections.map((collection) => (
                <label
                  key={collection.id}
                  className="flex min-h-11 min-w-0 items-center gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-5 shrink-0"
                    checked={collection.member}
                    onChange={() => void toggleCollection(collection)}
                  />
                  <span dir="auto" className="min-w-0 break-words">
                    {collection.title}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <p className="text-sm">
            <TextLink href={`/${locale}/my/saved/collections`}>
              {labels.collectionsManage}
            </TextLink>
          </p>
        </div>
      </details>
    </section>,
  );
}
