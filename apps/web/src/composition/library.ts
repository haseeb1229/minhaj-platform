import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type {
  LibraryAssetRequest,
  LibraryPublicReaderPort,
} from '@minhaj/contracts/library';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import {
  createLibraryPersistence,
  createLibraryPublicReader,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';

import { createLibraryAssetPolicy, createLibraryService } from '@/contexts/library';
import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';
import { peopleRuntime } from './people';
import { peopleReadRuntime } from './people-read';
import { taxonomyRuntime } from './taxonomy';

/**
 * The ADMINISTRATIVE Library composition root.
 *
 * Layer 4 is the only place that knows both a port and its adapter
 * (ARCHITECTURE.md §3.1.1). Library receives three interfaces — persistence,
 * authority, references — and can reach neither the Prisma client nor the SQL
 * behind any of them.
 *
 * WHY THE REFERENCE CHECKS LIVE HERE RATHER THAN IN THE CONTEXT. Library must
 * refuse a contributor who is not a Person and a Topic that is not a Topic, and
 * it must do so without reading People's or Taxonomy's tables — "never use
 * another context's private adapter or table". So the context declares WHAT it
 * needs answered and this root decides WHO answers, by calling the owners'
 * public read interfaces. A Library query that joined `Person` directly would
 * compile and would be exactly the boundary violation the architecture gate
 * exists to catch.
 *
 * THE AUTHORITY PORT IS A LIVE READ, never a session projection. It calls the
 * same `hasPermission` the editorial runtime calls, which reads the principal's
 * current permission set — so a revoked Library role denies the next action
 * rather than the next sign-in (SECURITY_BASELINE.md §3.4 rule 2). A contributor
 * relation and a contributor profile are absent from this path entirely: a
 * profile alone grants nothing.
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./library-read.ts` is the root for those,
 * and it deliberately reaches no Identity at all.
 */

function buildLibraryRuntime() {
  return {
    library: createLibraryService({
      persistence: createLibraryPersistence(),

      authority: {
        permits: (accountId: string, permission: string) =>
          identityRuntime().authorization.hasPermission(accountId, permission),
      },

      references: {
        /**
         * EVERY identifier must resolve, and the count is how that is checked.
         *
         * `contributorReferences` returns a row per identifier it recognises, so
         * a shorter answer means at least one was not a published contributor.
         * Comparing counts rather than inspecting each row is what makes a
         * partially valid list a refusal instead of a silent partial save.
         *
         * The locale is `'en'` because this asks about EXISTENCE, not about
         * presentation: the answer is a yes or no about a Person, and reading it
         * in the operator's interface language would make a reference valid in
         * one locale and invalid in another.
         */
        async validPeople(ids) {
          if (ids.length === 0) return true;
          const unique = [...new Set(ids)];
          const found = await peopleReadRuntime().people.contributorReferences(
            unique,
            'en',
          );
          return found.length === unique.length;
        },

        async validTopics(ids) {
          if (ids.length === 0) return true;
          const found = await taxonomyRuntime().taxonomy.topicReferences([...ids], 'en');
          return found.length === ids.length;
        },

        /**
         * A RETIRED language is not a valid language for a NEW Edition.
         *
         * Taxonomy owns the vocabulary and owns retirement; Library holds a typed
         * reference and asks. The foreign key alone would accept a retired code,
         * because retirement is a status rather than a deletion — which is why
         * this question is asked of the owner rather than left to the database.
         */
        async validLanguage(code) {
          const active = await taxonomyRuntime().taxonomy.listLanguages({
            includeRetired: false,
          });
          return active.some((entry) => entry.code === code);
        },
      },
    }),
  };
}

let runtime: ReturnType<typeof buildLibraryRuntime> | null = null;

export function libraryRuntime(): ReturnType<typeof buildLibraryRuntime> {
  return (runtime ??= buildLibraryRuntime());
}

/**
 * The PRIVILEGED serving policy: an administrator previewing an Edition's file
 * before it is public.
 *
 * WHY THIS AUTHORITY IS DISTINCT FROM THE PUBLIC DECISION. Without it the only way
 * for an operator to check that they attached the right PDF would be to publish the
 * Edition and look — which is a review step performed in production. So the policy
 * has a third purpose, `preview`, and it allows exactly one thing: an asset ALREADY
 * RECORDED against that Edition as its readable or download file, to a caller
 * holding `library.administer` right now.
 *
 * IT IS NOT "ADMINS CAN DOWNLOAD EVERYTHING" (§16, §28). The relation is still
 * checked, so an administrator cannot name an arbitrary asset identifier and
 * receive its bytes; and the permission is re-read LIVE through the same
 * authorisation service the mutations use, so a revoked Library role refuses the
 * next request rather than the next sign-in. No role name is inspected, no profile
 * flag is consulted, and nothing in the request can substitute for the permission
 * (SECURITY_BASELINE.md §3.4 rule 2).
 *
 * STORAGE STILL DECIDES INDEPENDENTLY. A quarantined or infected asset is refused
 * to an administrator exactly as it is to anybody else — which is the case worth
 * being sure about, because an operator checking an upload is precisely who would
 * otherwise be handed an unscanned file (§45).
 */
export function libraryPreviewAssetPolicy(
  request: LibraryAssetRequest,
  accountId: string,
): AssetAuthorizationPort {
  return createLibraryAssetPolicy({
    reader: previewRelations(),
    request,
    previewAuthority: {
      accountId,
      authority: {
        permits: (id: string, permission: string) =>
          identityRuntime().authorization.hasPermission(id, permission),
      },
    },
  });
}

/**
 * The upload budget for one operator — "file upload" is a protected flow
 * (SECURITY_BASELINE.md §15.2), authenticated or not.
 *
 * PER ACCOUNT, because the caller is always signed in here and an account is the
 * subject whose behaviour the limit is about. The subject is digested by the shared
 * limiter before it is stored, so no account identifier sits in clear in an
 * infrastructure table (§19.2).
 *
 * TWENTY IN FIFTEEN MINUTES is far above what cataloguing a book needs and far below
 * what filling a disk or keeping the scanner permanently busy would take. It is a
 * ceiling on abuse, not a workflow control.
 */
const UPLOAD_RULE = { window: 900, max: 20 } as const;

let uploadLimiter: ReturnType<typeof createRateLimiter> | null = null;

export async function consumeLibraryUpload(accountId: string): Promise<boolean> {
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  const limiter = (uploadLimiter ??= createRateLimiter(configuration));
  const decision = await limiter.consume(
    rateLimitKey({ purpose: 'library-upload', subject: accountId, configuration }),
    UPLOAD_RULE,
  );
  return decision.allowed;
}

let previewReader: LibraryPublicReaderPort | null = null;

function previewRelations(): LibraryPublicReaderPort {
  return (previewReader ??= createLibraryPublicReader());
}

/**
 * Bounded owner-provided choices for the Library administration forms.
 *
 * THE OWNERS PRODUCE THE OPTIONS. A contributor picker that queried Library's
 * own tables would be a second, slowly diverging copy of People's directory;
 * asking People means a contributor archived this morning stops being offered
 * this afternoon, with no Library code involved.
 *
 * BOUNDED, and invoked only after the caller's Library permission has been
 * checked by the page that renders the form. The listing itself is capped by
 * People's own reader rather than by a number chosen here.
 */
export async function libraryReferenceChoices(
  locale: Locale,
  query: string,
): Promise<{
  people: { id: string; name: string }[];
  topics: { id: string; name: string }[];
  languages: { code: string; name: string }[];
}> {
  const [people, topics, languages] = await Promise.all([
    peopleRuntime().people.listPeople({
      query: query || null,
      status: 'published',
      profileKind: null,
      locale,
      offset: 0,
    }),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    taxonomyRuntime().taxonomy.listLanguages({ includeRetired: false }),
  ]);

  return {
    people: people.items.map(({ id, label }) => ({ id, name: label.name })),
    topics: topics.map(({ id, label }) => ({ id, name: label.name })),
    languages: languages.map((entry) => ({
      code: entry.code,
      // The language's OWN name, not a translation of it. A list of content
      // languages that renamed itself per interface locale would make "which
      // language is this Edition in" a presentation question.
      name: entry.nativeName,
    })),
  };
}
