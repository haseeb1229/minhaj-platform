import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  workInputSchema,
  editionInputSchema,
  translationInputSchema,
  salePointInputSchema,
  libraryIdSchema,
  librarySlugSchema,
  libraryVersionSchema,
  scholarlyAdminQuerySchema,
  scholarlyKindSchema,
  SCHOLARLY_INPUT_SCHEMAS,
  type LibraryActor,
  type LibraryAuthorityPort,
  type LibraryReferencesPort,
  type LibraryPersistencePort,
  type ScholarlyKind,
  type ScholarlyRecord,
  type ScholarlyRecordOf,
  type ScholarlyValue,
} from '@minhaj/contracts/library';

/** A declared field, not a parameter property: plain Node loads this module too. */
class LibraryRefusal extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
export function libraryFailure(error: unknown): string {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' &&
    [
      'denied',
      'invalid',
      'conflict',
      'not-found',
      'duplicate-slug',
      'duplicate-number',
      'limit',
    ].includes(reason)
    ? reason
    : 'unavailable';
}
/** A record read by kind is that kind's record — checked, never assumed. */
function isKind<K extends ScholarlyKind>(
  record: ScholarlyRecord | null,
  kind: K,
): record is ScholarlyRecordOf<K> {
  return record !== null && record.kind === kind;
}

export function createLibraryService(deps: {
  persistence: LibraryPersistencePort;
  authority: LibraryAuthorityPort;
  references: LibraryReferencesPort;
}) {
  const store = deps.persistence;
  async function permit(actor: LibraryActor, key: string) {
    if (!actor?.accountId || !(await deps.authority.permits(actor.accountId, key)))
      throw new LibraryRefusal('denied');
  }
  function edit(id: string | null, version: number | null) {
    if (id !== null) {
      libraryIdSchema.parse(id);
      libraryVersionSchema.parse(version);
    } else if (version !== null) throw new LibraryRefusal('invalid');
  }
  const offset = (v: number) => z.number().int().min(0).max(25_000).parse(v);
  return {
    async works(actor: LibraryActor, start = 0) {
      await permit(actor, 'library.read');
      return store.works(offset(start));
    },
    async work(actor: LibraryActor, id: string) {
      await permit(actor, 'library.read');
      return store.work(libraryIdSchema.parse(id));
    },
    /** A Work by its CURRENT slug, any state. A former slug finds nothing. */
    async workBySlug(actor: LibraryActor, slug: string) {
      await permit(actor, 'library.read');
      const found = await store.workBySlug(librarySlugSchema.parse(slug));
      // The store's collation is case-insensitive; the slug is exact or nothing.
      return found !== null && found.slug === slug ? found : null;
    },
    async editions(actor: LibraryActor, start = 0) {
      await permit(actor, 'library.read');
      return store.editions(offset(start));
    },
    async edition(actor: LibraryActor, id: string) {
      await permit(actor, 'library.read');
      return store.edition(libraryIdSchema.parse(id));
    },
    async salePoints(actor: LibraryActor, start = 0) {
      await permit(actor, 'library.read');
      return store.salePoints(offset(start));
    },
    async saveWork(
      actor: LibraryActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'library.administer');
      edit(id, expectedVersion);
      const value = workInputSchema.parse(raw);
      const ok = await Promise.all([
        deps.references.validPeople([
          ...new Set(value.contributors.map((v) => v.personId)),
        ]),
        deps.references.validTopics(value.topicIds),
      ]);
      if (ok.includes(false)) throw new LibraryRefusal('invalid');
      return store.saveWork({ actorId: actor.accountId, id, expectedVersion, value });
    },
    async saveEdition(
      actor: LibraryActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'library.administer');
      edit(id, expectedVersion);
      const value = editionInputSchema.parse(raw);
      if (!(await deps.references.validLanguage(value.languageCode)))
        throw new LibraryRefusal('invalid');
      const contentVersion = value.document
        ? createHash('sha256').update(JSON.stringify(value.document)).digest('hex')
        : null;
      return store.saveEdition({
        actorId: actor.accountId,
        id,
        expectedVersion,
        value,
        contentVersion,
      });
    },
    async saveTranslation(actor: LibraryActor, raw: unknown) {
      await permit(actor, 'library.administer');
      const value = translationInputSchema.parse(raw);
      if (!(await deps.references.validPeople(value.translatorIds)))
        throw new LibraryRefusal('invalid');
      return store.saveTranslation({ ...value, actorId: actor.accountId });
    },
    async removeTranslation(
      actor: LibraryActor,
      editionId: string,
      expectedVersion: number,
    ) {
      await permit(actor, 'library.administer');
      return store.removeTranslation({
        actorId: actor.accountId,
        editionId: libraryIdSchema.parse(editionId),
        expectedVersion: libraryVersionSchema.parse(expectedVersion),
      });
    },
    async saveSalePoint(
      actor: LibraryActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'library.administer');
      edit(id, expectedVersion);
      return store.saveSalePoint({
        actorId: actor.accountId,
        id,
        expectedVersion,
        value: salePointInputSchema.parse(raw),
      });
    },

    /* -----------------------------------------------------------------------
     * Phase 9 — Research, ResearchPaper, Publication, Magazine, MagazineIssue
     * and Encyclopedia. The same two authorities as every Library record: no
     * `research.*` or `magazine.*` key exists, because none would open or
     * close anything `library.read` and `library.administer` do not.
     * -------------------------------------------------------------------- */

    async scholarlyRecords(actor: LibraryActor, kind: ScholarlyKind, raw: unknown = {}) {
      await permit(actor, 'library.read');
      return store.scholarlyRecords(
        scholarlyKindSchema.parse(kind),
        scholarlyAdminQuerySchema.parse(raw),
      );
    },

    async scholarlyRecord<K extends ScholarlyKind>(
      actor: LibraryActor,
      kind: K,
      id: string,
    ): Promise<ScholarlyRecordOf<K> | null> {
      await permit(actor, 'library.read');
      const record = await store.scholarlyRecordById(
        scholarlyKindSchema.parse(kind),
        libraryIdSchema.parse(id),
      );
      return isKind(record, kind) ? record : null;
    },

    /**
     * Validates, checks every cross-context reference with its OWNER, and saves.
     *
     * THE REFERENCES ARE ASKED, NOT JOINED. A contributor must be a published
     * People contributor, a topic an active Taxonomy topic and a content
     * language an active Taxonomy language — answered by those owners' public
     * reads through the references port, never by a Library query against their
     * tables. A contributor credit grants nothing: it is attribution.
     */
    async saveScholarly<K extends ScholarlyKind>(
      actor: LibraryActor,
      kind: K,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'library.administer');
      scholarlyKindSchema.parse(kind);
      edit(id, expectedVersion);
      // The schema is chosen BY the kind, so the pair is correlated here, once.
      const save = {
        kind,
        value: SCHOLARLY_INPUT_SCHEMAS[kind].parse(raw),
      } as ScholarlyValue;
      const { value } = save;
      const checks = [
        deps.references.validPeople([
          ...new Set(value.contributors.map((entry) => entry.personId)),
        ]),
        deps.references.validTopics(value.topicIds),
        ...('languageCode' in value
          ? [deps.references.validLanguage(value.languageCode)]
          : []),
      ];
      if ((await Promise.all(checks)).includes(false))
        throw new LibraryRefusal('invalid');
      return store.saveScholarly({ actorId: actor.accountId, id, expectedVersion, save });
    },
  };
}
