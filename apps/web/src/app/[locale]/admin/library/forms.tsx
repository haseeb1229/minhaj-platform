import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { CONTRIBUTION_ROLES, type ContributionRole } from '@minhaj/contracts/people';
import {
  formatReaderDocument,
  libraryStateSchema,
  type EditionRecord,
  type SalePointRecord,
  type WorkDetail,
  type WorkRecord,
} from '@minhaj/contracts/library';

import {
  Field,
  Panel,
  SectionHeading,
  Select,
  TextArea,
  TextInput,
} from '@/components/ui';
import { ActionForm } from '../../(identity)/form-state';
import {
  attachEditionAsset,
  saveEdition,
  saveSalePoint,
  saveTranslation,
  saveWork,
} from './actions';

/**
 * The Library administration FORMS.
 *
 * SERVER COMPONENTS WRAPPING ONE CLIENT ISLAND. Every control below is markup
 * rendered on the server; `ActionForm` is the single Client Component, and it exists
 * for the two things a form genuinely needs on the client — a pending state and a
 * result to announce. Nothing else on these screens ships JavaScript
 * (ARCHITECTURE.md §7, §13.8).
 *
 * THEY WORK WITH JAVASCRIPT DISABLED. `<form action={serverAction}>` submits either
 * way; `useActionState` adds the pending and result states on top rather than being
 * the mechanism.
 *
 * ONE DESIGN SYSTEM. `Field`, `TextInput`, `Select`, `TextArea` and `Panel` are the
 * shared primitives the public surfaces use. There is no admin-only Button, no
 * admin-only Input and no second token system — "one shared design system only",
 * and a later visual redesign must not require touching the domain (§D, §C).
 *
 * THE EXPECTED VERSION TRAVELS AS A HIDDEN FIELD, and it is what makes a stale save
 * a CONFLICT rather than a silent overwrite (§40). It is compared by the persistence
 * layer against the row's current version inside the writing transaction; a caller
 * who edits the hidden value simply conflicts against a version that is not there.
 *
 * ACCESSIBILITY IS IN THE PRIMITIVES. Every control has a real `<label for>`, help
 * and error text associated through `aria-describedby`, and a heading structure that
 * makes the form navigable by landmark and heading rather than by tabbing blindly.
 */

interface LibraryReferenceChoices {
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly topics: readonly { readonly id: string; readonly name: string }[];
  readonly languages: readonly { readonly code: string; readonly name: string }[];
}

/**
 * How many repeated rows a form offers.
 *
 * Matches the ceiling the actions read, so a row the operator can fill is a row the
 * action looks at, and a row it does not offer is one nothing reads. The domain
 * schemas cap the resulting arrays independently and more generously — the form is
 * the narrower bound, deliberately, because twenty-four selects of contributors is a
 * screen nobody can use.
 */
const FORM_ROWS = 12;

const ROW_INDEXES = Array.from({ length: FORM_ROWS }, (_, index) => index);

type LibraryCopy = Awaited<ReturnType<typeof libraryCopy>>;

/**
 * Every string these forms need, resolved once per page.
 *
 * ONE PLACE, because each form answers the SAME set of refusals. Repeating the table
 * per form would mean a new failure class gets a message on some screens and
 * "unavailable" on others — and the screen that gets "unavailable" is always the one
 * nobody tested.
 */
export async function libraryCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'library' });

  return {
    t,
    /** A message for every failure the Library service can return. */
    messages: {
      success: t('saved'),
      denied: t('denied'),
      invalid: t('invalid'),
      conflict: t('conflict'),
      'not-found': t('notFound'),
      'duplicate-slug': t('duplicateSlug'),
      limit: t('limitReached'),
      'not-cleared': t('notCleared'),
      'rate-limited': t('rateLimited'),
      unavailable: t('unknown'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

/* ===========================================================================
 * Work
 * ========================================================================= */

export function WorkForm({
  locale,
  record,
  choices,
  copy,
}: {
  readonly locale: Locale;
  /** `null` creates. An existing record edits, and carries its expected version. */
  readonly record: WorkDetail | null;
  readonly choices: LibraryReferenceChoices;
  readonly copy: LibraryCopy;
}) {
  const { t } = copy;

  return (
    <ActionForm
      action={saveWork}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <input type="hidden" name="locale" value={locale} />
      {record === null ? null : (
        <>
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="version" value={String(record.version)} />
        </>
      )}

      <Field id="work-slug" label={t('slug')} help={t('slugHelp')}>
        {(props) => (
          <TextInput
            {...props}
            name="slug"
            required
            defaultValue={record?.slug ?? ''}
            // The pattern MIRRORS the domain schema rather than replacing it: it
            // catches a typo before a round trip, and the authoritative refusal is
            // still server-side (SECURITY_BASELINE.md §9.1).
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={120}
          />
        )}
      </Field>

      <Field id="work-primary" label={t('primaryLocale')} help={t('primaryLocaleHelp')}>
        {(props) => (
          <Select
            {...props}
            name="primaryLocale"
            defaultValue={record?.primaryLocale ?? locale}
          >
            {localeSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <StateField
        id="work-state"
        name="state"
        label={t('state')}
        copy={copy}
        value={record?.state}
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="featured"
          defaultChecked={record?.isFeatured ?? false}
          className="size-5"
        />
        {t('featured')}
      </label>

      <SectionHeading>{t('labels')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('labelsHelp')}
      </p>

      {localeSchema.options.map((language) => {
        const existing = record?.labels.find((entry) => entry.locale === language);
        return (
          <Panel key={language}>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name={`${language}-enabled`}
                  defaultChecked={
                    existing !== undefined ||
                    language === (record?.primaryLocale ?? locale)
                  }
                  className="size-5"
                />
                {language}
              </label>

              <Field id={`work-title-${language}`} label={t('labelTitle')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name={`${language}-title`}
                    defaultValue={existing?.title ?? ''}
                    maxLength={240}
                    // The value is content in this language, so the control is
                    // marked with it — an Urdu title typed into an unmarked field
                    // is announced in the interface's language instead.
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>

              <Field id={`work-description-${language}`} label={t('labelDescription')}>
                {(props) => (
                  <TextArea
                    {...props}
                    name={`${language}-description`}
                    defaultValue={existing?.description ?? ''}
                    maxLength={4000}
                    rows={3}
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>
            </div>
          </Panel>
        );
      })}

      <SectionHeading>{t('contributors')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('contributorsHelp')}
      </p>

      {ROW_INDEXES.map((index) => {
        const existing = record?.contributors[index];
        return (
          <div key={index} className="grid gap-3 sm:grid-cols-2">
            <Field id={`work-person-${String(index)}`} label={t('person')}>
              {(props) => (
                <Select
                  {...props}
                  name={`person-${String(index)}`}
                  defaultValue={existing?.personId ?? ''}
                >
                  <option value="">{t('none')}</option>
                  {personOptions(choices.people, existing?.personId).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id={`work-role-${String(index)}`} label={t('contributorRole')}>
              {(props) => (
                <Select
                  {...props}
                  name={`role-${String(index)}`}
                  defaultValue={existing?.role ?? ''}
                >
                  <option value="">{t('none')}</option>
                  {CONTRIBUTION_ROLES.map((role: ContributionRole) => (
                    <option key={role} value={role}>
                      {t(`role.${role}` as 'role.author')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        );
      })}

      <SectionHeading>{t('topics')}</SectionHeading>
      {ROW_INDEXES.map((index) => (
        <Field key={index} id={`work-topic-${String(index)}`} label={t('topic')}>
          {(props) => (
            <Select
              {...props}
              name={`topic-${String(index)}`}
              defaultValue={record?.topicIds[index] ?? ''}
            >
              <option value="">{t('none')}</option>
              {choices.topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ))}

      <SectionHeading>{t('salePoints')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('workSalePointsHelp')}
      </p>
      {ROW_INDEXES.map((index) => (
        <Field key={index} id={`work-sale-${String(index)}`} label={t('salePoint')}>
          {(props) => (
            <TextInput
              {...props}
              name={`sale-${String(index)}`}
              defaultValue={record?.salePointIds[index] ?? ''}
              maxLength={36}
            />
          )}
        </Field>
      ))}
    </ActionForm>
  );
}

/**
 * The people offered in a contributor select.
 *
 * THE CURRENTLY SELECTED PERSON IS ALWAYS PRESENT, even when the bounded directory
 * page does not contain them. Without this, opening a Work whose author is not on
 * the first page of contributors and pressing save would silently DROP that author
 * — the select would have no matching option and would submit the empty value. The
 * identifier is preserved even where the name cannot be resolved here, because
 * losing attribution is worse than showing an identifier on an operator's screen.
 */
function personOptions(
  people: LibraryReferenceChoices['people'],
  selected: string | undefined,
): readonly { id: string; name: string }[] {
  if (selected === undefined || people.some((person) => person.id === selected)) {
    return people;
  }
  return [{ id: selected, name: selected }, ...people];
}

/* ===========================================================================
 * Edition
 * ========================================================================= */

export function EditionForm({
  locale,
  record,
  works,
  choices,
  copy,
}: {
  readonly locale: Locale;
  readonly record: EditionRecord | null;
  readonly works: readonly WorkRecord[];
  readonly choices: LibraryReferenceChoices;
  readonly copy: LibraryCopy;
}) {
  const { t } = copy;

  return (
    <ActionForm
      action={saveEdition}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <input type="hidden" name="locale" value={locale} />
      {record === null ? null : (
        <>
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="version" value={String(record.version)} />
        </>
      )}

      <Field id="edition-work" label={t('work')} help={t('workHelp')}>
        {(props) => (
          <Select {...props} name="workId" required defaultValue={record?.workId ?? ''}>
            <option value="">{t('none')}</option>
            {works.map((work) => (
              <option key={work.id} value={work.id}>
                {work.slug}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="edition-label" label={t('editionLabel')} help={t('editionLabelHelp')}>
        {(props) => (
          <TextInput
            {...props}
            name="label"
            required
            maxLength={160}
            defaultValue={record?.label ?? ''}
            dir="auto"
          />
        )}
      </Field>

      <Field
        id="edition-language"
        label={t('contentLanguage')}
        help={t('contentLanguageHelp')}
      >
        {(props) => (
          <Select
            {...props}
            name="languageCode"
            required
            defaultValue={record?.languageCode ?? ''}
          >
            <option value="">{t('none')}</option>
            {choices.languages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <StateField
        id="edition-state"
        name="state"
        label={t('state')}
        copy={copy}
        value={record?.state}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="edition-publisher" label={t('fact.publisher')}>
          {(props) => (
            <TextInput
              {...props}
              name="publisher"
              maxLength={240}
              defaultValue={record?.publisher ?? ''}
              dir="auto"
            />
          )}
        </Field>
        <Field id="edition-year" label={t('fact.publicationYear')}>
          {(props) => (
            <TextInput
              {...props}
              name="publicationYear"
              type="number"
              min={1}
              max={9999}
              inputMode="numeric"
              defaultValue={record?.publicationYear ?? ''}
            />
          )}
        </Field>
        {/*
         * OPTIONAL, AND NEVER INVENTED. An ISBN is validated and normalised only
         * when one is present — a book without an ISBN is the ordinary case, and a
         * fabricated one would end up in machine-readable `Book` structured data
         * where something else would believe it (§39, §34).
         */}
        <Field id="edition-isbn" label={t('fact.isbn')} help={t('isbnHelp')}>
          {(props) => (
            <TextInput
              {...props}
              name="isbn"
              maxLength={20}
              defaultValue={record?.isbn ?? ''}
            />
          )}
        </Field>
        <Field id="edition-pages" label={t('fact.pageCount')}>
          {(props) => (
            <TextInput
              {...props}
              name="pageCount"
              type="number"
              min={1}
              inputMode="numeric"
              defaultValue={record?.pageCount ?? ''}
            />
          )}
        </Field>
      </div>

      <SectionHeading>{t('availability')}</SectionHeading>
      {/*
       * TWO INDEPENDENT DECISIONS, presented as two controls, because they are not
       * derivable from each other: readable online does not imply downloadable, and
       * a file existing implies neither (§26, §27). The help text says what each one
       * means and says nothing about WHY — a legal reason is not something this
       * platform is entitled to state on the organisation's behalf.
       */}
      <Field id="edition-reading" label={t('readingState')} help={t('readingStateHelp')}>
        {(props) => (
          <Select
            {...props}
            name="reading"
            defaultValue={record?.reading ?? 'unavailable'}
          >
            <option value="allowed">{t('readingAllowed')}</option>
            <option value="unavailable">{t('readingUnavailable')}</option>
          </Select>
        )}
      </Field>

      <Field
        id="edition-download"
        label={t('downloadState')}
        help={t('downloadStateHelp')}
      >
        {(props) => (
          <Select {...props} name="download" defaultValue={record?.download ?? 'denied'}>
            <option value="allowed">{t('downloadAllowed')}</option>
            <option value="denied">{t('downloadDenied')}</option>
          </Select>
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="edition-readable-asset"
          label={t('readableAsset')}
          help={t('assetHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="readableAssetId"
              maxLength={36}
              defaultValue={record?.readableAssetId ?? ''}
            />
          )}
        </Field>
        <Field
          id="edition-download-asset"
          label={t('downloadAsset')}
          help={t('assetHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="downloadAssetId"
              maxLength={36}
              defaultValue={record?.downloadAssetId ?? ''}
            />
          )}
        </Field>
      </div>

      <Field id="edition-document" label={t('document')} help={t('documentHelp')}>
        {(props) => (
          <TextArea
            {...props}
            name="document"
            rows={16}
            defaultValue={
              record?.document === null || record === null
                ? ''
                : formatReaderDocument(record.document)
            }
            dir="auto"
          />
        )}
      </Field>
    </ActionForm>
  );
}

/**
 * Uploading a file and attaching it to an Edition, as its OWN form.
 *
 * SEPARATE FROM THE EDITION FORM ON PURPOSE. The two do different things to
 * different systems: saving an Edition is one SQL transaction, while attaching a
 * file writes bytes through Storage and then writes a relation in SQL — two commits
 * that are NOT one transaction (§29). Putting them in one submit button would have
 * presented them as atomic, which they are not.
 *
 * IT CARRIES THE EDITION'S OTHER FIELDS AS HIDDEN VALUES, because the attach action
 * saves the whole Edition with the new asset identifier substituted in. That keeps
 * one write path for an Edition rather than a second one that updates a single
 * column — and it means the expected version is enforced here too, so two operators
 * attaching different files do not both win.
 */
export function EditionAssetForm({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: EditionRecord;
  readonly copy: LibraryCopy;
}) {
  const { t } = copy;

  return (
    <ActionForm
      action={attachEditionAsset}
      submitLabel={t('upload')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      tone="secondary"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={record.id} />
      <input type="hidden" name="version" value={String(record.version)} />
      <input type="hidden" name="workId" value={record.workId} />
      <input type="hidden" name="label" value={record.label} />
      <input type="hidden" name="languageCode" value={record.languageCode} />
      <input type="hidden" name="state" value={record.state} />
      <input type="hidden" name="publisher" value={record.publisher ?? ''} />
      <input
        type="hidden"
        name="publicationYear"
        value={record.publicationYear === null ? '' : String(record.publicationYear)}
      />
      <input type="hidden" name="isbn" value={record.isbn ?? ''} />
      <input
        type="hidden"
        name="pageCount"
        value={record.pageCount === null ? '' : String(record.pageCount)}
      />
      <input type="hidden" name="reading" value={record.reading} />
      <input type="hidden" name="download" value={record.download} />
      <input type="hidden" name="readableAssetId" value={record.readableAssetId ?? ''} />
      <input type="hidden" name="downloadAssetId" value={record.downloadAssetId ?? ''} />
      <input
        type="hidden"
        name="document"
        value={record.document === null ? '' : formatReaderDocument(record.document)}
      />

      <Field id="asset-slot" label={t('assetSlot')} help={t('assetSlotHelp')}>
        {(props) => (
          <Select {...props} name="slot" defaultValue="readableAssetId">
            <option value="readableAssetId">{t('readableAsset')}</option>
            <option value="downloadAssetId">{t('downloadAsset')}</option>
          </Select>
        )}
      </Field>

      <Field id="asset-file" label={t('uploadFile')} help={t('uploadFileHelp')}>
        {(props) => (
          <input
            {...props}
            type="file"
            name="file"
            accept="application/pdf"
            required
            className="w-full text-sm"
          />
        )}
      </Field>
    </ActionForm>
  );
}

/* ===========================================================================
 * Translation
 * ========================================================================= */

/**
 * Recording that an Edition IS a translation of its Work.
 *
 * THIS IS THE DISTINCTION THE WHOLE PHASE TURNS ON. A `BookTranslation` is not a
 * localized label and not an `isTranslated` flag: it is a statement that this
 * Edition is a genuine translated manifestation, with its own translators and,
 * where it is known, its own source Edition (DOMAIN_MODEL.md §10.1, §13).
 *
 * THE SOURCE MUST BELONG TO THE SAME WORK, AND MUST BE IN A DIFFERENT LANGUAGE.
 * Both are enforced in the persistence layer, and the select below only offers
 * siblings — so the ordinary path cannot produce a translation of another Work, and
 * the abnormal path is refused rather than stored.
 *
 * "NOT RECORDED" IS AN OPTION, and it is the honest one. Where nobody knows which
 * printing a translation was made from, the source is left null and the public page
 * says it is not recorded — rather than the platform choosing a plausible edition
 * and presenting a guess as scholarship (§13).
 */
export function TranslationForm({
  locale,
  edition,
  siblings,
  choices,
  copy,
}: {
  readonly locale: Locale;
  readonly edition: EditionRecord;
  readonly siblings: readonly EditionRecord[];
  readonly choices: LibraryReferenceChoices;
  readonly copy: LibraryCopy;
}) {
  const { t } = copy;
  const existing = edition.translation;

  return (
    <ActionForm
      action={saveTranslation}
      submitLabel={t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="editionId" value={edition.id} />
      <input type="hidden" name="version" value={String(edition.version)} />
      <input type="hidden" name="action" value="save" />

      <Field
        id="translation-source"
        label={t('sourceEdition')}
        help={t('sourceEditionHelp')}
      >
        {(props) => (
          <Select
            {...props}
            name="sourceEditionId"
            defaultValue={existing?.sourceEditionId ?? ''}
          >
            <option value="">{t('sourceNotRecorded')}</option>
            {siblings
              .filter(
                (sibling) =>
                  sibling.id !== edition.id &&
                  sibling.languageCode !== edition.languageCode,
              )
              .map((sibling) => (
                <option key={sibling.id} value={sibling.id}>
                  {sibling.label}
                </option>
              ))}
          </Select>
        )}
      </Field>

      {ROW_INDEXES.slice(0, 6).map((index) => (
        <Field key={index} id={`translator-${String(index)}`} label={t('translator')}>
          {(props) => (
            <Select
              {...props}
              name={`translator-${String(index)}`}
              defaultValue={existing?.translatorIds[index] ?? ''}
            >
              <option value="">{t('none')}</option>
              {personOptions(choices.people, existing?.translatorIds[index]).map(
                (person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ),
              )}
            </Select>
          )}
        </Field>
      ))}
    </ActionForm>
  );
}

/** Removing the translation relation, as its own single-purpose form. */
export function RemoveTranslationForm({
  locale,
  edition,
  copy,
}: {
  readonly locale: Locale;
  readonly edition: EditionRecord;
  readonly copy: LibraryCopy;
}) {
  const { t } = copy;

  return (
    <ActionForm
      action={saveTranslation}
      submitLabel={t('removeTranslation')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      tone="destructive"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="editionId" value={edition.id} />
      <input type="hidden" name="version" value={String(edition.version)} />
      <input type="hidden" name="action" value="remove" />
    </ActionForm>
  );
}

/* ===========================================================================
 * Sale point
 * ========================================================================= */

export function SalePointForm({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: SalePointRecord | null;
  readonly copy: LibraryCopy;
}) {
  const { t } = copy;

  return (
    <ActionForm
      action={saveSalePoint}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <input type="hidden" name="locale" value={locale} />
      {record === null ? null : (
        <>
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="version" value={String(record.version)} />
        </>
      )}

      <Field id={`sale-name-${record?.id ?? 'new'}`} label={t('salePointName')}>
        {(props) => (
          <TextInput
            {...props}
            name="name"
            required
            maxLength={200}
            defaultValue={record?.name ?? ''}
            dir="auto"
          />
        )}
      </Field>

      <Field id={`sale-address-${record?.id ?? 'new'}`} label={t('salePointAddress')}>
        {(props) => (
          <TextArea
            {...props}
            name="address"
            rows={2}
            maxLength={1000}
            defaultValue={record?.address ?? ''}
            dir="auto"
          />
        )}
      </Field>

      <Field id={`sale-contact-${record?.id ?? 'new'}`} label={t('salePointContact')}>
        {(props) => (
          <TextInput
            {...props}
            name="contact"
            maxLength={200}
            defaultValue={record?.contact ?? ''}
            dir="auto"
          />
        )}
      </Field>

      {/*
       * HTTPS ONLY, and refused server-side. A `type="url"` control catches a typo;
       * the schema is what refuses `http://`, a URL carrying credentials, and
       * anything that is not a URL at all (§30, SECURITY_BASELINE.md §9.1).
       */}
      <Field
        id={`sale-url-${record?.id ?? 'new'}`}
        label={t('salePointWebsite')}
        help={t('salePointWebsiteHelp')}
      >
        {(props) => (
          <TextInput
            {...props}
            name="url"
            type="url"
            maxLength={2000}
            defaultValue={record?.url ?? ''}
          />
        )}
      </Field>

      <StateField
        id={`sale-state-${record?.id ?? 'new'}`}
        name="state"
        label={t('state')}
        copy={copy}
        value={record?.state}
      />
    </ActionForm>
  );
}

/**
 * The publication-state control, once.
 *
 * The three states are DERIVED from the domain schema rather than restated, so a
 * state added to the vocabulary appears in every form that has one and a state
 * removed disappears from all of them.
 */
function StateField({
  id,
  name,
  label,
  copy,
  value: current,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly copy: LibraryCopy;
  readonly value: string | undefined;
}) {
  return (
    <Field id={id} label={label}>
      {(props) => (
        <Select {...props} name={name} defaultValue={current ?? 'draft'}>
          {libraryStateSchema.options.map((option) => (
            <option key={option} value={option}>
              {copy.t(`stateName.${option}` as 'stateName.draft')}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
