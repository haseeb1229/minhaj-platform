import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { ProfileFacetView, PublicPersonProfile } from '@minhaj/contracts/people';

import { peopleReadRuntime } from '@/composition/people-read';
import { absoluteUrl } from '@/config/origin';
import { requireLocale } from '@/config/route-locale';
import { Alert, Breadcrumbs, Container, Prose } from '@/components/ui';
import {
  contentMetadata,
  isContentIndexable,
  resolvedContentLocale,
  serializeStructuredData,
} from '@/seo/metadata';

/**
 * `/{locale}/people/{slug}` — THE canonical contributor profile
 * (ROUTE_MAP.md §2.1, §3.1).
 *
 * ONE ROUTE FOR ONE HUMAN BEING. A Person may hold author, speaker, scholar and
 * teacher facets at once, and this page presents the ones that apply. Giving
 * each facet its own indexable URL "would fragment one human being's search
 * authority across several pages" (§2.1), and `/authors/{slug}` and
 * `/library/authors/{slug}` are 301 aliases to this address rather than
 * competing pages.
 *
 * USABLE SIGNED OUT, AND STRUCTURALLY INDEPENDENT OF ANY SESSION. This page
 * reads no session, takes no actor and calls one service method that has no
 * parameter a viewer's identity could arrive through. The response a signed-in
 * visitor receives is semantically identical to an anonymous visitor's response,
 * which is what makes it safe for a shared cache to hold (ARCHITECTURE.md §8.1)
 * — and it is a property of the code's shape rather than a rule somebody
 * remembered.
 *
 * `force-dynamic`, AND THE REASON IS VISIBILITY RATHER THAN PERSONALISATION.
 * A contributor record is mutable: it is published, corrected, translated and
 * withdrawn by administrators. A statically rendered copy would keep serving a
 * withdrawn profile until something evicted it, and "unpublished, staged or
 * draft content is never publicly reachable at all" (ROUTE_MAP.md §9.5) is not
 * a claim a stale page can honour. Phase 4's shell routes stay static because
 * their content is code; this one is data. Formal performance acceptance is
 * Phase 34's, and a cache with proven invalidation is what that phase may add.
 *
 * NOTHING PRIVATE IS RENDERED. No account identifier, no address, no account
 * status, no permission name, no audit data and no capability. The read model
 * this page receives does not carry any of them — `PublicPersonProfile` has no
 * field for one — so there is nothing here to forget to strip.
 *
 * NO PORTRAIT AND NO INVENTED DETAIL. Storage arrives at Phase 7 and profile
 * media with the phase that owns it; there is no image, no external avatar URL,
 * no fabricated work list, no counts and no credentials this platform has not
 * been given (OPEN_DECISIONS.md §6.3).
 */
export const dynamic = 'force-dynamic';

interface ProfileParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

/** The canonical path for one language version of one contributor. */
function pathForProfile(slug: string): (locale: Locale) => string {
  return (locale) => `/${locale}/people/${slug}`;
}

export async function generateMetadata({ params }: ProfileParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;

  const profile = await peopleReadRuntime().people.publicProfile({ slug, locale });
  if (profile === null) {
    // A 404 CARRIES NO CANONICAL AND NO ALTERNATES. Announcing a language
    // version of a page that does not exist would be the false signal §9.2
    // exists to prevent, and a `noindex` here is what the absent record means.
    return { robots: { index: false, follow: false } };
  }

  return contentMetadata({
    locale,
    contentLocales: profile.contentLocales,
    primaryLocale: profile.primaryLocale,
    pathFor: pathForProfile(slug),
    title: profile.label.name,
    ...(profile.label.biography === null
      ? {}
      : { description: profile.label.biography.slice(0, 160) }),
  });
}

export default async function ContributorProfilePage({ params }: ProfileParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;

  const t = await getTranslations({ locale, namespace: 'people' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  // PUBLISHED ONLY, AND THE PREDICATE IS IN THE QUERY. A draft or archived
  // contributor is not returned at all, so this page cannot render one by
  // neglecting to check a field.
  const profile = await peopleReadRuntime().people.publicProfile({ slug, locale });
  if (profile === null) notFound();

  const resolved = resolvedContentLocale({
    locale,
    contentLocales: profile.contentLocales,
    primaryLocale: profile.primaryLocale,
  });

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { text: profile.label.name },
          ]}
        />

        {/* THE LANGUAGE NOTICE, WHEN THE CONTENT IS NOT IN THE REQUESTED
            LANGUAGE. ROUTE_MAP.md §9.3 requires the UI chrome to stay in the
            requested locale while the content is shown in one that exists, WITH
            a visible notice — never a generated translation and never a silent
            substitution. */}
        {profile.label.fallback ? (
          <Alert tone="info">
            {t('fallbackNotice', {
              requested: locale,
              shown: profile.label.resolvedLocale,
            })}
          </Alert>
        ) : null}

        <Prose>
          {/* The name is rendered in its OWN language and direction. `lang` and
              `dir` are on the element rather than on the page, so an Arabic name
              inside an English page renders right-to-left without flipping the
              page around it. */}
          <h1
            className="text-3xl font-semibold tracking-tight"
            lang={profile.label.resolvedLocale}
            dir="auto"
          >
            {profile.label.name}
          </h1>

          {profile.nameVariants.length === 0 ? null : (
            <p className="text-sm text-[color:var(--color-foreground-muted)]" dir="auto">
              <span className="font-medium">{t('alsoKnownAs')}: </span>
              {profile.nameVariants.join(' · ')}
            </p>
          )}

          {profile.label.biography === null ? null : (
            <p lang={profile.label.resolvedLocale} dir="auto">
              {profile.label.biography}
            </p>
          )}
        </Prose>

        {profile.facets.length === 0 ? null : (
          <section className="flex flex-col gap-6">
            <h2 className="text-xl font-semibold tracking-tight">{t('facets')}</h2>

            {profile.facets.map((facet) => (
              <FacetPanel key={facet.kind} facet={facet} t={t} />
            ))}
          </section>
        )}

        <PersonStructuredData profile={profile} resolved={resolved} slug={slug} />
      </div>
    </Container>
  );
}

type ProfileTranslator = Awaited<ReturnType<typeof getTranslations<'people'>>>;

/**
 * One facet the contributor genuinely holds and has made active.
 *
 * FACET LABELS, NOT CAPABILITIES. "Teacher" here says a teaching facet has been
 * described and published; it says nothing about what the person is permitted
 * to do, which comes from a role assignment and is never rendered publicly
 * (DOMAIN_MODEL.md §4.5).
 */
function FacetPanel({
  facet,
  t,
}: {
  readonly facet: ProfileFacetView;
  readonly t: ProfileTranslator;
}) {
  return (
    <article className="rounded-[var(--radius-panel)] border border-[color:var(--color-border)] p-5">
      <h3 className="pb-3 text-lg font-medium">
        {t(`kind.${facet.kind}` as 'kind.author')}
      </h3>

      {facet.details.length === 0 && facet.languages.length === 0 ? null : (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
          {facet.details.map((detail) => (
            <div key={detail.field} className="contents">
              <dt className="font-medium">
                {t(`field.${detail.field}` as 'field.qualifications')}
              </dt>
              <dd lang={detail.resolvedLocale} dir="auto">
                {detail.value}
              </dd>
            </div>
          ))}

          {facet.languages.length === 0 ? null : (
            <div className="contents">
              <dt className="font-medium">{t('languages')}</dt>
              <dd>{facet.languages.join(', ')}</dd>
            </div>
          )}
        </dl>
      )}
    </article>
  );
}

/**
 * `Person` structured data — emitted ONLY where it is both permitted and true.
 *
 * TWO GATES, AND BOTH MUST HOLD.
 *
 * FIRST, INDEXING. While the deployment is pre-adoption the whole site is
 * `noindex` and advertises no sitemap (ROUTE_MAP.md §9.5). Structured data on a
 * page nobody may index would be a machine-readable claim about a real person
 * published from a developer-controlled origin, which is exactly the
 * over-claiming §9.6 warns produces manual action penalties. So nothing is
 * emitted at all.
 *
 * SECOND, TRUTH. What it carries is the name this platform stores, the
 * canonical URL, and the alternative spellings an administrator entered.
 * Deliberately ABSENT: `sameAs`, because this platform holds no verified social
 * profiles and inventing one would be fabrication; `jobTitle` and
 * `hasCredential`, because a facet is a description and a qualification is
 * unverified (OPEN_DECISIONS.md §6.3); `affiliation`, because claiming an
 * organisational relationship is the adoption claim the product must not make;
 * `image`, because there is none; and anything derived from the linked account.
 *
 * A `Person` object with a name and a URL is a small claim, and it is one this
 * platform can stand behind.
 */
function PersonStructuredData({
  profile,
  resolved,
  slug,
}: {
  readonly profile: PublicPersonProfile;
  readonly resolved: Locale | null;
  readonly slug: string;
}) {
  // THE SAME CONDITION `contentMetadata` USES, from the same function — so a
  // page that emits `noindex` can never also emit structured data, whatever
  // order the two are read in.
  if (!isContentIndexable({ contentLocales: profile.contentLocales })) return null;
  if (resolved === null) return null;

  const person: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.label.name,
    url: absoluteUrl(`/${resolved}/people/${slug}`),
    ...(profile.nameVariants.length === 0
      ? {}
      : { alternateName: [...profile.nameVariants] }),
  };

  return (
    <script
      type="application/ld+json"
      // Stored names are data, not markup. The dedicated serializer escapes
      // `<` after JSON encoding so a value containing `</script>` cannot close
      // this script element. `locale` is validated before this component runs.
      dangerouslySetInnerHTML={{ __html: serializeStructuredData(person) }}
    />
  );
}
