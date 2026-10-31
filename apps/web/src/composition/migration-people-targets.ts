import 'server-only';

import type { PersonDetail } from '@minhaj/contracts/people';
import type {
  MigrationActor,
  MigrationContentKind,
  MigrationPublicationTargetPort,
  PublishableAsset,
  StagedPersonPayload,
  TargetPublication,
} from '@minhaj/contracts/migration';

import type { PeopleService } from '../contexts/people-contributors/index.ts';
import {
  ADOPTION_PAGES,
  clearedImage,
  STILL_JPEG_PNG,
  refusal,
  withdrawalRefusal,
} from './migration-target-support.ts';

/**
 * The `people.person` publication target — Layer 4 (Phase 30-R;
 * MIGRATION_STRATEGY.md §4.12, §7).
 *
 * THROUGH PEOPLE'S PUBLIC SERVICE, UNDER PEOPLE'S OWN PERMISSION. People's
 * service records the permission its Layer-4 gate verified, so this target
 * first asks Identity, live, whether the publisher holds `people.administer` —
 * the same key the People administration requires — and refuses `denied`
 * otherwise. A migrated profile is then made exactly as an administrator makes
 * one: created in the primary locale, any further locale's words set, the
 * portrait recorded ONLY as the public copy of a rights-cleared acquisition,
 * and published. No profile kind, account link or name variant is invented.
 *
 * A PERSON HAS NO VERSION COLUMN; its last change stands in for one — the
 * instant of `updatedAt`, in whole seconds — so a rollback still refuses a
 * profile a person edited after migration published it.
 *
 * ADOPTION ONLY ON RESUME, ONLY FOR AN EXACT MATCH: a resumed entry meeting a
 * taken slug continues the profile it made — same slug, same primary name —
 * and refuses any other. A refresh sets the payload's words for each of its
 * locales and a newly cleared portrait, and keeps the profile published.
 * WITHDRAWAL archives the profile. Nothing personal can name a Person.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

export type PeopleOperations = Pick<
  PeopleService,
  | 'createPerson'
  | 'setTranslation'
  | 'setPortrait'
  | 'setStatus'
  | 'findPerson'
  | 'listPeople'
>;

const PERMISSION = 'people.administer';
const canonicalPath = (slug: string) => `/people/${slug}`;

/** The profile's last change, in whole seconds — its version for migration. */
function versionOf(person: { readonly updatedAt: Date }): number {
  return Math.max(1, Math.floor(person.updatedAt.getTime() / 1000));
}

function published(person: PersonDetail): TargetPublication {
  return {
    status: 'published',
    target: { kind: 'people.person', id: person.id },
    stage: 'public',
    version: versionOf(person),
    canonicalPath: canonicalPath(person.slug),
  };
}

function primaryLabel(payload: StagedPersonPayload) {
  return payload.labels.find((label) => label.locale === payload.primaryLocale) ?? null;
}

export function peoplePersonTargetOver(deps: {
  readonly people: PeopleOperations;
  readonly authority: {
    permits(accountId: string, permission: string): Promise<boolean>;
  };
}): MigrationPublicationTargetPort {
  const { people } = deps;
  const supports = (kind: MigrationContentKind) => kind === 'people.person';
  const actorOf = (actor: MigrationActor) => ({
    accountId: actor.accountId,
    permission: PERMISSION,
  });

  /** People's failure as an answer: an outage is `unavailable`, all else a refusal. */
  const answer = (failure: string): TargetPublication =>
    failure === 'unavailable' ? { status: 'unavailable' } : refusal(failure);

  /** Every further locale's words, the cleared portrait, then published. */
  async function complete(
    actor: ReturnType<typeof actorOf>,
    person: PersonDetail,
    payload: StagedPersonPayload,
    assets: readonly PublishableAsset[],
  ): Promise<TargetPublication> {
    let current = person;
    for (const label of payload.labels) {
      const held = current.translations.find((entry) => entry.locale === label.locale);
      if (
        held !== undefined &&
        held.name === label.name.trim() &&
        (held.biography ?? '') === label.biography.trim()
      )
        continue;
      const set = await people.setTranslation(actor, {
        personId: current.id,
        locale: label.locale,
        name: label.name,
        biography: label.biography.trim() === '' ? null : label.biography,
      });
      if (!set.ok) return answer(set.failure);
      current = set.person;
    }
    const portrait = clearedImage(payload.portrait, assets, STILL_JPEG_PNG);
    if (portrait !== null && current.portrait?.assetId !== portrait.assetId) {
      const set = await people.setPortrait(actor, {
        personId: current.id,
        portrait: {
          assetId: portrait.assetId,
          width: portrait.width,
          height: portrait.height,
          credit: portrait.credit,
        },
      });
      if (!set.ok) return answer(set.failure);
      current = set.person;
    }
    if (current.status !== 'published') {
      const set = await people.setStatus(actor, {
        personId: current.id,
        status: 'published',
      });
      if (!set.ok) return answer(set.failure);
      current = set.person;
    }
    return published(current);
  }

  /** The profile an interrupted publication made: same slug, same primary name. */
  async function adopt(
    actor: ReturnType<typeof actorOf>,
    payload: StagedPersonPayload,
    assets: readonly PublishableAsset[],
  ): Promise<TargetPublication> {
    const primary = primaryLabel(payload);
    if (primary === null) return refusal('invalid');
    for (let page = 0; page < ADOPTION_PAGES; page += 1) {
      const listing = await people.listPeople({
        query: primary.name,
        status: null,
        profileKind: null,
        locale: payload.primaryLocale,
        offset: page * 25,
      });
      const match = listing.items.find((item) => item.slug === payload.slug);
      if (match !== undefined) {
        const person = await people.findPerson({
          personId: match.id,
          locale: payload.primaryLocale,
        });
        if (person === null) return refusal('target-conflict');
        const held = person.translations.find(
          (entry) => entry.locale === payload.primaryLocale,
        );
        if (held?.name !== primary.name.trim() || person.status === 'archived')
          return refusal('target-conflict');
        return complete(actor, person, payload, assets);
      }
      if (!listing.more) break;
    }
    return refusal('target-conflict');
  }

  return {
    supports,

    async publish({ kind, payload, assets, actor, resumed }) {
      if (!supports(kind) || payload.kind !== 'people.person')
        return refusal('unsupported-kind');
      if (!(await deps.authority.permits(actor.accountId, PERMISSION)))
        return refusal('denied');
      const primary = primaryLabel(payload);
      if (primary === null) return refusal('invalid');
      const peopleActor = actorOf(actor);
      const created = await people.createPerson(peopleActor, {
        slug: payload.slug,
        primaryLocale: payload.primaryLocale,
        name: primary.name,
        biography: primary.biography.trim() === '' ? null : primary.biography,
      });
      if (created.ok) return complete(peopleActor, created.person, payload, assets);
      if (created.failure !== 'duplicate-slug') return answer(created.failure);
      // Adoption is for an interrupted publication of THIS entry only.
      return resumed ? adopt(peopleActor, payload, assets) : refusal('target-exists');
    },

    async refresh({ kind, target, payload, assets, actor }) {
      if (!supports(kind) || payload.kind !== 'people.person' || target.kind !== kind)
        return refusal('unsupported-kind');
      if (!(await deps.authority.permits(actor.accountId, PERMISSION)))
        return refusal('denied');
      const person = await people.findPerson({
        personId: target.id,
        locale: payload.primaryLocale,
      });
      if (person === null) return refusal('not-found');
      if (person.status === 'archived') return refusal('target-archived');
      return complete(actorOf(actor), person, payload, assets);
    },

    async inspect({ target }) {
      if (!supports(target.kind)) return null;
      const person = await people.findPerson({ personId: target.id, locale: 'en' });
      if (person === null)
        return { exists: false, version: 0, referencedByPeople: false };
      return { exists: true, version: versionOf(person), referencedByPeople: false };
    },

    async withdraw({ target, expectedVersion, actor }) {
      if (!supports(target.kind)) return withdrawalRefusal('unsupported-kind');
      if (!(await deps.authority.permits(actor.accountId, PERMISSION)))
        return withdrawalRefusal('denied');
      const person = await people.findPerson({ personId: target.id, locale: 'en' });
      if (person === null) return withdrawalRefusal('not-found');
      if (versionOf(person) !== expectedVersion) return withdrawalRefusal('conflict');
      const archived = await people.setStatus(actorOf(actor), {
        personId: person.id,
        status: 'archived',
      });
      if (!archived.ok)
        return archived.failure === 'unavailable'
          ? { status: 'unavailable' }
          : withdrawalRefusal(archived.failure);
      return { status: 'withdrawn', version: versionOf(archived.person) };
    },
  };
}
