import 'server-only';

import type { Locale } from '@minhaj/contracts';
import { isOpenApplication } from '@minhaj/contracts/membership';
import { targetKey, type PersonalTarget } from '@minhaj/contracts/personalisation';

import { donationsRead } from '@/components/donations/read';
import { membershipRead } from '@/components/membership/read';
import { messagingRead, participantNames } from '@/components/messaging/read';
import { learningRead } from '@/components/my-learning/read';
import { personalRead } from '@/components/personal/read';
import { donationsRuntime } from '@/composition/donations';
import { fatwaRuntime } from '@/composition/fatwa';
import { learningRuntime } from '@/composition/learning';
import { appLogger } from '@/composition/logging';
import { membershipRuntime } from '@/composition/membership';
import { messagingRuntime } from '@/composition/messaging';
import { personalisationRuntime } from '@/composition/personalisation';
import {
  resolvePersonalTargets,
  type ResolvedTarget,
} from '@/composition/personal-targets';

/**
 * The My Minhaj home page's reads (R2) — Layer 4 composition, each OWNER asked
 * separately with the session's own account, so one owner's outage never
 * blanks another's module.
 *
 * NOTHING NEW IS READ. Every call here is one the area's pages already make:
 * Personalisation's saved items, history, Quran position, settings and
 * notifications; Learning's enrolments and upcoming classes, and the meeting
 * address only through its disclosure read; Messaging's conversation list and
 * unread total; Fatwa's own-questions list; Membership's applicant state;
 * Donations' own history. Titles of saved and read things are their owners'
 * answers, asked now.
 *
 * THE MEETING ADDRESS is asked for ONE class — the next — and only when that
 * class holds one; the read itself decides whether it may be shown
 * (activation in force, the teacher's scope current, the person a current
 * participant).
 */

const SAVED_SHELF = 8;
const NOTIFICATIONS = 5;
const CONVERSATIONS = 3;

/** Personalisation's reads for the home page, in one round. */
async function personalPanels(accountId: string) {
  const actor = { accountId };
  const { saved, history, settings, notifications } = personalisationRuntime();
  const [current, recent, progress, unread, latest] = await Promise.all([
    settings.settings(actor),
    saved.recent(actor, SAVED_SHELF),
    history.quranProgress(actor),
    notifications.unread(actor),
    notifications.notifications(actor, 0),
  ]);
  const [reading, watching] = current.historyEnabled
    ? await Promise.all([history.reading(actor, 0), history.watching(actor, 0)])
    : [null, null];
  return {
    settings: current,
    saved: recent,
    quran: progress,
    unread,
    notifications: latest.items.slice(0, NOTIFICATIONS),
    notificationTotal: latest.total,
    lastRead: reading?.items[0] ?? null,
    lastWatched: watching?.items[0] ?? null,
  };
}

async function questionsPanel(accountId: string) {
  try {
    const page = await fatwaRuntime().ask.questions({ accountId }, 0);
    return {
      ok: true as const,
      value: { total: page.total, latest: page.items[0] ?? null },
    };
  } catch {
    appLogger().error({ operation: 'fatwa-home' }, 'Fatwa read failed.');
    return { ok: false as const };
  }
}

export async function readHome(accountId: string, locale: Locale) {
  const actor = { accountId };
  const [learning, classes, messages, membership, donations, questions, personal] =
    await Promise.all([
      learningRead('learning-home', () => learningRuntime().learner.courses(actor, 0)),
      learningRead('learning-home-classes', async () => {
        const { myClasses } = learningRuntime();
        const next = (await myClasses.upcoming(actor))[0] ?? null;
        const join =
          next !== null && next.session.hasMeetingUrl
            ? await myClasses.meetingUrl(actor, next.session.id)
            : null;
        return { next, join };
      }),
      messagingRead('messaging-home', async () => {
        const { service } = messagingRuntime();
        const [unread, page] = await Promise.all([
          service.unreadTotal(actor),
          service.conversations(actor, { surface: 'my', cursor: null }),
        ]);
        const latest = page.conversations.slice(0, CONVERSATIONS);
        const names = await participantNames(
          latest.map((entry) => entry.counterpartAccountId),
        );
        return { unread, latest, names };
      }),
      membershipRead('membership-home', () => membershipRuntime().applicant.state(actor)),
      donationsRead('donations-home', () => donationsRuntime().owner.history(actor)),
      questionsPanel(accountId),
      personalRead('personal-home', () => personalPanels(accountId)),
    ]);

  // The most recently enrolled course that is open now — the list's own order.
  const course = learning.ok
    ? (learning.value.items.find((entry) => entry.available) ?? null)
    : null;

  const panels = personal.ok ? personal.value : null;
  const quran = panels === null ? null : panels.quran;
  const ayah: PersonalTarget | null =
    quran === null ? null : { kind: 'ayah', surah: quran.surah, ayah: quran.ayah };
  const lastWatched = panels === null ? null : panels.lastWatched;
  const watched: PersonalTarget | null =
    lastWatched === null ? null : { kind: 'video', id: lastWatched.videoId };
  const lastRead = panels === null ? null : panels.lastRead;
  const targets: PersonalTarget[] = [
    ...(panels === null ? [] : panels.saved.map((entry) => entry.target)),
    ...(lastRead === null ? [] : [lastRead.target]),
    ...(watched === null ? [] : [watched]),
    ...(ayah === null ? [] : [ayah]),
  ];
  const titles: ReadonlyMap<string, ResolvedTarget> =
    targets.length === 0 ? new Map() : await resolvePersonalTargets(targets, locale);

  const membershipState = membership.ok
    ? {
        types: new Map(
          [...membership.value.types, ...membership.value.available].map(
            (type) => [type.id, type] as const,
          ),
        ),
        active: membership.value.memberships.filter((entry) => entry.status === 'active'),
        open: membership.value.applications.filter((entry) =>
          isOpenApplication(entry.status),
        ),
      }
    : null;

  return {
    course,
    learningFailed: !learning.ok,
    nextClass: classes.ok ? classes.value : null,
    classesFailed: !classes.ok,
    messages: messages.ok ? messages.value : null,
    messagesFailed: !messages.ok,
    membership: membershipState,
    membershipFailed: !membership.ok,
    donations: donations.ok ? donations.value : null,
    donationsFailed: !donations.ok,
    questions: questions.ok ? questions.value : null,
    questionsFailed: !questions.ok,
    personal: panels,
    personalFailed: !personal.ok,
    ayah,
    watched,
    titles,
    title: (target: PersonalTarget) => titles.get(targetKey(target)),
  };
}

export type HomeData = Awaited<ReturnType<typeof readHome>>;
