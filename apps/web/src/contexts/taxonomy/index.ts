/**
 * Taxonomy — THE public interface.
 *
 * This file is the only path into the context. Everything under `application/`
 * and `domain/` is internal, and a cross-context or Layer-4 import that reaches
 * past this file fails the architecture gate (ARCHITECTURE.md §6.3 rule 4).
 *
 * WHAT IS DELIBERATELY ABSENT. No Prisma, no persistence adapter, no
 * transaction handle, no SQL. The context depends on the Layer-0 ports declared
 * in `@minhaj/contracts/taxonomy` and is handed their implementations by
 * Layer 4; it never names one (DOMAIN_MODEL.md §3.1 — Taxonomy: Layer 0 only).
 *
 * WHAT IS ALSO ABSENT, AND MATTERS MORE. Any operation that assigns a topic to
 * a content record. DOMAIN_MODEL.md §6.2 requires typed junctions with real
 * foreign keys at both ends, owned by the context that owns the TARGET — and no
 * such context has shipped. The integration rule a later owner follows is:
 *
 *   1. create your own junction table at your owning phase, with a real foreign
 *      key to `Topic(id)` and a real foreign key to your own target;
 *   2. own its adapter in your own directory, and its lifecycle in your own
 *      context — Taxonomy never writes another context's rows;
 *   3. read topics through `TaxonomyService`, which is this file.
 *
 * Offering a generic `assignTopic(targetType, targetId)` here would be the
 * polymorphic reference §6.2 prohibits, wearing a service's clothes. There is
 * no such function, and `assignmentStatus()` reports whether the database
 * already enforces complete relationships without exposing another context's
 * physical schema or providing a way to create one.
 */

export { createTaxonomyService } from './application/taxonomy-service.ts';

export type {
  TaxonomyActor,
  TaxonomyError,
  TaxonomyFailure,
  TaxonomyResult,
  TaxonomyService,
  TaxonomyServiceDependencies,
} from './application/taxonomy-service.ts';

export { missingTranslations, nextPosition, topicBreadcrumb } from './domain/topic.ts';

export { createTopicSearchSource } from './application/search-projection.ts';
