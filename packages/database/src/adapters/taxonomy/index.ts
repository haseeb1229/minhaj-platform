import 'server-only';

/**
 * THE public entry of the Taxonomy persistence adapter.
 *
 * Semantic owner: `taxonomy`, declared in this package's manifest under
 * `minhaj.persistenceAdapters`. Physical placement inside a platform package
 * transfers no ownership (ARCHITECTURE.md §4.1, §6.3 rule 14).
 *
 * WHAT CROSSES THIS BOUNDARY. Two factory functions whose return types are the
 * narrow ports declared in `@minhaj/contracts/taxonomy`, and one error class
 * carrying a closed union of refusal reasons.
 *
 * WHAT DOES NOT: the Prisma client, a delegate, a transaction handle, a
 * raw-query facility, a generic repository or any type naming `Prisma`.
 * Possession of any of them IS raw database capability (ARCHITECTURE.md
 * §3.1.2), and a wrapper cannot convert holding one into permitted invocation
 * (§6.3 rule 13).
 *
 * READER AND PERSISTENCE ARE SEPARATE FACTORIES, and the split is the point.
 * The reader offers five read operations and nothing that can change what it
 * reads; the write side is reached only by the Taxonomy context's own
 * administrative service. A surface that needs to list topics never acquires
 * the ability to re-parent one.
 */

export {
  TaxonomyDataError,
  createTaxonomyPersistence,
  createTaxonomyReader,
} from './persistence.ts';
