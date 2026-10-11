'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { Alert, Button, Field, TextArea, TextInput } from '@/components/ui';
import { correctAyah, type CorrectionState } from './actions';

/**
 * The protected canonical correction form — the ONE control on this surface
 * that can change an Ayah's Arabic (SECURITY_BASELINE.md §5.1).
 *
 * A PLAIN TEXTAREA, deliberately. No WYSIWYG, no rich-text editor, no input
 * masking and no client-side trimming or normalisation: the operator enters the
 * exact text they reviewed, and the server compares it with the registered
 * source code point for code point (§5.3). Its input is kept after a refusal so
 * the operator can see what they submitted beside the verification report.
 *
 * THE REPORT IS CONTENT-FREE. A refusal names references, categories and the
 * first differing code-point position — never either text, so nothing beyond
 * the two texts the page already shows is echoed back.
 *
 * NOT THE CONTROL. The action re-checks `quran.editCanonical`, the privileged
 * posture and a step-up grant for `quran-canonical-edit`; the canonical service
 * re-verifies through Identity; the database procedure checks again.
 */

const IDLE: CorrectionState = { status: 'idle' };

const REASON_KEYS = {
  'malformed-encoding': 'malformedEncoding',
  'unsupported-encoding': 'unsupportedEncoding',
  'unknown-reference': 'unknownReference',
  'duplicate-reference': 'duplicateReference',
  'missing-reference': 'missingReference',
  'juz-mismatch': 'juzMismatch',
  'text-mismatch': 'textMismatch',
} as const;

export function CorrectionForm({
  locale,
  surah,
  ayah,
  version,
  sourceId,
  identical,
  messages,
}: {
  readonly locale: string;
  readonly surah: number;
  readonly ayah: number;
  readonly version: number;
  readonly sourceId: string;
  /** The current text already equals the source's: nothing to correct. */
  readonly identical: boolean;
  /** A message per failure word, with `success` and `unknown`. */
  readonly messages: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('quranAdmin.correction');
  const [state, submit, pending] = useActionState(correctAyah, IDLE);

  const message =
    state.status === 'success'
      ? t('corrected')
      : state.status === 'error'
        ? (messages[state.failure ?? 'unknown'] ?? messages['unknown'])
        : undefined;

  return (
    <div className="flex flex-col gap-4">
      {message === undefined ? null : (
        <Alert tone={state.status === 'success' ? 'success' : 'error'}>{message}</Alert>
      )}

      {state.report === undefined ? null : (
        <section
          aria-labelledby="correction-report"
          className="flex flex-col gap-2 text-sm"
        >
          <h3 id="correction-report" className="font-semibold">
            {t('reportTitle')}
          </h3>
          <p>
            {t('reportSummary', {
              checked: state.report.checked,
              mismatches: state.report.mismatchCount,
            })}
          </p>
          <ul className="flex list-disc flex-col gap-1 ps-6">
            {state.report.mismatches.map((mismatch, index) => {
              const key = REASON_KEYS[mismatch.reason as keyof typeof REASON_KEYS];
              return (
                <li key={index}>
                  {key === undefined ? t('reason.other') : t(`reason.${key}`)}
                  {mismatch.surah === null || mismatch.ayah === null ? null : (
                    <>
                      {' — '}
                      <span dir="ltr">
                        {t('reference', { surah: mismatch.surah, ayah: mismatch.ayah })}
                      </span>
                    </>
                  )}
                  {mismatch.offset === null ? null : (
                    <>
                      {' — '}
                      {t('offset', { offset: mismatch.offset })}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {state.report.mismatchCount > state.report.mismatches.length ? (
            <p>{t('reportTruncated')}</p>
          ) : null}
        </section>
      )}

      {identical ? (
        <Alert tone="info">{t('identical')}</Alert>
      ) : (
        <form
          action={submit}
          className="flex flex-col gap-4"
          noValidate
          // Keep what was entered when the action returns, so a refusal is
          // read beside the text that caused it.
          onReset={(event) => event.preventDefault()}
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="surah" value={String(surah)} />
          <input type="hidden" name="ayah" value={String(ayah)} />
          <input type="hidden" name="version" value={String(version)} />
          <input type="hidden" name="sourceId" value={sourceId} />

          <Field
            id="correction-text"
            label={t('reviewedText')}
            help={t('reviewedTextHelp')}
          >
            {(props) => (
              <TextArea
                {...props}
                name="reviewedText"
                required
                rows={6}
                lang="ar"
                dir="rtl"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            )}
          </Field>

          <Field id="correction-reason" label={t('reason.label')} help={t('reasonHelp')}>
            {(props) => (
              <TextInput {...props} name="reason" required maxLength={500} dir="auto" />
            )}
          </Field>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" required className="mt-1" />
            <span>{t('confirm')}</span>
          </label>

          <Button tone="destructive" disabled={pending} aria-busy={pending}>
            {pending ? t('pending') : t('submit')}
          </Button>
        </form>
      )}
    </div>
  );
}
