import 'server-only';

import { createMembershipCatalogueReader } from '@minhaj/database';

import {
  createMembershipPublicService,
  type MembershipPublicService,
} from '@/contexts/membership';

/**
 * The PUBLIC Membership composition root — `/membership` reads through this.
 *
 * A SEPARATE ROOT FROM `./membership.ts`, AND THE SPLIT IS A SECURITY BOUNDARY.
 * The authenticated runtime wires Identity in; importing it would put the
 * session service into the module graph of an anonymous page. This root
 * reaches Membership's public catalogue reader and stops: no Identity, no
 * session, nothing that could read or write a cookie, and — because the reader
 * has no such method — no way to reach a draft or archived type, an
 * application, a Membership or an account (ARCHITECTURE.md §8.1).
 *
 * LAZY, so constructing it opens no connection and a build needs no database
 * (ARCHITECTURE.md §8.3.1).
 */

interface MembershipReadRuntime {
  readonly catalogue: MembershipPublicService;
}

let runtime: MembershipReadRuntime | null = null;

export function membershipReadRuntime(): MembershipReadRuntime {
  return (runtime ??= {
    catalogue: createMembershipPublicService({
      catalogue: createMembershipCatalogueReader(),
    }),
  });
}
