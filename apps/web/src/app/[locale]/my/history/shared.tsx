import type { Locale } from '@minhaj/contracts';

import {
  ConfirmField,
  refusalMessages,
  type PersonalTranslator,
} from '@/components/personal/parts';
import { Alert, Panel, SectionHeading, TextLink } from '@/components/ui';
import { ActionForm } from '../../(identity)/form-state';
import { clearHistoryAction } from './actions';

/**
 * The parts both history pages and the privacy page share.
 *
 * HISTORY IS OFF UNTIL THE PERSON TURNS IT ON. While it is off, the page says
 * so plainly — nothing is being recorded — and points to the one switch that
 * changes it. Anything recorded while it was on is still listed, and can be
 * removed, until the person clears it.
 */

/** The plain statement that history is off, with the way to turn it on. */
export function HistoryOffNotice({
  locale,
  t,
}: {
  readonly locale: Locale;
  readonly t: PersonalTranslator;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Alert tone="info">{t('history.off')}</Alert>
      <p className="text-sm">
        <TextLink href={`/${locale}/my/settings/privacy`}>
          {t('history.offLink')}
        </TextLink>
      </p>
    </div>
  );
}

/** Clear all reading and watch history, behind an explicit confirmation. */
export function ClearHistory({
  locale,
  t,
}: {
  readonly locale: Locale;
  readonly t: PersonalTranslator;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="history-clear">
      <span id="history-clear">
        <SectionHeading>{t('history.clear')}</SectionHeading>
      </span>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('history.clearHelp')}
      </p>
      <Panel>
        <ActionForm
          action={clearHistoryAction}
          submitLabel={t('history.clearSubmit')}
          pendingLabel={t('common.working')}
          tone="destructive"
          messages={{ ...refusalMessages(t), success: t('history.cleared') }}
        >
          <input type="hidden" name="locale" value={locale} />
          <ConfirmField id="history-clear-confirm" label={t('history.clearConfirm')} />
        </ActionForm>
      </Panel>
    </section>
  );
}
