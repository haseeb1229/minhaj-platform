import { highlightSegments } from './highlight';

/**
 * A result's text with the typed words marked — one implementation for the
 * unified results page and the Quran search page.
 *
 * Each segment is a React TEXT NODE, the matching ones wrapped in `<mark>`; no
 * HTML string is ever built, so indexed text cannot become markup here
 * (DELIVERY_PLAN.md Phase 17 §22).
 */
export function Highlighted({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}) {
  return (
    <>
      {highlightSegments(text, query).map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded-sm bg-[color:var(--color-highlight)] px-0.5 text-inherit"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
