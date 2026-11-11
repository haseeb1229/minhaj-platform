import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { formatDuration } from '@minhaj/contracts/media';
import {
  QURAN_PASSAGES_MAX,
  SURAH_AYAH_COUNTS,
  SURAH_TOTAL,
  type QuranPassage,
  type TimedQuranPassage,
} from '@minhaj/contracts/passage';

import { readSurahs } from '@/components/quran/read';
import { surahName } from '@/components/quran/presentation';
import {
  EmptyState,
  Field,
  Panel,
  SectionHeading,
  Select,
  TextInput,
} from '@/components/ui';
import { ActionForm, type FormActionState } from '../(identity)/form-state';

/**
 * THE QURAN PASSAGES FIELD SET (Quran Part 8) — shared by the Library Work
 * editor and the Media Video editor, each of which owns its passages
 * (DOMAIN_MODEL.md §10.1, §11) and supplies its own server action.
 *
 * THE PLAYLIST PATTERN. The current passages are listed in their order, each
 * with named one-step changes — move earlier, move later, remove — and one
 * small form adds a passage. Every form carries the owner's EXPECTED VERSION,
 * so a stale click is a visible conflict, never a change to something the
 * operator has not seen; the action re-checks the owner's administer
 * permission, live. Everything works without JavaScript.
 *
 * NAMES ARE LAYER 4'S. A passage is stored as a citation value; the Surah's
 * display name shown beside it comes from Quran's PUBLIC reader here, at the
 * composition layer — Library and Media never learn it. With no public corpus
 * (a fresh environment) the Surahs are offered by number.
 */

/** The longest Surah's last Ayah: the number fields' ceiling (the schema decides). */
const AYAH_NUMBER_MAX = Math.max(...SURAH_AYAH_COUNTS);

type PassageAction = (state: FormActionState, form: FormData) => Promise<FormActionState>;

interface OwnerFields {
  /** The hidden field naming the owner, e.g. `workId`. */
  readonly name: string;
  readonly id: string;
  readonly version: number;
}

/** "Al-Kahf" — or "Surah 18" with no public corpus. */
async function surahLabels(locale: Locale): Promise<ReadonlyMap<number, string>> {
  const t = await getTranslations({ locale, namespace: 'quranPassages' });
  const surahs = await readSurahs().catch(() => []);
  const named = new Map(
    surahs.map(
      (surah) => [surah.number, surahName(surah, locale)?.text ?? null] as const,
    ),
  );
  return new Map(
    Array.from({ length: SURAH_TOTAL }, (_, index) => {
      const number = index + 1;
      const name = named.get(number) ?? null;
      return [
        number,
        name === null ? t('surahNumber', { number }) : t('surahNamed', { number, name }),
      ] as const;
    }),
  );
}

function ChangeForm({
  action,
  locale,
  owner,
  position,
  op,
  direction,
  label,
  messages,
  pending,
  tone = 'secondary',
}: {
  readonly action: PassageAction;
  readonly locale: Locale;
  readonly owner: OwnerFields;
  readonly position: number;
  readonly op: 'remove' | 'move';
  readonly direction?: 'earlier' | 'later';
  readonly label: string;
  readonly messages: Readonly<Record<string, string>>;
  readonly pending: string;
  readonly tone?: 'secondary' | 'destructive';
}) {
  return (
    <ActionForm
      action={action}
      submitLabel={label}
      pendingLabel={pending}
      messages={messages}
      tone={tone}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name={owner.name} value={owner.id} />
      <input type="hidden" name="version" value={String(owner.version)} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="position" value={String(position)} />
      {direction === undefined ? null : (
        <input type="hidden" name="direction" value={direction} />
      )}
    </ActionForm>
  );
}

export async function QuranPassagesEditor({
  locale,
  action,
  owner,
  passages,
  timed,
  messages,
  canEdit,
}: {
  readonly locale: Locale;
  readonly action: PassageAction;
  readonly owner: OwnerFields;
  readonly passages: readonly (QuranPassage | TimedQuranPassage)[];
  /** A Video's passages carry where the lecture begins each. */
  readonly timed: boolean;
  readonly messages: Readonly<Record<string, string>>;
  /** Only an administrator is offered a change; a reader sees the list. */
  readonly canEdit: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'quranPassages' });
  const names = await surahLabels(locale);
  const pending = t('pending');
  const headingId = `quran-passages-${owner.id}`;
  const full = passages.length >= QURAN_PASSAGES_MAX;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <SectionHeading>
        <span id={headingId}>{t('heading')}</span>
      </SectionHeading>
      <p className="text-sm text-foreground-muted">
        {t(timed ? 'helpVideo' : 'helpWork')}
      </p>

      {passages.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ol aria-labelledby={headingId} className="flex flex-col gap-3">
          {passages.map((passage, index) => {
            const start = 'startSeconds' in passage ? passage.startSeconds : null;
            return (
              <Panel
                key={`${String(passage.surah)}:${String(passage.ayahFrom)}-${String(passage.ayahTo)}`}
                as="li"
              >
                <div className="flex flex-col gap-3">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm text-foreground-muted">
                      {t('position', { number: index + 1 })}
                    </span>
                    <span className="font-semibold" dir="auto">
                      {names.get(passage.surah)}
                    </span>
                    <bdi dir="ltr" className="tabular-nums">
                      {passage.ayahFrom === passage.ayahTo
                        ? `${String(passage.surah)}:${String(passage.ayahFrom)}`
                        : `${String(passage.surah)}:${String(passage.ayahFrom)}–${String(passage.ayahTo)}`}
                    </bdi>
                    {start === null ? null : (
                      <span className="text-sm text-foreground-muted">
                        {t('startsAt', { time: formatDuration(start) })}
                      </span>
                    )}
                  </p>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-3">
                      {index === 0 ? null : (
                        <ChangeForm
                          action={action}
                          locale={locale}
                          owner={owner}
                          position={index}
                          op="move"
                          direction="earlier"
                          label={t('moveEarlier')}
                          messages={messages}
                          pending={pending}
                        />
                      )}
                      {index === passages.length - 1 ? null : (
                        <ChangeForm
                          action={action}
                          locale={locale}
                          owner={owner}
                          position={index}
                          op="move"
                          direction="later"
                          label={t('moveLater')}
                          messages={messages}
                          pending={pending}
                        />
                      )}
                      <ChangeForm
                        action={action}
                        locale={locale}
                        owner={owner}
                        position={index}
                        op="remove"
                        label={t('remove')}
                        messages={messages}
                        pending={pending}
                        tone="destructive"
                      />
                    </div>
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </ol>
      )}

      {!canEdit ? null : full ? (
        <EmptyState>{t('full', { max: QURAN_PASSAGES_MAX })}</EmptyState>
      ) : (
        <Panel>
          <div className="flex flex-col gap-4">
            <h3 className="font-semibold">{t('add')}</h3>
            <ActionForm
              action={action}
              submitLabel={t('addSubmit')}
              pendingLabel={pending}
              messages={messages}
              preserveInput
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name={owner.name} value={owner.id} />
              <input type="hidden" name="version" value={String(owner.version)} />
              <input type="hidden" name="op" value="add" />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id={`${headingId}-surah`} label={t('surah')}>
                  {(props) => (
                    <Select {...props} name="surah" required defaultValue="">
                      <option value="">{t('chooseSurah')}</option>
                      {SURAH_AYAH_COUNTS.map((count, index) => (
                        <option key={index + 1} value={String(index + 1)}>
                          {t('surahOption', { name: names.get(index + 1) ?? '', count })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id={`${headingId}-from`} label={t('from')} help={t('fromHelp')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      name="ayahFrom"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={AYAH_NUMBER_MAX}
                      dir="ltr"
                    />
                  )}
                </Field>
                <Field id={`${headingId}-to`} label={t('to')} help={t('toHelp')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      name="ayahTo"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={AYAH_NUMBER_MAX}
                      dir="ltr"
                    />
                  )}
                </Field>
              </div>
              {timed ? (
                <Field id={`${headingId}-start`} label={t('start')} help={t('startHelp')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      name="start"
                      inputMode="numeric"
                      maxLength={8}
                      pattern="[0-9:]*"
                      dir="ltr"
                    />
                  )}
                </Field>
              ) : null}
            </ActionForm>
          </div>
        </Panel>
      )}
    </section>
  );
}
