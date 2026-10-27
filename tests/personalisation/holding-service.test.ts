import { describe, expect, it } from 'vitest';

import type { PersonalHoldingPort } from '../../packages/contracts/src/personalisation/index.ts';
import {
  PersonalRefusal,
  createHoldingService,
  personalFailure,
} from '../../apps/web/src/contexts/personalisation-notifications/index.ts';

/**
 * Phases 29–30 — Personalisation's one-bit holding answers, over a fake port.
 *
 * WHAT IS PROVED HERE, for each target this context can hold (a Video, a Work,
 * an Article): a malformed id never reaches the port; the answer is exactly
 * the port's boolean, asked of THAT target's question and no other; an adapter
 * refusal keeps its category and an outage stays an outage. What only the
 * database can prove is in `holdings.integration.test.ts`.
 */

const ID = '00000000-0000-4000-8000-000000000029';
const QUESTIONS = ['videoHeld', 'workHeld', 'articleHeld'] as const;
type Question = (typeof QUESTIONS)[number];

function port(answer: () => Promise<boolean>) {
  const calls: [Question, string][] = [];
  const asked =
    (question: Question) =>
    async (id: string): Promise<boolean> => {
      calls.push([question, id]);
      return answer();
    };
  const holdings: PersonalHoldingPort = {
    videoHeld: asked('videoHeld'),
    workHeld: asked('workHeld'),
    articleHeld: asked('articleHeld'),
  };
  return { holdings, calls };
}

describe('Personalisation holding answers', () => {
  it('answers exactly what the port says, for a well-formed id, asking only that question', async () => {
    for (const question of QUESTIONS)
      for (const held of [true, false]) {
        const { holdings, calls } = port(async () => held);
        await expect(createHoldingService({ holdings })[question](ID)).resolves.toBe(
          held,
        );
        expect(calls).toEqual([[question, ID]]);
      }
  });

  it('refuses a malformed id before asking the port', async () => {
    const { holdings, calls } = port(async () => true);
    const service = createHoldingService({ holdings });
    for (const question of QUESTIONS)
      for (const bad of [
        '',
        'not-a-uuid',
        `${ID} OR 1=1`,
        ID.toUpperCase().replace('4000', 'zzzz'),
      ]) {
        const failure = await service[question](bad).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(PersonalRefusal);
        expect(personalFailure(failure)).toBe('invalid');
      }
    expect(calls).toEqual([]);
  });

  it('keeps an adapter refusal as a refusal and an outage as an outage', async () => {
    for (const question of QUESTIONS) {
      const refused = port(async () => {
        throw Object.assign(new Error('denied'), { reason: 'denied' });
      });
      const refusing = createHoldingService(refused);
      const failure = await refusing[question](ID).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(PersonalRefusal);
      expect(personalFailure(failure)).toBe('denied');

      const outage = port(async () => {
        throw new Error('connection lost');
      });
      const failing = createHoldingService(outage);
      const lost = await failing[question](ID).catch((error: unknown) => error);
      expect(lost).not.toBeInstanceOf(PersonalRefusal);
      expect(personalFailure(lost)).toBe('unavailable');
    }
  });
});
