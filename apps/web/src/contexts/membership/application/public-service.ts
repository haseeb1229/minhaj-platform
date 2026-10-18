import 'server-only';

import type {
  MembershipCatalogueReaderPort,
  PublicMembershipType,
} from '@minhaj/contracts/membership';

import { asMembershipRefusal } from '../domain/refusal.ts';

/**
 * The public Membership catalogue behind `/membership` — published types, in
 * display order, with their words in every locale they have.
 *
 * NOTHING PERSONAL, AND NO SESSION. The reader port has no method that returns
 * a draft or archived type, an application, a Membership or an account, so the
 * anonymous page built on this cannot reach one however it is called. Choosing
 * which locale's words to show is presentation, and stays with the page.
 */
export function createMembershipPublicService(deps: {
  readonly catalogue: MembershipCatalogueReaderPort;
}) {
  return {
    publishedTypes(): Promise<readonly PublicMembershipType[]> {
      return deps.catalogue.publishedTypes().catch(asMembershipRefusal);
    },
  };
}

export type MembershipPublicService = ReturnType<typeof createMembershipPublicService>;
