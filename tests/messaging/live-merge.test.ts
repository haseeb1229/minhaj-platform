import { describe, expect, it } from 'vitest';

import type { RealtimeMessage } from '../../packages/contracts/src/messaging/index.ts';
import {
  ackOf,
  caughtUpTo,
  highestHeld,
  liveAfter,
  mergeLive,
  newestFromOthers,
  realtimeMessageOf,
  realtimeMessagesOf,
  signalOf,
} from '../../apps/web/src/components/messaging/live-merge.ts';

/**
 * Phase 25 — how live messages join the server-rendered history, proved
 * without a browser or a socket.
 *
 * The claims the browser proofs rely on: a message is ONE item however many
 * times it arrives; the thread is ordered by the conversation's sequence and
 * never by a clock; nothing the server already rendered is drawn twice; a hole
 * in the sequence is detected so the durable catch-up can fill it; and a frame
 * that is not the shape the thread draws is never rendered. Every body is a
 * synthetic sentinel.
 */

const CONVERSATION = '00000000-0000-4000-8000-000000000001';

function message(
  sequence: number,
  overrides: Partial<RealtimeMessage> = {},
): RealtimeMessage {
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    sequence,
    senderAccountId: 'synthetic-sender',
    own: false,
    body: `NON_LIVE_FIXTURE ${String(sequence)}`,
    withheld: false,
    // Deliberately NOT in sequence order: order must come from the sequence.
    sentAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 60 - sequence)).toISOString(),
    attachments: [],
    ...overrides,
  };
}

const sequences = (list: readonly RealtimeMessage[]) =>
  list.map((entry) => entry.sequence);

describe('mergeLive', () => {
  it('orders by sequence, whatever the arrival order or the clock', () => {
    const merged = mergeLive([], [message(7), message(5), message(6)]);
    expect(sequences(merged)).toEqual([5, 6, 7]);
    const later = mergeLive(merged, [message(9), message(8)]);
    expect(sequences(later)).toEqual([5, 6, 7, 8, 9]);
  });

  it('keeps one item per message when the same message arrives twice', () => {
    // The send acknowledgement, a fan-out to another tab and a catch-up page
    // that overlaps a delivery all carry the same committed message.
    const once = mergeLive([], [message(3)]);
    const twice = mergeLive(once, [message(3), message(3)]);
    expect(twice).toHaveLength(1);
    const overlapped = mergeLive(twice, [message(2), message(3), message(4)]);
    expect(sequences(overlapped)).toEqual([2, 3, 4]);
    expect(new Set(overlapped.map((entry) => entry.id)).size).toBe(3);
  });

  it('replaces a message by a later read of it, never duplicating it', () => {
    const shown = mergeLive([], [message(4)]);
    const withheld = mergeLive(shown, [message(4, { body: null, withheld: true })]);
    expect(withheld).toEqual([message(4, { body: null, withheld: true })]);
  });

  it('never lets a second identifier take a sequence already held', () => {
    const shown = mergeLive([], [message(4)]);
    const impostor = message(4, { id: '00000000-0000-4000-8000-0000000000ff' });
    expect(mergeLive(shown, [impostor])).toEqual(shown);
  });

  it('returns the same list when nothing arrives', () => {
    const shown = mergeLive([], [message(1)]);
    expect(mergeLive(shown, [])).toBe(shown);
  });
});

describe('liveAfter', () => {
  it('draws nothing the server-rendered base already holds, by sequence or by id', () => {
    const live = mergeLive([], [message(4), message(5), message(6), message(7)]);
    // The base ends at 5; message 6 was re-rendered into it by a refresh too.
    const base = new Set([message(6).id]);
    expect(sequences(liveAfter(live, 5, base))).toEqual([7]);
    expect(liveAfter(live, 7, new Set())).toEqual([]);
  });
});

describe('caughtUpTo', () => {
  it('is the highest sequence reached from the floor without a hole', () => {
    expect(caughtUpTo([], 5)).toBe(5);
    expect(caughtUpTo(mergeLive([], [message(6), message(7)]), 5)).toBe(7);
    // 8 is missing: a message sent through the web path, never fanned out.
    expect(caughtUpTo(mergeLive([], [message(6), message(7), message(9)]), 5)).toBe(7);
    // Live messages at or below the floor are the base's business.
    expect(caughtUpTo(mergeLive([], [message(3), message(6)]), 5)).toBe(6);
    // A first live message that is not the next one is a hole at once.
    expect(caughtUpTo(mergeLive([], [message(8)]), 5)).toBe(5);
  });

  it('closes the hole once catch-up supplies the missing message', () => {
    const holed = mergeLive([], [message(6), message(8)]);
    expect(caughtUpTo(holed, 5)).toBe(6);
    expect(caughtUpTo(mergeLive(holed, [message(7)]), 5)).toBe(8);
  });
});

describe('highestHeld and newestFromOthers', () => {
  it('reports the highest sequence held, base or live', () => {
    expect(highestHeld([], 4)).toBe(4);
    expect(highestHeld(mergeLive([], [message(9)]), 4)).toBe(9);
  });

  it('finds the newest message someone else sent after a position', () => {
    const live = mergeLive(
      [],
      [message(5), message(6, { own: true }), message(7, { own: true })],
    );
    expect(newestFromOthers(live, 4)?.sequence).toBe(5);
    expect(newestFromOthers(live, 5)).toBeNull();
    expect(newestFromOthers([], 0)).toBeNull();
  });
});

describe('realtimeMessageOf', () => {
  it('accepts exactly the shape the thread draws', () => {
    const frame = message(2, {
      attachments: [
        { id: 'synthetic-file', mediaType: 'image/png', byteSize: 12, displayName: null },
      ],
    });
    expect(realtimeMessageOf(JSON.parse(JSON.stringify(frame)))).toEqual(frame);
    expect(realtimeMessageOf(message(3, { body: null, withheld: true }))).not.toBeNull();
  });

  it('copies only the known fields, so nothing extra reaches the page', () => {
    const parsed = realtimeMessageOf({ ...message(2), html: '<b>NON_LIVE_FIXTURE</b>' });
    expect(parsed).toEqual(message(2));
    expect(parsed).not.toHaveProperty('html');
  });

  it.each([
    ['nothing', null],
    ['a list', [message(1)]],
    ['no sequence', { ...message(1), sequence: undefined }],
    ['a zero sequence', { ...message(1), sequence: 0 }],
    ['a fractional sequence', { ...message(1), sequence: 1.5 }],
    ['a numeric body', { ...message(1), body: 42 }],
    ['a markup object body', { ...message(1), body: { __html: 'x' } }],
    ['no own flag', { ...message(1), own: 'yes' }],
    ['an unreadable instant', { ...message(1), sentAt: 'not-a-time' }],
    ['no attachments', { ...message(1), attachments: undefined }],
    [
      'an attachment of another type',
      {
        ...message(1),
        attachments: [
          { id: 'synthetic', mediaType: 'text/html', byteSize: 1, displayName: null },
        ],
      },
    ],
  ])('refuses %s', (_name, frame) => {
    expect(realtimeMessageOf(frame)).toBeNull();
  });

  it('keeps the well-formed messages of a page and drops the rest', () => {
    expect(
      sequences(realtimeMessagesOf([message(1), { nonsense: true }, message(2)])),
    ).toEqual([1, 2]);
    expect(realtimeMessagesOf('not a list')).toEqual([]);
  });
});

describe('ackOf and signalOf', () => {
  it('reads an acknowledgement, and words anything unexpected as unavailable', () => {
    expect(ackOf({ ok: true, value: { more: false } })).toEqual({
      ok: true,
      value: { more: false },
    });
    expect(ackOf({ ok: false, failure: 'blocked' })).toEqual({
      ok: false,
      failure: 'blocked',
    });
    for (const odd of [
      undefined,
      'ok',
      { ok: true },
      { ok: true, value: [1] },
      { ok: false, failure: 'stack trace at line 3' },
      { ok: false },
    ])
      expect(ackOf(odd)).toEqual({ ok: false, failure: 'unavailable' });
  });

  it('accepts a server event only for this conversation', () => {
    expect(
      signalOf({ conversationId: CONVERSATION, typing: true }, CONVERSATION),
    ).toEqual({
      conversationId: CONVERSATION,
      typing: true,
    });
    expect(
      signalOf(
        { conversationId: '00000000-0000-4000-8000-000000000002', typing: true },
        CONVERSATION,
      ),
    ).toBeNull();
    expect(signalOf(null, CONVERSATION)).toBeNull();
    expect(signalOf([CONVERSATION], CONVERSATION)).toBeNull();
  });
});
