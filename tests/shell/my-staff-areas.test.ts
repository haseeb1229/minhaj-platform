import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type {
  AuthorizationReaderPort,
  ResolvedSession,
} from '../../packages/contracts/src/identity/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
import { ADMIN_SURFACES } from '../../apps/web/src/app/[locale]/admin/surfaces.ts';
import {
  decideStaffAreas,
  staffAreasFrom,
} from '../../apps/web/src/app/[locale]/my/staff-areas.ts';
import { NO_STAFF_AREAS } from '../../apps/web/src/components/my/sections.ts';

/**
 * WHO IS OFFERED THE WAY TO `/teacher` AND `/admin` FROM MY MINHAJ (owner
 * direction 2026-11-08).
 *
 * The decision is Identity & Access's: the session's permissions as its
 * authorisation service evaluates them, live, read through the SAME
 * `reachableSurfaces` filter the administration's shell uses, and
 * `teaching.perform` for the Teacher area. These tests drive the real
 * authorisation service over a fake reader, so default deny, liveness and
 * fail-closed are proved against the service itself — and the negatives
 * matter most: no session, an ordinary member, a profile without the
 * permission, a failure to ask.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function session(accountId: string): ResolvedSession {
  return {
    sessionId: `session-${accountId}`,
    sessionCreatedAt: new Date('2026-11-08T00:00:00Z'),
    sessionExpiresAt: new Date('2026-11-09T00:00:00Z'),
    account: { id: accountId },
  } as unknown as ResolvedSession;
}

/** Identity's real authorisation service over an in-memory grant table. */
function identity(grants: Map<string, readonly string[]>) {
  const reader = {
    effectivePermissions: vi.fn(async (accountId: string) => grants.get(accountId) ?? []),
    findStepUpGrant: async () => null,
    privilegedPosture: async () => {
      throw new Error('not consulted');
    },
  } as unknown as AuthorizationReaderPort;
  const service = createAuthorizationService({ reader });
  return { evaluate: (s: ResolvedSession) => service.evaluate(s), reader };
}

describe('the staff areas My Minhaj offers', () => {
  it('offers nothing to a signed-out visitor, and never asks Identity', async () => {
    const evaluate = vi.fn();
    expect(await decideStaffAreas(null, evaluate)).toEqual(NO_STAFF_AREAS);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('offers nothing to an ordinary member', async () => {
    const { evaluate } = identity(new Map([['member', []]]));
    expect(await decideStaffAreas(session('member'), evaluate)).toEqual({
      teacher: false,
      admin: false,
    });
  });

  it('offers nothing to a profile without the permission — a profile alone grants nothing', async () => {
    // A public teacher profile, a People record, a Learning scope: none is an
    // Identity grant, so Identity answers with no permission and nothing is
    // offered. The decision has no other input to be persuaded by.
    const { evaluate } = identity(new Map([['profiled-teacher', []]]));
    expect(await decideStaffAreas(session('profiled-teacher'), evaluate)).toEqual(
      NO_STAFF_AREAS,
    );
    // A permission that opens neither area opens neither link.
    expect(staffAreasFrom(new Set(['not.a.permission', 'teaching', 'admin']))).toEqual(
      NO_STAFF_AREAS,
    );
  });

  it('offers the Teacher area to teaching authority, and only that', async () => {
    const { evaluate } = identity(new Map([['teacher', ['teaching.perform']]]));
    expect(await decideStaffAreas(session('teacher'), evaluate)).toEqual({
      teacher: true,
      admin: false,
    });
  });

  it('offers the administration exactly when the admin shell would open', async () => {
    for (const surface of ADMIN_SURFACES) {
      const held =
        typeof surface.permission === 'string'
          ? [surface.permission]
          : [surface.permission[0] ?? ''];
      expect(staffAreasFrom(new Set(held)), surface.key).toEqual({
        teacher: false,
        admin: true,
      });
    }
    const { evaluate } = identity(
      new Map([['both', ['users.read', 'teaching.perform']]]),
    );
    expect(await decideStaffAreas(session('both'), evaluate)).toEqual({
      teacher: true,
      admin: true,
    });
  });

  it('asks live: a revoked grant stops offering on the next request', async () => {
    const grants = new Map<string, readonly string[]>([['admin', ['users.read']]]);
    const { evaluate, reader } = identity(grants);
    expect((await decideStaffAreas(session('admin'), evaluate)).admin).toBe(true);
    grants.set('admin', []);
    expect((await decideStaffAreas(session('admin'), evaluate)).admin).toBe(false);
    expect(reader.effectivePermissions).toHaveBeenCalledTimes(2);
  });

  it('fails closed when Identity cannot be asked', async () => {
    const evaluate = vi.fn(async () => {
      throw new Error('identity unavailable');
    });
    expect(await decideStaffAreas(session('admin'), evaluate)).toEqual(NO_STAFF_AREAS);
  });

  it('reads no profile, scope or request input — only Identity’s answer', async () => {
    const read = (file: string) =>
      readFile(path.join(repoRoot, 'apps/web/src/app/[locale]/my', file), 'utf8');
    const importsOf = (source: string) =>
      [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

    const rule = await read('staff-areas.ts');
    expect(importsOf(rule)).toEqual([
      '@minhaj/contracts/identity',
      '@/components/my/sections',
      '../admin/surfaces',
    ]);

    const wiring = await read('staff.ts');
    expect(importsOf(wiring)).toEqual([
      '@minhaj/contracts',
      '@/components/my/sections',
      '@/composition/authorization',
      '@/composition/identity',
      '@/composition/logging',
      './staff-areas',
    ]);
    // The session is this request's own, resolved through Identity's
    // chokepoint; the permissions are Identity's live evaluation of it.
    expect(wiring).toContain('await requireOwnSession(locale)');
    expect(wiring).toContain('identityRuntime().authorization.evaluate(session)');
    for (const source of [rule, wiring])
      expect(source).not.toMatch(
        /searchParams|cookies\(|headers\(|learningRuntime|peopleRuntime/,
      );
  });
});
