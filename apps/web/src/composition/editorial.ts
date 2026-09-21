import 'server-only';
import type { Locale } from '@minhaj/contracts';
import { peopleRuntime } from './people';
import {
  createEditorialPersistence,
  createCorrespondencePersistence,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';
import {
  createEditorialService,
  createCorrespondenceService,
} from '@/contexts/editorial';
import { identityRuntime } from './identity';
import { peopleReadRuntime } from './people-read';
import { taxonomyRuntime } from './taxonomy';
import { appLogger } from './logging';
import { serverEnv } from '@/config/server-env';

function buildEditorialRuntime() {
  const environment = serverEnv();
  const authority = {
    permits: (id: string, permission: string) =>
      identityRuntime().authorization.hasPermission(id, permission),
  };
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  return {
    editorial: createEditorialService({
      persistence: createEditorialPersistence(),
      authority,
      references: {
        async validContributors(ids) {
          const unique = [...new Set(ids)];
          return (
            (await peopleReadRuntime().people.contributorReferences(unique, 'en'))
              .length === unique.length
          );
        },
        async validTopics(ids) {
          return (
            (await taxonomyRuntime().taxonomy.topicReferences(ids, 'en')).length ===
            ids.length
          );
        },
        async validLanguages(codes) {
          const active = await taxonomyRuntime().taxonomy.listLanguages({
            includeRetired: false,
          });
          return codes.every((code) => active.some((entry) => entry.code === code));
        },
      },
      reportFailure: (operation) =>
        appLogger().error({ operation }, 'Editorial operation failed.'),
    }),
    correspondence: createCorrespondenceService({
      persistence: createCorrespondencePersistence(),
      authority,
      limiter: createRateLimiter(configuration),
      retentionDays: environment.CORRESPONDENCE_RETENTION_DAYS ?? null,
      key: (kind, subject) =>
        rateLimitKey({ purpose: `editorial-${kind}`, subject, configuration }),
    }),
  };
}
let runtime: ReturnType<typeof buildEditorialRuntime> | null = null;
export function editorialRuntime() {
  return (runtime ??= buildEditorialRuntime());
}

/** Bounded owner-provided choices; invoked only after the editor's permission check. */
export async function editorialReferenceChoices(locale: Locale, query: string) {
  const [people, topics] = await Promise.all([
    peopleRuntime().people.listPeople({
      query: query || null,
      status: 'published',
      profileKind: null,
      locale,
      offset: 0,
    }),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
  ]);
  return {
    people: people.items.map(({ id, label }) => ({ id, name: label.name })),
    topics: topics.map(({ id, label }) => ({ id, name: label.name })),
  };
}
