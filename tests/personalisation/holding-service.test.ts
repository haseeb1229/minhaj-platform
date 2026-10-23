import { describe, expect, it } from 'vitest';

import type { PersonalHoldingPort } from '../../packages/contracts/src/personalisation/index.ts';
import {
  PersonalRefusal,
  createHoldingService,
  personalFailure,
} from '../../apps/web/src/contexts/personalisation-notifications/index.ts';

/**
 * Phase 29 — Personalisation's one-bit holding answer, over a fake port.
 *
 * WHAT IS PROVED HERE: a malformed id never reaches the port; the answer is
 * exactly the port's boolean; an adapter refusal keeps its category and an
 * outage stays an outage. What only the database can prove is in
 * `holdings.integration.test.ts`.
 */

const VIDEO = '00000000-0000-4000-8000-000000000029';

function port(answer: () => Promise<boolean>) {
  const calls: string[] = [];
  const holdings: PersonalHoldingPort = {
    videoHeld: async (videoId) => {
      calls.push(videoId);
      return answer();
    },
  };
  return { holdings, calls };
}

describe('Phase 29 Personalisation holding answer', () => {
  it('answers exactly what the port says, for a well-formed id', async () => {
    for (const held of [true, false]) {
      const { holdings, calls } = port(async () => held);
      await expect(createHoldingService({ holdings }).videoHeld(VIDEO)).resolves.toBe(
        held,
      );
      expect(calls).toEqual([VIDEO]);
    }
  });

  it('refuses a malformed id before asking the port', async () => {
    const { holdings, calls } = port(async () => true);
    const service = createHoldingService({ holdings });
    for (const bad of [
      '',
      'not-a-uuid',
      `${VIDEO} OR 1=1`,
      VIDEO.toUpperCase().replace('4000', 'zzzz'),
    ]) {
      const failure = await service.videoHeld(bad).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(PersonalRefusal);
      expect(personalFailure(failure)).toBe('invalid');
    }
    expect(calls).toEqual([]);
  });

  it('keeps an adapter refusal as a refusal and an outage as an outage', async () => {
    const refused = port(async () => {
      throw Object.assign(new Error('denied'), { reason: 'denied' });
    });
    const failure = await createHoldingService(refused)
      .videoHeld(VIDEO)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PersonalRefusal);
    expect(personalFailure(failure)).toBe('denied');

    const outage = port(async () => {
      throw new Error('connection lost');
    });
    const lost = await createHoldingService(outage)
      .videoHeld(VIDEO)
      .catch((error: unknown) => error);
    expect(lost).not.toBeInstanceOf(PersonalRefusal);
    expect(personalFailure(lost)).toBe('unavailable');
  });
});
