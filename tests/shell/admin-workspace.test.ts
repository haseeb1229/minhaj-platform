import { describe, expect, it } from 'vitest';

import {
  readAuditFilters,
  utcDay,
} from '../../apps/web/src/app/[locale]/admin/system/audit/filters.ts';
import {
  DIFF_LIMIT,
  htmlToText,
  tokens,
  wordDiff,
} from '../../apps/web/src/components/editorial/revision-diff.ts';
import {
  isConfirmedSubmit,
  reasonReady,
} from '../../apps/web/src/components/ui/confirm-action.tsx';

/**
 * R2 — THE ADMINISTRATION WORKSPACE'S PURE HELPERS: the editorial revision
 * diff, the audit record's filters and the confirmation gate.
 */

const join = (diff: ReturnType<typeof wordDiff>, keep: 'before' | 'after') =>
  diff.segments
    .filter(
      (segment) =>
        segment.kind === 'same' ||
        segment.kind === (keep === 'before' ? 'removed' : 'added'),
    )
    .map((segment) => segment.text)
    .join('');

describe('the revision diff', () => {
  it('reassembles text exactly from its words', () => {
    const text = '  Shaykh-ul-Islam  spoke\nat the  conference. ';
    expect(tokens(text).join('')).toBe(text);
  });

  it('reports identical text as one unchanged run', () => {
    const diff = wordDiff('The same words.', 'The same words.');
    expect(diff.identical).toBe(true);
    expect(diff.segments).toEqual([{ kind: 'same', text: 'The same words.' }]);
  });

  it('marks an inserted word and keeps the rest unchanged', () => {
    const diff = wordDiff(
      'The conference opened today.',
      'The annual conference opened today.',
    );
    expect(diff.identical).toBe(false);
    expect(diff.segments).toEqual([
      { kind: 'same', text: 'The ' },
      { kind: 'added', text: 'annual ' },
      { kind: 'same', text: 'conference opened today.' },
    ]);
  });

  it('marks a replaced word as a removal and an addition', () => {
    const diff = wordDiff('Held in Lahore on Friday.', 'Held in Karachi on Friday.');
    expect(diff.segments).toContainEqual({ kind: 'removed', text: 'Lahore ' });
    expect(diff.segments).toContainEqual({ kind: 'added', text: 'Karachi ' });
    expect(join(diff, 'before')).toBe('Held in Lahore on Friday.');
    expect(join(diff, 'after')).toBe('Held in Karachi on Friday.');
  });

  it('diffs right-to-left text word by word', () => {
    const diff = wordDiff('منہاج القرآن کی کانفرنس', 'منہاج القرآن کی سالانہ کانفرنس');
    expect(diff.segments).toContainEqual({ kind: 'added', text: 'سالانہ ' });
    expect(join(diff, 'after')).toBe('منہاج القرآن کی سالانہ کانفرنس');
  });

  it('reports an empty side as a whole addition or removal', () => {
    expect(wordDiff('', 'New text').segments).toEqual([
      { kind: 'added', text: 'New text' },
    ]);
    expect(wordDiff('Old text', '').segments).toEqual([
      { kind: 'removed', text: 'Old text' },
    ]);
  });

  it('does not align a changed middle larger than its bound, and says so', () => {
    const many = (word: string) =>
      Array.from({ length: DIFF_LIMIT + 1 }, () => word).join(' ');
    const diff = wordDiff(`start ${many('a')} end`, `start ${many('b')} end`);
    expect(diff.truncated).toBe(true);
    expect(join(diff, 'before')).toBe(`start ${many('a')} end`);
    expect(join(diff, 'after')).toBe(`start ${many('b')} end`);
  });

  it('compares the words of sanitised HTML, never its markup', () => {
    expect(
      htmlToText('<p>One &amp; two</p><p>Three&nbsp;<strong>four</strong></p>'),
    ).toBe('One & two\nThree four');
    expect(htmlToText('<p>&#39;quoted&#x27; &lt;b&gt;</p>')).toBe("'quoted' <b>");
    // An entity naming no character is left as written.
    expect(htmlToText('&#0; &unknown;')).toBe('&#0; &unknown;');
  });
});

describe('the audit filters', () => {
  it('reads a prefix, an actor and an inclusive day range', () => {
    const filters = readAuditFilters({
      action: 'role.',
      actor: 'acc_123-x',
      from: '2026-11-01',
      to: '2026-11-07',
    });
    expect(filters.action).toBe('role.');
    expect(filters.actorId).toBe('acc_123-x');
    expect(filters.from?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    // The end is exclusive: the whole of the 7th is included.
    expect(filters.to?.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect([filters.fromDay, filters.toDay]).toEqual(['2026-11-01', '2026-11-07']);
  });

  it('drops values that are not of the record’s shape instead of passing them on', () => {
    const filters = readAuditFilters({
      action: "role.%' OR 1=1 --",
      actor: '../../etc',
      from: '2026-02-30',
      to: 'yesterday',
    });
    expect(filters).toEqual({
      action: null,
      actorId: null,
      fromDay: null,
      toDay: null,
      from: null,
      to: null,
    });
  });

  it('ignores repeated parameters and blank values', () => {
    expect(readAuditFilters({ action: ['a', 'b'], actor: '   ' }).action).toBeNull();
    expect(readAuditFilters({ actor: '   ' }).actorId).toBeNull();
  });

  it('puts a backwards range the right way round', () => {
    const filters = readAuditFilters({ from: '2026-11-07', to: '2026-11-01' });
    expect(filters.fromDay).toBe('2026-11-01');
    expect(filters.toDay).toBe('2026-11-07');
    expect(filters.to?.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it('accepts only real calendar days', () => {
    expect(utcDay('2028-02-29')?.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(utcDay('2026-02-29')).toBeNull();
    expect(utcDay('2026-13-01')).toBeNull();
    expect(utcDay('1999-01-01')).toBeNull();
    expect(utcDay(null)).toBeNull();
  });
});

describe('the confirmation gate', () => {
  const button = (confirm: string | null) => ({
    getAttribute: (name: string) => (name === 'data-confirm' ? confirm : null),
  });

  it('lets through only a submit from the dialog’s own button', () => {
    expect(isConfirmedSubmit(button('yes'))).toBe(true);
    expect(isConfirmedSubmit(button(null))).toBe(false);
    expect(isConfirmedSubmit(button('true'))).toBe(false);
    // Enter in a field submits with no submitter at all.
    expect(isConfirmedSubmit(null)).toBe(false);
    expect(isConfirmedSubmit(undefined)).toBe(false);
  });

  it('holds the confirm button until a required reason says something', () => {
    expect(reasonReady('', true)).toBe(false);
    expect(reasonReady('   \n', true)).toBe(false);
    expect(reasonReady('Left the team', true)).toBe(true);
    expect(reasonReady('', false)).toBe(true);
  });
});
