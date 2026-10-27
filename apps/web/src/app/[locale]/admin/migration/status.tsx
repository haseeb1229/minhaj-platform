import {
  isPublishableKind,
  type DuplicateState,
  type ErrorResolution,
  type ItemOutcome,
  type LegacyMappingState,
  type LinkDisposition,
  type ManifestEntryState,
  type ManifestState,
  type MigrationContentKind,
  type PersonalDataState,
  type PromotionState,
  type ReconciliationState,
  type ReviewState,
  type RunState,
  type TargetStage,
  type TopicMappingState,
  type ValidationState,
} from '@minhaj/contracts/migration';

import { StateBadge, type AdminMigrationCopy } from './shared';

/**
 * Every Migration lifecycle state as a word with a tone — text first, so a
 * state survives monochrome, a screen reader and colour-vision deficiency
 * (SECURITY_BASELINE.md §16.1). The tone only says "look here" (`caution`),
 * "done" (`positive`) or neither.
 */

type Tone = 'neutral' | 'positive' | 'caution';

export function RunStateBadge({
  state,
  copy,
}: {
  readonly state: RunState;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    state === 'completed' ? 'positive' : state === 'cancelled' ? 'caution' : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`runState.${state}`)}</StateBadge>;
}

export function ReconciliationBadge({
  state,
  copy,
}: {
  readonly state: ReconciliationState;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    state === 'balanced' ? 'positive' : state === 'unbalanced' ? 'caution' : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`reconciliationState.${state}`)}</StateBadge>;
}

export function ItemOutcomeBadge({
  outcome,
  copy,
}: {
  readonly outcome: ItemOutcome;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    outcome === 'staged'
      ? 'positive'
      : outcome === 'rejected' || outcome === 'errored'
        ? 'caution'
        : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`itemOutcome.${outcome}`)}</StateBadge>;
}

export function ReviewBadge({
  state,
  copy,
}: {
  readonly state: ReviewState;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    state === 'approved' ? 'positive' : state === 'rejected' ? 'caution' : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`reviewState.${state}`)}</StateBadge>;
}

export function ValidationBadge({
  state,
  copy,
}: {
  readonly state: ValidationState;
  readonly copy: AdminMigrationCopy;
}) {
  return (
    <StateBadge tone={state === 'valid' ? 'positive' : 'caution'}>
      {copy.t(`validationState.${state}`)}
    </StateBadge>
  );
}

export function PersonalDataBadge({
  state,
  copy,
}: {
  readonly state: PersonalDataState;
  readonly copy: AdminMigrationCopy;
}) {
  return (
    <StateBadge tone={state === 'flagged' ? 'caution' : 'neutral'}>
      {copy.t(`personalData.${state}`)}
    </StateBadge>
  );
}

export function DuplicateStateBadge({
  state,
  copy,
}: {
  readonly state: DuplicateState;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    state === 'merged' ? 'positive' : state === 'open' ? 'caution' : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`duplicateState.${state}`)}</StateBadge>;
}

export function TopicMappingBadge({
  state,
  copy,
}: {
  readonly state: TopicMappingState;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    state === 'confirmed' ? 'positive' : state === 'unmapped' ? 'caution' : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`topicMappingState.${state}`)}</StateBadge>;
}

export function LegacyMappingBadge({
  state,
  copy,
}: {
  readonly state: LegacyMappingState;
  readonly copy: AdminMigrationCopy;
}) {
  return (
    <StateBadge tone={state === 'active' ? 'positive' : 'neutral'}>
      {copy.t(`legacyMappingState.${state}`)}
    </StateBadge>
  );
}

export function ErrorResolutionBadge({
  state,
  copy,
}: {
  readonly state: ErrorResolution;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    state === 'resolved' ? 'positive' : state === 'open' ? 'caution' : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`errorResolution.${state}`)}</StateBadge>;
}

export function ManifestStateBadge({
  state,
  copy,
}: {
  readonly state: ManifestState;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    state === 'published'
      ? 'positive'
      : state === 'publishing' || state === 'rolling-back'
        ? 'caution'
        : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`manifestState.${state}`)}</StateBadge>;
}

export function EntryStateBadge({
  state,
  copy,
}: {
  readonly state: ManifestEntryState;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    state === 'published'
      ? 'positive'
      : state === 'refused' || state === 'rollback-refused' || state === 'publishing'
        ? 'caution'
        : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`entryState.${state}`)}</StateBadge>;
}

export function PromotionStateBadge({
  state,
  copy,
}: {
  readonly state: PromotionState;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    state === 'approved' || state === 'promoted'
      ? 'positive'
      : state === 'promoting'
        ? 'caution'
        : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`promotionState.${state}`)}</StateBadge>;
}

export function LinkDispositionBadge({
  disposition,
  copy,
}: {
  readonly disposition: LinkDisposition;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone =
    disposition === 'rewritten'
      ? 'positive'
      : disposition === 'unresolved'
        ? 'caution'
        : 'neutral';
  return <StateBadge tone={tone}>{copy.t(`linkDisposition.${disposition}`)}</StateBadge>;
}

/**
 * A content kind, in words, with a visible "Review only" mark for religious
 * material migration preserves and reviews as evidence and never publishes.
 */
export function ContentKindLabel({
  kind,
  copy,
}: {
  readonly kind: MigrationContentKind;
  readonly copy: AdminMigrationCopy;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{copy.t(`contentKind.${kind}`)}</span>
      {isPublishableKind(kind) ? null : (
        <StateBadge tone="caution">{copy.t('reviewOnly.badge')}</StateBadge>
      )}
    </span>
  );
}

/** How far into its owning domain a publication carried a record. */
export function TargetStageBadge({
  stage,
  copy,
}: {
  readonly stage: TargetStage;
  readonly copy: AdminMigrationCopy;
}) {
  const tone: Tone = stage === 'public' ? 'positive' : 'caution';
  return <StateBadge tone={tone}>{copy.t(`targetStage.${stage}`)}</StateBadge>;
}
