import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  workInputSchema,
  editionInputSchema,
  translationInputSchema,
  salePointInputSchema,
  libraryIdSchema,
  libraryVersionSchema,
  type LibraryActor,
  type LibraryAuthorityPort,
  type LibraryReferencesPort,
  type LibraryPersistencePort,
} from '@minhaj/contracts/library';

class LibraryRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
export function libraryFailure(error: unknown): string {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' &&
    ['denied', 'invalid', 'conflict', 'not-found', 'duplicate-slug', 'limit'].includes(
      reason,
    )
    ? reason
    : 'unavailable';
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
  };
}
