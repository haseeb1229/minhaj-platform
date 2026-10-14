import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { PERSONAL_LIMITS, type PersonalTarget } from '@minhaj/contracts/personalisation';

import { Container } from '@/components/ui';
import { PersonalIsland, type PersonalIslandLabels } from './personal-island';

/**
 * Places the private island on a public content page.
 *
 * SESSION-FREE BY CONSTRUCTION. Everything it hands the island is the same for
 * every visitor: the interface locale, the target the page is about — a public
 * identifier the page already shows — and labels from the public message
 * catalogue. Nothing here can reach a session, so the page's shared render
 * stays what it was (ARCHITECTURE.md §8.1).
 *
 * `framed` gives the island its own column and spacing when the page's body is
 * a component it cannot reach into; otherwise it sits inside the page's flow.
 */
export async function PersonalControls({
  locale,
  target,
  framed = false,
}: {
  readonly locale: Locale;
  readonly target: PersonalTarget;
  readonly framed?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'personalIsland' });

  const labels: PersonalIslandLabels = {
    heading: t('heading'),
    privacy: t('privacy'),
    signedOutPrompt: t('signedOutPrompt'),
    signIn: t('signIn'),
    save: t('save'),
    savedStatus: t('savedStatus'),
    unsavedStatus: t('unsavedStatus'),
    noteAdd: t('noteAdd'),
    noteEdit: t('noteEdit'),
    noteLabel: t('noteLabel'),
    noteHelp: t('noteHelp'),
    noteSave: t('noteSave'),
    noteDelete: t('noteDelete'),
    noteSaved: t('noteSaved'),
    noteDeleted: t('noteDeleted'),
    noteConflict: t('noteConflict'),
    collections: t('collections'),
    collectionsLegend: t('collectionsLegend'),
    collectionsEmpty: t('collectionsEmpty'),
    collectionsManage: t('collectionsManage'),
    collectionAdded: t('collectionAdded'),
    collectionRemoved: t('collectionRemoved'),
    collectionConflict: t('collectionConflict'),
    positionSet: t('positionSet'),
    positionCurrent: t('positionCurrent'),
    positionSaved: t('positionSaved'),
    positionConflict: t('positionConflict'),
    working: t('working'),
    sessionEnded: t('sessionEnded'),
    failures: {
      invalid: t('failureInvalid'),
      'too-large': t('failureInvalid'),
      unsupported: t('failureInvalid'),
      'not-found': t('failureNotFound'),
      conflict: t('failureConflict'),
      'invalid-state': t('failureConflict'),
      limit: t('failureLimit'),
      'rate-limited': t('failureRateLimited'),
      denied: t('failureDenied'),
      unavailable: t('failureUnavailable'),
    },
  };

  const island = (
    <PersonalIsland
      locale={locale}
      target={target}
      noteMax={PERSONAL_LIMITS.noteMax}
      labels={labels}
    />
  );

  return framed ? (
    <Container>
      <div className="pb-12">{island}</div>
    </Container>
  ) : (
    island
  );
}
