import type { Locale } from '@minhaj/contracts';
import type { PublicPersonCard as PersonCardData } from '@minhaj/contracts/people';

import { CARD_SURFACE, CARD_TITLE_LINK } from '@/components/editorial/frame';
import { directionOf } from '@/config/locale';
import { PersonPortraitFigure } from './portrait';

/**
 * ONE PUBLISHED CONTRIBUTOR AS A CARD (Phase 30-R): the portrait People serves,
 * at the inline start beside the words, the name and the opening of the
 * biography in the language they actually came from. A contributor without a
 * portrait is a text-first card — never an avatar placeholder.
 */
export function PersonCard({
  locale,
  person,
  creditLabel,
  headingLevel = 'h3',
}: {
  readonly locale: Locale;
  readonly person: PersonCardData;
  /** The localised word introducing a portrait credit. */
  readonly creditLabel: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  const language = person.resolvedLocale;
  const dir = directionOf(language);
  return (
    <li className={`${CARD_SURFACE} flex-row items-start gap-4`}>
      {person.portrait === null ? null : (
        <PersonPortraitFigure
          personId={person.id}
          portrait={person.portrait}
          name={person.name}
          nameLocale={language}
          creditLabel={creditLabel}
          className="w-24 shrink-0 sm:w-28"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Heading
          className="text-subheading leading-snug font-semibold text-balance wrap-anywhere"
          lang={language}
          dir={dir}
        >
          <a
            href={`/${locale}/people/${encodeURIComponent(person.slug)}`}
            className={CARD_TITLE_LINK}
          >
            {person.name}
          </a>
        </Heading>
        {person.excerpt === null ? null : (
          <p
            className="line-clamp-4 text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
            lang={language}
            dir={dir}
          >
            {person.excerpt}
          </p>
        )}
      </div>
    </li>
  );
}
