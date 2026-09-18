import { getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { requireLocale } from '@/config/route-locale';
import { Alert, EmptyState, PageHeading, Panel, SectionHeading } from '@/components/ui';

/**
 * Topic mapping — cross-domain topic assignment, as it ACTUALLY stands.
 *
 * WHAT THIS PAGE IS, AND WHY IT IS NOT A FORM.
 *
 * INFORMATION_ARCHITECTURE.md calls this surface "cross-domain topic
 * assignment", and DOMAIN_MODEL.md §6.2 fixes how such an assignment must be
 * built: a TYPED junction with a real foreign key to `Topic` and a real foreign
 * key to its single target, owned by the context that owns that target. A
 * generic `targetType + targetId` is prohibited outright, because SQL Server
 * cannot foreign-key a polymorphic pair to many tables and such a design
 * guarantees dangling references.
 *
 * No context owning a taxonomy target has shipped. Article, Quran, Hadith,
 * Fatwa, Course and the rest arrive with their own phases. So there is nothing
 * to assign a topic TO, and this page says so — because the alternatives were
 * both worse than an honest empty state:
 *
 *   - a generic content picker backed by `targetType + targetId` would be the
 *     prohibited design, delivered as a feature;
 *   - placeholder target tables created so a form had something to point at
 *     would be premature business schema for owners who have not arrived.
 *
 * WHAT IT READS. A semantic integrity status derived privately from the
 * DATABASE'S OWN foreign-key catalogue, not a list this repository declares.
 * Physical table, column and constraint names never cross the adapter boundary:
 * those are implementation detail owned by the later context, not product
 * vocabulary Taxonomy may publish.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function TopicMappingPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });

  await requireAdminPage(locale, 'taxonomy.read', `/${locale}/admin/taxonomy/mapping`);

  const status = await taxonomyRuntime().taxonomy.assignmentStatus();

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('taxonomy.mapping.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('taxonomy.mapping.description')}
        </p>
      </header>

      {status.enforcedRelationships === 0 ? (
        <>
          <EmptyState>{t('taxonomy.mapping.none')}</EmptyState>
          <Alert tone="info">{t('taxonomy.mapping.noneDetail')}</Alert>
        </>
      ) : (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('taxonomy.mapping.statusTitle')}</SectionHeading>
            <p className="text-sm">
              {t('taxonomy.mapping.enforced', {
                count: status.enforcedRelationships,
              })}
            </p>
            <Alert tone={status.incompleteRelationships === 0 ? 'success' : 'error'}>
              {status.incompleteRelationships === 0
                ? t('taxonomy.mapping.complete')
                : t('taxonomy.mapping.incomplete', {
                    count: status.incompleteRelationships,
                  })}
            </Alert>
          </div>
        </Panel>
      )}

      {/* ---- The rule a later owner follows -------------------------------- */}
      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('taxonomy.mapping.ruleTitle')}</SectionHeading>
          <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm">
            <li>{t('taxonomy.mapping.ruleOne')}</li>
            <li>{t('taxonomy.mapping.ruleTwo')}</li>
            <li>{t('taxonomy.mapping.ruleThree')}</li>
          </ol>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('taxonomy.mapping.ruleProhibition')}
          </p>
        </div>
      </Panel>
    </main>
  );
}
