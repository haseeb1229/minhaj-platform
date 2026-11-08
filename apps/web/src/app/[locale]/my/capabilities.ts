import 'server-only';

import { cache } from 'react';

import type { MyCapabilities } from '@/components/my/sections';
import { fatwaRuntime } from '@/composition/fatwa';
import { learningRuntime } from '@/composition/learning';
import { messagingRuntime } from '@/composition/messaging';
import { readPresence } from '@/composition/presence';
import { hasSignal } from '@/shell/presence';

/**
 * Which My Minhaj sections this deployment has switched on (R2) — each
 * answered by its OWNER's session-free read: the presence snapshot the public
 * shell already uses (Quran, courses, membership, giving), Learning's live
 * activation, Messaging's capabilities and Fatwa's intake.
 *
 * NOTHING PERSONAL. No session, no account: this is deployment state, so the
 * layout that asks stays session-free and every page keeps sending a
 * signed-out visitor to sign in with its own return address.
 *
 * FAIL CLOSED, PER ANSWER. A read that throws hides only its own section;
 * the page behind it still answers at its address, and the home page still
 * links to anything the person already has there.
 */
async function answer(read: () => Promise<boolean>): Promise<boolean> {
  try {
    return await read();
  } catch {
    return false;
  }
}

export const myCapabilities = cache(async (): Promise<MyCapabilities> => {
  const [presence, live, messaging, questions] = await Promise.all([
    readPresence(),
    answer(() => learningRuntime().myClasses.activated()),
    answer(async () => {
      const capabilities = await messagingRuntime().service.capabilities();
      return capabilities.teacherStudent || capabilities.support;
    }),
    answer(async () => (await fatwaRuntime().ask.availability()).active),
  ]);
  return {
    quran: hasSignal(presence, 'quran'),
    learning: hasSignal(presence, 'learn'),
    live,
    messaging,
    questions,
    membership: hasSignal(presence, 'membership'),
    giving: hasSignal(presence, 'giving'),
  };
});
