'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Select } from '@/components/ui';

/**
 * One member as the editor sees it: its `kind:id` token, its type and a title
 * the server resolved from the member's OWNER. A member its owner no longer
 * publishes arrives with a generic localized label instead of a title, so no
 * private title ever reaches this component.
 */
export interface CollectionMemberEntry {
  readonly token: string;
  readonly kind: string;
  readonly title: string;
  /** The title's language, when it is a real title rather than a label. */
  readonly language: string | null;
}

type Control = 'up' | 'down' | 'remove';

/** `{name}` placeholders only; the messages these fill carry no plural rules. */
function fill(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/**
 * A Collection's ordered members — Phase 15.
 *
 * KEYBOARD, NOT DRAG. Each member has real Move up, Move down and Remove
 * buttons whose accessible names carry its title and position. After a move
 * focus stays on the moved member's control (or its other move control when
 * it reaches an end), after a removal it goes to a neighbour, and a polite
 * live region says what happened.
 *
 * THE ORDER IS POSTED, NOT TRUSTED. The list is emitted as hidden `member-{i}`
 * fields in its current order; the Server Action parses them and the strict
 * content contract and the service decide whether the set may be saved. The
 * choices offered here are bounded public records the server already chose.
 *
 * The list lives in this component's state, so a refused save — which keeps
 * the form mounted — returns the editor to exactly the list they submitted.
 * While it differs from the saved list it is ALSO carried by the reference
 * search form (hidden `pending` fields tied to it by the `form` attribute,
 * with the version it was edited from), so searching for more items reloads
 * the editor with this list rather than losing it. That GET only re-seeds this
 * list; labels are resolved public-only and the save still decides.
 */
export function CollectionMembersIsland({
  initial,
  saved,
  version,
  searchForm,
  choices,
  types,
  limit,
  labels,
}: {
  initial: readonly CollectionMemberEntry[];
  /** The saved revision's member tokens, in order — what "unsaved" means. */
  saved: readonly string[];
  /** The record version the list is edited from (0 for a new record). */
  version: number;
  /** The id of the reference search form that carries an unsaved list. */
  searchForm: string;
  choices: readonly CollectionMemberEntry[];
  types: readonly { readonly kind: string; readonly label: string }[];
  limit: number;
  labels: Readonly<Record<string, string>>;
}) {
  const [members, setMembers] = useState<readonly CollectionMemberEntry[]>(initial);
  const [type, setType] = useState(types[0]?.kind ?? '');
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState('');
  // Where focus goes once the list a move or removal produced has rendered;
  // consumed by that one render, so a later edit never pulls focus back.
  const focusRequest = useRef<{
    readonly token: string | null;
    readonly control: Control;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const label = (key: string) => labels[key] ?? key;
  const typeLabel = (kind: string) =>
    types.find((entry) => entry.kind === kind)?.label ?? kind;
  const offered = choices.filter((choice) => choice.kind === type);
  const unsaved = members.map((member) => member.token).join(' ') !== saved.join(' ');

  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (request === null) return;
    const token = request.token;
    if (token === null) {
      root.current?.querySelector<HTMLSelectElement>('#member-add-type')?.focus();
      return;
    }
    const find = (control: Control) =>
      root.current?.querySelector<HTMLButtonElement>(
        `[data-member="${CSS.escape(token)}"][data-control="${control}"]`,
      );
    const wanted = find(request.control);
    // A member moved to an end keeps focus on its other move control.
    const other =
      request.control === 'up'
        ? find('down')
        : request.control === 'down'
          ? find('up')
          : null;
    (wanted && !wanted.disabled ? wanted : (other ?? wanted))?.focus();
  }, [members]);

  function move(index: number, by: -1 | 1) {
    const to = index + by;
    const moved = members[index];
    if (moved === undefined || to < 0 || to >= members.length) return;
    const next = [...members];
    next.splice(index, 1);
    next.splice(to, 0, moved);
    setMembers(next);
    focusRequest.current = { token: moved.token, control: by < 0 ? 'up' : 'down' };
    setStatus(
      fill(label('memberMoved'), {
        title: moved.title,
        position: to + 1,
        count: next.length,
      }),
    );
  }

  function remove(index: number) {
    const removed = members[index];
    if (removed === undefined) return;
    const next = members.filter((_, position) => position !== index);
    setMembers(next);
    const neighbour = next[index] ?? next[index - 1] ?? null;
    focusRequest.current = { token: neighbour?.token ?? null, control: 'remove' };
    setStatus(fill(label('memberRemoved'), { title: removed.title }));
  }

  function add() {
    const chosen = offered.find((choice) => choice.token === target);
    if (chosen === undefined) {
      setStatus(label('memberChooseFirst'));
      return;
    }
    if (members.some((member) => member.token === chosen.token)) {
      setStatus(fill(label('memberDuplicate'), { title: chosen.title }));
      return;
    }
    if (members.length >= limit) {
      setStatus(fill(label('memberLimit'), { limit }));
      return;
    }
    const next = [...members, chosen];
    setMembers(next);
    setTarget('');
    setStatus(
      fill(label('memberAdded'), {
        title: chosen.title,
        position: next.length,
        count: next.length,
      }),
    );
  }

  return (
    <div ref={root} className="flex flex-col gap-4">
      {members.map((member, index) => (
        <input
          key={member.token}
          type="hidden"
          name={`member-${index}`}
          value={member.token}
        />
      ))}
      {unsaved ? (
        <>
          <input type="hidden" form={searchForm} name="pendingVersion" value={version} />
          {members.map((member) => (
            <input
              key={member.token}
              type="hidden"
              form={searchForm}
              name="pending"
              value={member.token}
            />
          ))}
        </>
      ) : null}
      {members.length === 0 ? (
        <p className="text-sm">{label('memberListEmpty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {members.map((member, index) => {
            const values = {
              title: member.title,
              position: index + 1,
              count: members.length,
            };
            return (
              <li
                key={member.token}
                className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border)] p-3"
              >
                <p className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <span className="text-sm text-[color:var(--color-foreground-muted)]">
                    {index + 1}.
                  </span>
                  <span className="rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-2 py-0.5 text-xs font-medium">
                    {typeLabel(member.kind)}
                  </span>
                  <span
                    className="min-w-0 wrap-anywhere"
                    lang={member.language ?? undefined}
                    dir={member.language === null ? undefined : 'auto'}
                  >
                    {member.title}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    tone="secondary"
                    data-member={member.token}
                    data-control="up"
                    disabled={index === 0}
                    aria-label={fill(label('memberMoveUpLabel'), values)}
                    onClick={() => move(index, -1)}
                  >
                    {label('memberMoveUp')}
                  </Button>
                  <Button
                    type="button"
                    tone="secondary"
                    data-member={member.token}
                    data-control="down"
                    disabled={index === members.length - 1}
                    aria-label={fill(label('memberMoveDownLabel'), values)}
                    onClick={() => move(index, 1)}
                  >
                    {label('memberMoveDown')}
                  </Button>
                  <Button
                    type="button"
                    tone="destructive"
                    data-member={member.token}
                    data-control="remove"
                    aria-label={fill(label('memberRemoveLabel'), values)}
                    onClick={() => remove(index)}
                  >
                    {label('memberRemove')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {unsaved ? <p className="text-sm font-medium">{label('memberUnsaved')}</p> : null}
      <fieldset className="flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-3">
        <legend className="text-sm font-medium">{label('memberAddGroup')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="member-add-type" className="text-sm font-medium">
              {label('memberType')}
            </label>
            <Select
              id="member-add-type"
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setTarget('');
              }}
            >
              {types.map((entry) => (
                <option key={entry.kind} value={entry.kind}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="member-add-target" className="text-sm font-medium">
              {label('memberTarget')}
            </label>
            <Select
              id="member-add-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">
                {offered.length === 0
                  ? label('memberNoChoices')
                  : label('memberTargetNone')}
              </option>
              {offered.map((choice) => (
                <option key={choice.token} value={choice.token}>
                  {choice.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Button type="button" tone="secondary" onClick={add}>
            {label('memberAdd')}
          </Button>
        </div>
      </fieldset>
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {status}
      </p>
    </div>
  );
}
