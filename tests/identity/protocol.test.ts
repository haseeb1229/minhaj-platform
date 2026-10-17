import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canonicaliseEmail,
  emailSchema,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordSchema,
  timezoneSchema,
} from '../../packages/contracts/src/identity/index.ts';
import {
  accountSetupComplete,
  canTransition,
  mayHoldSession,
  notificationKey,
  wouldRemoveFinalAuthenticationMethod,
} from '../../apps/web/src/contexts/identity-access/domain/account.ts';
import { safeReturnTo } from '../../apps/web/src/composition/return-to.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * PROTOCOL AND INPUT RULES — the parts that need no database.
 *
 * SECURITY_BASELINE.md §7 divides requests into protocol classes and applies a
 * DIFFERENT model to each: a browser mutation gets CSRF and Origin checks, an
 * emailed link gets "GET renders, POST consumes", a provider callback gets a
 * signature. Applying the wrong model to a class is the failure this section
 * exists to prevent, and most of it is structural — visible in what the source
 * exports and how the routes are shaped.
 */

async function sourceOf(relative: string): Promise<string> {
  return readFile(path.join(repoRoot, relative), 'utf8');
}

const ACTIONS = 'apps/web/src/app/[locale]/(identity)/actions.ts';

describe('returnTo destinations', () => {
  const locale = 'en';

  it('accepts a same-origin path under a supported locale', () => {
    expect(safeReturnTo('/en/my/settings/security', locale)).toBe(
      '/en/my/settings/security',
    );
    expect(safeReturnTo('/ur/my', locale)).toBe('/ur/my');
    expect(safeReturnTo('/ar/my/settings/profile', locale)).toBe(
      '/ar/my/settings/profile',
    );
  });

  it('falls back safely for every hostile shape', () => {
    // An open redirect under a trusted domain is a phishing primitive, and a
    // particular reputational risk for a religious organisation whose visitors
    // have every reason to trust a link that appears to come from it
    // (SECURITY_BASELINE.md §9.3).
    //
    // ALLOWLIST, not denylist: everything that is not provably a local route
    // under a known locale falls back, so a shape nobody thought of fails
    // closed rather than passing through.
    const hostile = [
      // Absolute and scheme-bearing.
      'https://evil.example/steal',
      'http://evil.example',
      '//evil.example',
      '//evil.example/path',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      // Backslash variants some parsers normalise to `//`.
      '/\\evil.example',
      '/\\/evil.example',
      '/en/\\evil.example',
      // Traversal, raw and encoded.
      '/en/../../etc/passwd',
      '/en/%2e%2e/%2e%2e/admin',
      '/en/..%2fadmin',
      '/%2e%2e/%2e%2e',
      // Not a path at all.
      'my/settings',
      '',
      'en/my',
      // A locale nobody supports.
      '/fr/my',
      '/xx/my',
      '/admin',
      '/en/not-a-real-route',
      // Control characters, including the newline that splits a header.
      '/en/my\nSet-Cookie: a=b',
      '/en/my\r\nLocation: https://evil.example',
      '/en/my\u0000',
      // Malformed percent-encoding, which cannot be reasoned about.
      '/en/%zz',
      '/en/%',
    ];

    for (const candidate of hostile) {
      expect(safeReturnTo(candidate, locale), `${JSON.stringify(candidate)}`).toBe(
        '/en/my',
      );
    }
  });

  it('accepts Fatwa’s own-question destinations, and an opaque UUID only', () => {
    // Phase 20: `/fatwa/ask` sends an anonymous visitor through sign-in back to
    // `/my/questions/ask`; a question is addressed by its opaque id alone.
    const id = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    expect(safeReturnTo('/en/my/questions', locale)).toBe('/en/my/questions');
    expect(safeReturnTo('/ur/my/questions/ask', locale)).toBe('/ur/my/questions/ask');
    expect(safeReturnTo(`/ar/my/questions/${id}`, locale)).toBe(`/ar/my/questions/${id}`);
    expect(safeReturnTo('/en/my/questions/?offset=20', locale)).toBe(
      '/en/my/questions/?offset=20',
    );

    for (const candidate of [
      '/en/my/questions/not-an-id',
      '/en/my/questions/0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D',
      `/en/my/questions/${id}x`,
      `/en/my/questions/${id}/edit`,
      '/en/my/questions/0a1b2c3d-4e5f-0a6b-8c7d-9e0f1a2b3c4d',
      '/en/my/questions/0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d',
      '/en/my/questions/ask/extra',
      `/en/my/questions/%2e%2e/${id}`,
      `//evil.example/en/my/questions/${id}`,
      `/fr/my/questions/${id}`,
    ]) {
      expect(safeReturnTo(candidate, locale), candidate).toBe('/en/my');
    }
  });

  it('accepts Personalisation’s and Learning’s own pages and the island pages, exactly', () => {
    // Phase 21: a "sign in to save" island returns to the page it sits on, and
    // every `/my` page Personalisation delivers is a sign-in destination.
    const id = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    for (const accepted of [
      '/en/my/saved',
      '/en/my/saved/bookmarks',
      '/ur/my/saved/notes',
      '/ar/my/saved/collections',
      `/en/my/saved/collections/${id}`,
      '/en/my/history/reading',
      '/en/my/history/watch',
      '/en/my/progress/quran',
      '/en/my/notifications',
      '/en/my/settings/interests',
      '/en/my/settings/notifications',
      '/en/my/settings/privacy',
      '/en/my/saved/bookmarks?offset=20',
      '/en/library/articles/some-article',
      '/ur/library/books/a-book-2',
      '/ar/watch/videos/a-lecture',
      '/en/quran/surah/2/255',
      '/en/quran/surah/114/6',
      '/en/hadith/a-collection/7',
      // Phase 22: Learning's own pages, and the public Course page whose
      // island offers "sign in to enrol".
      '/en/my/learning',
      '/ur/my/learning/courses/a-course',
      '/ar/my/learning/paths/a-path-2',
      '/en/my/progress/courses',
      '/en/learn/courses/a-course',
    ])
      expect(safeReturnTo(accepted, locale), accepted).toBe(accepted);

    for (const candidate of [
      '/en/my/saved/collections/not-a-uuid',
      `/en/my/saved/collections/${id.toUpperCase()}`,
      `/en/my/saved/collections/${id}/edit`,
      `/en/my/saved/collections/${id}x`,
      '/en/my/saved/everything',
      '/en/my/history',
      '/en/my/progress',
      '/en/my/learning/courses',
      '/en/my/learning/courses/A-Course',
      '/en/my/learning/courses/a-course/lesson',
      '/en/my/learning/paths/',
      '/en/my/learning/classes',
      '/en/learn/courses',
      '/en/learn/courses/a_course',
      '/en/learn/paths/a-path',
      '/en/library/articles/../x',
      '/en/library/articles/%2e%2e/x',
      '/en/library/articles/Some-Article',
      '/en/library/articles/some_article',
      '/en/library/articles/-leading',
      '/en/library/articles/a/b',
      '/en/library/articles/',
      '/en/library/editions/a-book',
      '/en/quran/surah/0/1',
      '/en/quran/surah/1/0',
      '/en/quran/surah/01/1',
      '/en/quran/surah/1',
      '/en/quran/surah/1/1/extra',
      '/en/quran/surah/a/1',
      '/en/hadith/a-collection/0',
      '/en/hadith/a-collection/1234567',
      '/en/hadith/a-collection',
      '/en/watch/videos/a-lecture/transcript',
      '/en/watch/playlists/a-lecture',
      '//evil',
      '//evil.example/en/library/articles/x',
      '/\\evil.example/en/my/saved',
      'https://evil.example/en/my/saved',
      '/en//my/saved',
      '/fr/my/saved',
      '/en/my/saved%2f..%2fadmin',
      '/library/articles/some-article',
    ])
      expect(safeReturnTo(candidate, locale), candidate).toBe('/en/my');
  });

  it('falls back for an absent destination', () => {
    expect(safeReturnTo(null, locale)).toBe('/en/my');
  });

  it('falls back into the CALLER locale, not a fixed one', () => {
    expect(safeReturnTo(null, 'ur')).toBe('/ur/my');
    expect(safeReturnTo('https://evil.example', 'ar')).toBe('/ar/my');
  });
});

describe('the mutation surface', () => {
  it('is a Server Action module, with no non-async export', async () => {
    const source = await sourceOf(ACTIONS);

    // Next requires every runtime export of a `'use server'` module to be an
    // async function, and the architecture analyser only treats such a module
    // as a client-graph boundary when that holds. One `export const` here
    // silently pulls the whole database graph into the client walk.
    expect(source.startsWith("'use server';")).toBe(true);
    expect(source).not.toMatch(/^export const /m);
    expect(source).not.toMatch(/^export \{/m);
    expect(source).not.toMatch(/^export default/m);

    for (const match of source.matchAll(/^export (?:async )?function (\w+)/gm)) {
      expect(source, `${match[1]} must be async`).toContain(
        `export async function ${match[1]}`,
      );
    }
  });

  it('exposes NO route handler for authentication', async () => {
    // No blanket `/api/auth/*`. Mounting one would expose Better Auth's whole
    // endpoint collection — delete-user, change-email, change-password,
    // session revocation — OUTSIDE the wrappers that apply rate limiting,
    // audit and status enforcement.
    const { readdir } = await import('node:fs/promises');

    const walk = async (directory: string): Promise<string[]> => {
      const found: string[] = [];

      for (const entry of await readdir(path.join(repoRoot, directory), {
        withFileTypes: true,
      })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) found.push(...(await walk(relative)));
        else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
          found.push(relative);
        }
      }

      return found;
    };

    const routes = await walk('apps/web/src/app');

    // THE COMPLETE SET, named exactly, so a new handler cannot appear without
    // somebody deciding it should.
    //
    // The webhook is the provider callback, which cannot be a Server Action
    // because it is not a browser and holds no action id. The two Phase-4
    // handlers serve the machine-readable sitemaps: ROUTE_MAP.md §10 rule 6
    // makes those unprefixed non-locale routes. The two Phase-5 handlers are
    // the contributor ALIASES, which are handlers rather than pages for one
    // reason — ROUTE_MAP.md §9.1 rule 3 names the status code `301`, and a
    // page-level `permanentRedirect()` emits 308.
    //
    // The Phase-7 handler serves stored BYTES behind a default-deny
    // authorisation decision. It is a handler rather than a page because it
    // returns a file, and it is unprefixed because an asset has no interface
    // locale (ROUTE_MAP.md §10 rule 6). It imports NO Identity at all — the
    // decision port is injected, and Phase 7 ships no policy that ever allows.
    //
    // Every non-webhook handler but three is GET-only and mutates nothing. The
    // three exceptions are the uploads — Phase 11's audio file, Phase 12's
    // photograph and Phase 18's recitation segment — Class-A BROWSER mutations that cannot be Server Actions
    // because the Server Action body cap is global and is not raised. Each
    // carries explicit Origin, Fetch-Metadata and custom-header anti-CSRF
    // checks and a live permission; neither authenticates anybody. None of these is an authentication endpoint, which is what this
    // test exists to prevent. (Phase 21 onwards adds the `/api/my/*` Class-A
    // mutations and Phase 24 Messaging's two, each counted below.)
    expect([...routes].sort()).toEqual(
      [
        'apps/web/src/app/api/webhooks/resend/route.ts',
        'apps/web/src/app/sitemap.xml/route.ts',
        'apps/web/src/app/sitemaps/[partition]/route.ts',
        'apps/web/src/app/[locale]/(public)/authors/[slug]/route.ts',
        'apps/web/src/app/[locale]/(public)/library/authors/[slug]/route.ts',
        'apps/web/src/app/assets/[id]/route.ts',
        // Phase 8: Library's own byte routes, beneath the same unprefixed
        // `/assets` namespace. The public one imports no Identity; the preview
        // one READS a session to re-check `library.administer` live, and
        // neither authenticates anybody or changes anything.
        'apps/web/src/app/assets/library/editions/[editionId]/[purpose]/[assetId]/route.ts',
        'apps/web/src/app/assets/library/previews/[editionId]/[assetId]/route.ts',
        // Phase 10: the Watch speaker alias — the same shared, GET-only 301 to
        // `/people/{slug}` the two author aliases are.
        'apps/web/src/app/[locale]/(public)/watch/speakers/[slug]/route.ts',
        // Phase 23: the Learn teacher alias — the same shared, GET-only 301 to
        // `/people/{slug}` the author and speaker aliases are.
        'apps/web/src/app/[locale]/(public)/learn/teachers/[slug]/route.ts',
        // Phase 11: Media's audio byte routes — public playback, and the
        // administrator's preview, which READS a session to re-check
        // `media.administer` live — and the one audio upload.
        'apps/web/src/app/assets/media/audio/[trackId]/[assetId]/route.ts',
        'apps/web/src/app/assets/media/previews/audio/[trackId]/[assetId]/route.ts',
        'apps/web/src/app/api/admin/media/audio/[trackId]/asset/route.ts',
        // Phase 12: the same three for a Photo's image — public display, the
        // administrator's preview, and the one photograph upload.
        'apps/web/src/app/assets/media/photos/[photoId]/[assetId]/route.ts',
        'apps/web/src/app/assets/media/previews/photos/[photoId]/[assetId]/route.ts',
        'apps/web/src/app/api/admin/media/photos/[photoId]/asset/route.ts',
        // Phase 18: the same three for a Quran recitation segment's audio —
        // public playback, the preview that READS a session to re-check
        // `quran.read` live, and the one segment upload.
        'apps/web/src/app/assets/quran/recitations/[recitationId]/[segmentId]/[assetId]/route.ts',
        'apps/web/src/app/assets/quran/previews/recitations/[recitationId]/[segmentId]/[assetId]/route.ts',
        'apps/web/src/app/api/admin/quran/recitations/[recitationId]/segments/[segmentId]/asset/route.ts',
        // Phase 21: the private handlers a public page's island calls after
        // hydration, so the page's shared render never reads a session. Two
        // are GET reads of the signed-in person's own state; five are Class-A
        // BROWSER mutations through one same-origin-checked transport. None
        // authenticates anybody.
        'apps/web/src/app/api/my/bookmarks/route.ts',
        'apps/web/src/app/api/my/collection-items/route.ts',
        'apps/web/src/app/api/my/export/route.ts',
        'apps/web/src/app/api/my/history/route.ts',
        'apps/web/src/app/api/my/notes/route.ts',
        'apps/web/src/app/api/my/quran-progress/route.ts',
        'apps/web/src/app/api/my/target-state/route.ts',
        // Phase 22: Learning's handlers beneath the same prefix, admitted by
        // the same transport — one GET of the person's state on one Course,
        // two Class-A mutations (enrol, request a trial class) and Learning's
        // own export. None authenticates anybody.
        'apps/web/src/app/api/my/learning/state/route.ts',
        'apps/web/src/app/api/my/learning/enrolments/route.ts',
        'apps/web/src/app/api/my/learning/trials/route.ts',
        'apps/web/src/app/api/my/export/learning/route.ts',
        // Phase 24: Messaging's own export beside Learning's, through the same
        // personal transport; the three private attachment byte routes, each
        // READING a session and handing it to Messaging's live decision (the
        // participant's, the support staff member's, the moderator's); and
        // the three Messaging handlers — two Class-A BROWSER mutations (an
        // attachment upload, which cannot be a Server Action for the body-cap
        // reason the Media uploads give, and discarding an unsent upload) and
        // one GET catch-up read. None authenticates anybody.
        'apps/web/src/app/api/my/export/messaging/route.ts',
        'apps/web/src/app/assets/messaging/attachments/[attachmentId]/route.ts',
        'apps/web/src/app/assets/messaging/support/[attachmentId]/route.ts',
        'apps/web/src/app/assets/messaging/evidence/[reportId]/[attachmentId]/route.ts',
        'apps/web/src/app/api/messaging/conversations/[conversationId]/attachments/route.ts',
        'apps/web/src/app/api/messaging/conversations/[conversationId]/messages/route.ts',
        'apps/web/src/app/api/messaging/attachments/[attachmentId]/discard/route.ts',
      ].sort(),
    );

    // And the eighteen others (Phase 23 added the Learn teacher alias, Phase 24
    // the three attachment byte routes) genuinely are read-only: a mutating
    // verb on any of them would be a state-changing endpoint outside the
    // Class-A controls.
    const { readFile } = await import('node:fs/promises');

    const readOnly = routes.filter(
      (entry) =>
        !entry.includes('webhooks') &&
        !entry.includes('/api/admin/') &&
        !entry.includes('/api/my/') &&
        !entry.includes('/api/messaging/'),
    );
    expect(readOnly).toHaveLength(18);

    for (const route of readOnly) {
      const source = await readFile(path.join(repoRoot, route), 'utf8');

      for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(source, `${route} exports ${verb}`).not.toMatch(
          new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`),
        );
      }
    }

    // Phase 21's own, and Phase 22's beside them: every mutating verb is a POST
    // through the one transport that refuses a cross-origin request before
    // anything is read; the reads export GET alone; and none of them reaches an
    // authentication operation.
    const transport = await readFile(
      path.join(repoRoot, 'apps/web/src/app/api/my/personal-transport.ts'),
      'utf8',
    );
    expect(transport).toMatch(
      /if \(!isSameOriginMutation\(request, \w+\)\) return failed\('denied'\)/u,
    );
    const personal = routes.filter((entry) => entry.includes('/api/my/'));
    expect(personal).toHaveLength(12);
    for (const route of personal) {
      const source = await readFile(path.join(repoRoot, route), 'utf8');
      for (const verb of ['PUT', 'PATCH', 'DELETE'])
        expect(source, `${route} exports ${verb}`).not.toMatch(
          new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`),
        );
      if (/export\s+(async\s+)?function\s+POST\b/u.test(source)) {
        expect(source, route).toContain('personalMutation(');
        expect(source, route).not.toMatch(/export\s+(async\s+)?function\s+GET\b/u);
      }
      expect(source, route).not.toMatch(
        /signIn|signUp|signOut|resetPassword|verifyEmail|identity\.\w+\(/u,
      );
    }

    // Phase 24's Messaging handlers: each mutation is a POST alone whose FIRST
    // act is the Class-A check under Messaging's own intent header, before the
    // session is resolved; the catch-up read is a GET alone behind the Fetch
    // Metadata admission; and none reaches an authentication operation.
    const messaging = routes.filter((entry) => entry.includes('/api/messaging/'));
    expect(messaging).toHaveLength(3);
    expect(
      await readFile(
        path.join(repoRoot, 'apps/web/src/app/api/messaging/transport.ts'),
        'utf8',
      ),
    ).toMatch(/header: 'x-minhaj-intent',\s*value: 'messaging-attachment'/u);
    for (const route of messaging) {
      const source = await readFile(path.join(repoRoot, route), 'utf8');
      for (const verb of ['PUT', 'PATCH', 'DELETE'])
        expect(source, `${route} exports ${verb}`).not.toMatch(
          new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`),
        );
      if (/export\s+(async\s+)?function\s+POST\b/u.test(source)) {
        expect(source, route).not.toMatch(/export\s+(async\s+)?function\s+GET\b/u);
        const guard = source.indexOf(
          "if (!isSameOriginMutation(request, MESSAGING_INTENT)) return failed('denied');",
        );
        expect(guard, route).toBeGreaterThan(-1);
        expect(source.indexOf('messagingActor('), route).toBeGreaterThan(guard);
      } else {
        expect(source, route).toMatch(/export\s+(async\s+)?function\s+GET\b/u);
        const admitted = source.indexOf(
          "if (!isPrivateRead(request)) return failed('denied');",
        );
        expect(admitted, route).toBeGreaterThan(-1);
        expect(source.indexOf('messagingActor('), route).toBeGreaterThan(admitted);
      }
      expect(source, route).not.toMatch(
        /signIn|signUp|signOut|resetPassword|verifyEmail|identity\.\w+\(/u,
      );
    }
  });

  it('has no sign-out GET anywhere', async () => {
    const { readdir } = await import('node:fs/promises');

    const entries = await readdir(path.join(repoRoot, 'apps/web/src/app/[locale]'), {
      withFileTypes: true,
    });

    // A GET that mutates session state can be triggered by an image tag or a
    // link prefetch, so `/signout` does not exist as a page at all
    // (ROUTE_MAP.md §2.4).
    expect(entries.map((entry) => entry.name)).not.toContain('signout');
    expect(entries.map((entry) => entry.name)).not.toContain('sign-out');
  });

  it('accepts only POST on the provider callback', async () => {
    const source = await sourceOf('apps/web/src/app/api/webhooks/resend/route.ts');

    expect(source).toContain('export async function POST');

    // Any other verb would be a second, unreviewed entry point on a path whose
    // whole authentication is a signature over a POST body.
    for (const verb of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(source, `${verb} must not be exported`).not.toContain(
        `export async function ${verb}`,
      );
    }
  });

  it('re-checks the session inside every authenticated action', async () => {
    const source = await sourceOf(ACTIONS);

    // Route protection is navigational convenience, not a security boundary:
    // every mutation re-checks independently (SECURITY_BASELINE.md §3.4 rule
    // 2). The guard on `/my` exists so a signed-out visitor sees a sign-in
    // page, not so the actions can trust it.
    for (const action of [
      'revokeSessionAction',
      'revokeOtherSessionsAction',
      'changePasswordAction',
      'requestEmailChangeAction',
      'confirmEmailChangeAction',
      'updateProfileAction',
      'updateLanguageAction',
      'completeAccountSetupAction',
      'closeAccountAction',
    ]) {
      const body = source.slice(
        source.indexOf(`export async function ${action}`),
        source.indexOf('}\n', source.indexOf(`export async function ${action}`)),
      );

      expect(body, `${action} must resolve a session`).toContain('activeSession(locale)');
    }
  });

  it('coordinates People disposition before account-closure success', async () => {
    // Account closure is a Layer-4 coordination: Identity commits first,
    // People's idempotent disposition runs before success is reported.
    const actions = await sourceOf(ACTIONS);
    const closureStart = actions.indexOf('export async function closeAccountAction');
    const closureBody = actions.slice(
      closureStart,
      actions.indexOf('\n}', closureStart) + 2,
    );
    expect(closureBody.indexOf('releaseAccountLink(')).toBeGreaterThan(
      closureBody.indexOf('identity.closeAccount('),
    );
    expect(closureBody.indexOf('reconcileClosedAccountLinks(')).toBeGreaterThan(
      closureBody.indexOf('releaseAccountLink('),
    );
    expect(closureBody.indexOf('redirect(')).toBeGreaterThan(
      closureBody.indexOf('reconcileClosedAccountLinks('),
    );
    expect(closureBody).toContain('reconciliationFailed');
  });

  it('coordinates Personalisation disposition after Identity commits and before success', async () => {
    // Phase 21: the fourth owner removes saved items, notes, history and
    // notifications of the closed account in its own bounded batches; a
    // pending disposal is reported as pending, never as a completed closure.
    const actions = await sourceOf(ACTIONS);
    const closureStart = actions.indexOf('export async function closeAccountAction');
    const closureBody = actions.slice(
      closureStart,
      actions.indexOf('\n}', closureStart) + 2,
    );
    const closed = closureBody.indexOf('identity.closeAccount(');
    const disposed = closureBody.indexOf(
      'personalisationRuntime().account.disposeAccount(',
    );
    const swept = closureBody.indexOf(
      'personalisationRuntime().account.reconcileClosedAccounts(',
    );
    expect(closed).toBeGreaterThan(0);
    expect(disposed).toBeGreaterThan(closed);
    expect(swept).toBeGreaterThan(disposed);
    expect(closureBody.indexOf('redirect(')).toBeGreaterThan(swept);
    expect(closureBody).toMatch(/personalPending\s*=\s*!personal\.complete/u);
    const pending = closureBody.indexOf("failure: 'closure-pending'");
    expect(closureBody.slice(0, pending)).toMatch(/\|\|\s*personalPending\s*\|\|/u);
    expect(closureBody.indexOf('redirect(')).toBeGreaterThan(pending);
  });

  it('coordinates Learning disposition after Identity commits and before success', async () => {
    // Phase 22: the fifth owner removes the closed account's Enrolments,
    // Progress and trial requests in its own bounded batches — never a Course
    // or a path — and a pending disposal is reported as pending.
    const actions = await sourceOf(ACTIONS);
    const closureStart = actions.indexOf('export async function closeAccountAction');
    const closureBody = actions.slice(
      closureStart,
      actions.indexOf('\n}', closureStart) + 2,
    );
    const closed = closureBody.indexOf('identity.closeAccount(');
    const disposed = closureBody.indexOf('learningRuntime().account.disposeAccount(');
    const swept = closureBody.indexOf(
      'learningRuntime().account.reconcileClosedAccounts(',
    );
    expect(closed).toBeGreaterThan(0);
    expect(disposed).toBeGreaterThan(closed);
    expect(swept).toBeGreaterThan(disposed);
    expect(closureBody.indexOf('redirect(')).toBeGreaterThan(swept);
    expect(closureBody).toMatch(/learningPending\s*=\s*!learning\.complete/u);
    const pending = closureBody.indexOf("failure: 'closure-pending'");
    expect(closureBody.slice(0, pending)).toMatch(/\|\|\s*learningPending\s*\|\|/u);
    expect(closureBody.indexOf('redirect(')).toBeGreaterThan(pending);
  });

  it('coordinates Messaging disposition after Learning and before success', async () => {
    // Phase 24: the sixth owner closes the account's conversations, removes
    // its read positions, blocks and unsent uploads and disposes of what no
    // remaining participant can read — refused by Messaging until Identity
    // reports the account closed — and a pending disposal is reported as
    // pending, never as a completed closure.
    const actions = await sourceOf(ACTIONS);
    const closureStart = actions.indexOf('export async function closeAccountAction');
    const closureBody = actions.slice(
      closureStart,
      actions.indexOf('\n}', closureStart) + 2,
    );
    const learned = closureBody.indexOf(
      'learningRuntime().account.reconcileClosedAccounts(',
    );
    const disposed = closureBody.indexOf('messagingRuntime().service.disposeAccount(');
    const swept = closureBody.indexOf(
      'messagingRuntime().service.reconcileClosedAccounts(',
    );
    expect(learned).toBeGreaterThan(closureBody.indexOf('identity.closeAccount('));
    expect(disposed).toBeGreaterThan(learned);
    expect(swept).toBeGreaterThan(disposed);
    expect(closureBody.indexOf('redirect(')).toBeGreaterThan(swept);
    expect(closureBody).toMatch(/messagingPending\s*=\s*!messaging\.complete/u);
    const pending = closureBody.indexOf("failure: 'closure-pending'");
    expect(closureBody.slice(0, pending)).toMatch(/\|\|\s*messagingPending\s*\)/u);
    expect(closureBody.indexOf('redirect(')).toBeGreaterThan(pending);
  });

  it('renders emailed links with a GET that consumes nothing', async () => {
    for (const page of [
      'apps/web/src/app/[locale]/(identity)/verify-email/page.tsx',
      'apps/web/src/app/[locale]/(identity)/reset-password/page.tsx',
      'apps/web/src/app/[locale]/(identity)/confirm-email-change/page.tsx',
    ]) {
      const source = await sourceOf(page);

      // The GET may INSPECT. It may not confirm, consume or reset — those are
      // the POST's, reached through a Server Action (SECURITY_BASELINE.md
      // §7.4).
      expect(source, `${page} must not consume`).not.toMatch(
        /identity\.(confirmVerification|resetPassword|confirmEmailChange)\(/,
      );
      expect(source).toMatch(/identity\.inspect\w+\(/);
    }
  });

  it('marks every authentication surface noindex', async () => {
    const { readdir } = await import('node:fs/promises');

    const walk = async (directory: string): Promise<string[]> => {
      const found: string[] = [];

      for (const entry of await readdir(path.join(repoRoot, directory), {
        withFileTypes: true,
      })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) found.push(...(await walk(relative)));
        else if (entry.name === 'page.tsx') found.push(relative);
      }

      return found;
    };

    const pages = [
      ...(await walk('apps/web/src/app/[locale]/(identity)')),
      ...(await walk('apps/web/src/app/[locale]/my')),
    ];

    expect(pages.length).toBeGreaterThan(0);

    for (const page of pages) {
      const source = await sourceOf(page);

      // An indexed sign-in or account page is a page a search engine will
      // fetch, cache and show — with whatever a crawler's request rendered
      // (ROUTE_MAP.md §4).
      expect(source, `${page} must be noindex`).toContain('robots: { index: false');
    }
  });
});

describe('session cookie security', () => {
  it('derives `Secure` from the ORIGIN SCHEME, not from NODE_ENV', async () => {
    // ONE definition, since Phase 25: the web process and the realtime process
    // both build their authentication adapter from this function, so a cookie
    // one accepts is exactly a cookie the other accepts.
    const source = await sourceOf('apps/web/src/composition/identity-mechanics.ts');
    for (const root of [
      'apps/web/src/composition/identity.ts',
      'apps/web/src/composition/realtime.ts',
    ]) {
      const composition = await sourceOf(root);
      expect(composition, root).toMatch(
        /createAuthMechanicsAdapter\(\s*authMechanicsConfiguration\(environment, limiter\),?\s*\)/u,
      );
      expect(composition, root).not.toMatch(/useSecureCookies/u);
    }

    // `Secure` is a statement about the scheme a cookie may travel over, so
    // the scheme decides it. Keying it on `NODE_ENV` is wrong in BOTH
    // directions: an HTTPS deployment without `NODE_ENV=production` would
    // issue session cookies with no `Secure` at all, and a
    // `NODE_ENV=production` process behind a plain-HTTP origin would issue
    // cookies the browser stores and never sends back.
    expect(source).toContain(
      "useSecureCookies: new URL(environment.AUTH_BASE_URL).protocol === 'https:'",
    );
    expect(source).not.toMatch(/useSecureCookies:\s*environment\.NODE_ENV/);
  });

  it('marks every auth cookie HttpOnly, and SameSite=Lax', async () => {
    const source = await sourceOf(
      'packages/database/src/adapters/identity-access/auth.ts',
    );

    // HttpOnly keeps a session token out of reach of any script on the page,
    // which is the difference between an XSS that defaces and one that takes
    // the account. `Lax` still permits the top-level navigation an emailed
    // link performs, while refusing a cross-site form post.
    expect(source).toContain('httpOnly: true');
    expect(source).toContain("sameSite: 'lax'");
  });

  it('hands the cookie store a DECODED value, so it is not encoded twice', async () => {
    const source = await sourceOf('apps/web/src/composition/request.ts');

    // The auth library hands over an already-serialised `Set-Cookie`, so its
    // value is percent-encoded. Next's cookie store serialises again, and an
    // already-encoded value therefore goes out encoded TWICE: a signature
    // containing `+` leaves as `%252B`, returns decoded once as `%2B`, and no
    // longer verifies.
    //
    // The failure is unusually quiet — sign-in appears to work, because the
    // action's own response renders the destination with the session it just
    // created, and the NEXT page load is signed out with no error anywhere.
    // A browser found it; this keeps it found.
    expect(source).toContain('value: decodeCookieValue(parsed.value)');
    expect(source).not.toMatch(/^\s*value: parsed\.value,$/m);
  });

  it('carries the library’s own cookie attributes across rather than re-deciding them', async () => {
    const source = await sourceOf('apps/web/src/composition/request.ts');

    // `HttpOnly`, `Secure` and `SameSite` are security properties the auth
    // library chose for that specific cookie. Re-deriving them at this layer
    // is how a session cookie quietly loses one.
    for (const attribute of ['httpOnly', 'secure', 'sameSite', 'path', 'maxAge']) {
      expect(source, `${attribute} must be carried across`).toContain(
        `parsed.${attribute}`,
      );
    }
  });

  it('caches no session, so a revocation takes effect immediately', async () => {
    const source = await sourceOf(
      'packages/database/src/adapters/identity-access/auth.ts',
    );

    // A cached session cannot be revoked on another device until the cache
    // expires, which would make "sign out everywhere else" a promise the
    // product could not keep.
    expect(source).toContain('cookieCache: { enabled: false }');
  });
});

describe('input rules', () => {
  it('canonicalises an address by trimming and lowercasing, and no more', () => {
    expect(canonicaliseEmail('  Someone@Example.COM ')).toBe('someone@example.com');

    // Provider-specific rewriting is NOT canonicalisation. Applying Gmail's
    // dot and plus behaviour globally merges distinct people's accounts
    // (DOMAIN_MODEL.md §4.6).
    expect(canonicaliseEmail('a.b@example.com')).toBe('a.b@example.com');
    expect(canonicaliseEmail('a+tag@example.com')).toBe('a+tag@example.com');
  });

  it('canonicalises as part of PARSING, so no caller holds a raw address', () => {
    expect(emailSchema.parse('  Person@Example.COM  ')).toBe('person@example.com');
  });

  it('rejects an address that is not one', () => {
    for (const candidate of [
      '',
      'a',
      'not-an-address',
      '@example.com',
      'a@',
      'a b@c.d',
    ]) {
      expect(emailSchema.safeParse(candidate).success, candidate).toBe(false);
    }
  });

  it('bounds an address at the addressable RFC limit', () => {
    const oversized = `${'a'.repeat(320)}@example.com`;
    expect(emailSchema.safeParse(oversized).success).toBe(false);
  });

  it('bounds a password at both ends', () => {
    expect(passwordSchema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH - 1)).success).toBe(
      false,
    );
    expect(passwordSchema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(MAX_PASSWORD_LENGTH)).success).toBe(true);

    // An unbounded password is an unbounded hash input, and the hash is
    // deliberately memory-hard.
    expect(passwordSchema.safeParse('a'.repeat(MAX_PASSWORD_LENGTH + 1)).success).toBe(
      false,
    );
  });

  it('imposes no complexity theatre', () => {
    // Character-class rules push people toward predictable substitutions
    // without measurably improving resistance; the defence is the hash and the
    // limiter (SECURITY_BASELINE.md §15).
    expect(passwordSchema.safeParse('correct horse battery staple').success).toBe(true);
  });

  it('validates a timezone against the runtime zone table, not a pattern', () => {
    expect(timezoneSchema.safeParse('Asia/Karachi').success).toBe(true);
    expect(timezoneSchema.safeParse('Europe/London').success).toBe(true);

    // A pattern would accept this. An unknown zone must fail HERE rather than
    // at first use, months later, in a scheduling calculation.
    expect(timezoneSchema.safeParse('Middle/Earth').success).toBe(false);
    expect(timezoneSchema.safeParse('').success).toBe(false);
  });
});

describe('account domain rules', () => {
  it('permits only the accepted status transitions', () => {
    expect(canTransition('active', 'disabled')).toBe(true);
    expect(canTransition('active', 'suspended')).toBe(true);
    expect(canTransition('disabled', 'active')).toBe(true);
    expect(canTransition('suspended', 'active')).toBe(true);
  });

  it('makes closure TERMINAL', () => {
    // `closed` reaches nothing, so no reactivation path can be added by
    // accident — the shape of the whole table is the guarantee.
    for (const target of ['active', 'disabled', 'suspended', 'closed'] as const) {
      expect(canTransition('closed', target), `closed -> ${target}`).toBe(false);
    }
  });

  it('lets only an ACTIVE account hold a session', () => {
    expect(mayHoldSession('active')).toBe(true);

    for (const status of ['disabled', 'suspended', 'closed'] as const) {
      expect(mayHoldSession(status), status).toBe(false);
    }
  });

  it('refuses to remove the final authentication method', () => {
    expect(wouldRemoveFinalAuthenticationMethod(1)).toBe(true);
    expect(wouldRemoveFinalAuthenticationMethod(0)).toBe(true);
    expect(wouldRemoveFinalAuthenticationMethod(2)).toBe(false);
  });

  it('treats setup as incomplete until the address, locale and zone are settled', () => {
    const base = {
      id: 'u1',
      email: 'a@b.invalid',
      name: 'A',
      locale: 'en',
      status: 'active' as const,
      createdAt: new Date(),
    };

    expect(
      accountSetupComplete({
        ...base,
        emailVerified: false,
        timezone: 'Asia/Karachi',
        accountSetupCompletedAt: new Date(),
      }),
    ).toBe(false);

    expect(
      accountSetupComplete({
        ...base,
        emailVerified: true,
        timezone: null,
        accountSetupCompletedAt: new Date(),
      }),
    ).toBe(false);

    expect(
      accountSetupComplete({
        ...base,
        emailVerified: true,
        timezone: 'Asia/Karachi',
        accountSetupCompletedAt: null,
      }),
    ).toBe(false);

    expect(
      accountSetupComplete({
        ...base,
        emailVerified: true,
        timezone: 'Asia/Karachi',
        accountSetupCompletedAt: new Date(),
      }),
    ).toBe(true);
  });

  it('derives a notification key deterministically per event', () => {
    const key = notificationKey({
      purpose: 'identity.password-changed',
      accountId: 'u1',
      occasion: 'change:1',
    });

    // Deterministic per (purpose, account, occasion), so a relay that retried
    // after committing cannot produce a second message — and two GENUINE
    // changes still produce two.
    expect(
      notificationKey({
        purpose: 'identity.password-changed',
        accountId: 'u1',
        occasion: 'change:1',
      }),
    ).toBe(key);

    expect(
      notificationKey({
        purpose: 'identity.password-changed',
        accountId: 'u1',
        occasion: 'change:2',
      }),
    ).not.toBe(key);
  });
});

describe('rate-limit policy', () => {
  it('covers every exposed sensitive self-service operation', async () => {
    const { IDENTITY_RATE_LIMITS } =
      await import('../../apps/web/src/contexts/identity-access/domain/rate-limits.ts');

    // A flow that reaches the platform without a budget is a flow an attacker
    // may repeat without cost (SECURITY_BASELINE.md §15.2).
    for (const flow of [
      'sign-in',
      'sign-up',
      'verification-resend',
      'verification-confirm',
      'password-reset-request',
      'password-reset-confirm',
      'password-change',
      'email-change-request',
      'email-change-confirm',
      'account-closure',
    ] as const) {
      const limit = IDENTITY_RATE_LIMITS[flow];

      expect(limit, flow).toBeDefined();
      expect(limit.perAccount.max, `${flow} per-account`).toBeGreaterThan(0);
      expect(limit.perClient.max, `${flow} per-client`).toBeGreaterThan(0);
      expect(limit.perAccount.window, `${flow} window`).toBeGreaterThan(0);
    }
  });

  it('keeps the mail-sending flows tightest', async () => {
    const { IDENTITY_RATE_LIMITS } =
      await import('../../apps/web/src/contexts/identity-access/domain/rate-limits.ts');

    // Their abuse lands in SOMEBODY ELSE's inbox, which is what makes
    // verification resend and forgot-password the classic mail-bombing vectors
    // rather than merely noisy ones.
    for (const flow of [
      'verification-resend',
      'password-reset-request',
      'email-change-request',
    ] as const) {
      expect(IDENTITY_RATE_LIMITS[flow].perAccount.max, flow).toBeLessThanOrEqual(3);
    }
  });

  it('gives every flow BOTH a per-account and a per-client budget', async () => {
    const { IDENTITY_RATE_LIMITS } =
      await import('../../apps/web/src/contexts/identity-access/domain/rate-limits.ts');

    // Either alone leaves the other attack unbounded: per-account stops
    // credential stuffing against one person, per-client stops one source
    // spraying everybody.
    for (const [flow, limit] of Object.entries(IDENTITY_RATE_LIMITS)) {
      expect(limit.perClient.max, `${flow} client budget`).toBeGreaterThanOrEqual(
        limit.perAccount.max,
      );
    }
  });
});
