import 'server-only';

/**
 * THE public entry of the People & Contributors persistence adapter.
 *
 * Semantic owner: `people-contributors`, declared in this package's manifest
 * under `minhaj.persistenceAdapters`. Physical placement inside a platform
 * package transfers no ownership (ARCHITECTURE.md §4.1, §6.3 rule 14).
 *
 * WHAT CROSSES THIS BOUNDARY. Two factory functions whose return types are the
 * narrow ports declared in `@minhaj/contracts/people`, and one error class
 * carrying a closed union of refusal reasons.
 *
 * WHAT DOES NOT: the Prisma client, a delegate, a transaction handle, a
 * raw-query facility, a generic repository or any type naming `Prisma`.
 * Possession of any of them IS raw database capability (ARCHITECTURE.md
 * §3.1.2), and a wrapper cannot convert holding one into permitted invocation
 * (§6.3 rule 13).
 *
 * READER AND PERSISTENCE ARE SEPARATE FACTORIES, and the split matters more
 * here than anywhere else it is used. The reader is what the PUBLIC contributor
 * profile receives: four read operations, none of which can change what it
 * reads, and none of which returns the linked account identifier. A public page
 * that held the write surface would be one refactor away from a public page
 * that could archive a contributor.
 *
 * NOTHING HERE READS IDENTITY. The adapter stores an opaque account identifier
 * and never selects a column of `User`; the capability projection and the
 * closure reconciliation both reach Identity through its own public service, at
 * Layer 4 (DOMAIN_MODEL.md §3.1, §4.5).
 */

export {
  PeopleDataError,
  createPeoplePersistence,
  createPeopleReader,
} from './persistence.ts';
