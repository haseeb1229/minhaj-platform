import { htmlToText, wordDiff, type WordDiff } from './revision-diff';

/**
 * What changed in one revision against the one before it (R2, audit F31):
 * per language the two revisions share, the title and the body as an inline
 * word diff. A language added or dropped is said in words.
 *
 * Insertions and deletions are real `<ins>`/`<del>`, and each is also marked
 * by the visually hidden words the caller passes ("added", "removed"), so the
 * change is never carried by colour or strike-through alone. The text keeps
 * its own language and direction.
 */

interface Translation {
  readonly languageCode: string;
  readonly title: string;
  readonly html: string;
}

export interface RevisionDiffLabels {
  readonly heading: string;
  readonly title: string;
  readonly body: string;
  readonly added: string;
  readonly removed: string;
  readonly unchanged: string;
  readonly truncated: string;
  readonly languageAdded: (language: string) => string;
  readonly languageRemoved: (language: string) => string;
}

function Diff({
  diff,
  labels,
  lang,
}: {
  readonly diff: WordDiff;
  readonly labels: RevisionDiffLabels;
  readonly lang: string;
}) {
  if (diff.identical) {
    return <p className="text-sm text-foreground-muted">{labels.unchanged}</p>;
  }
  return (
    <>
      <p
        lang={lang}
        dir="auto"
        className="text-sm leading-relaxed break-words whitespace-pre-wrap"
      >
        {diff.segments.map((segment, index) =>
          segment.kind === 'same' ? (
            <span key={index}>{segment.text}</span>
          ) : segment.kind === 'added' ? (
            <ins
              key={index}
              className="rounded-sm bg-success-surface text-success no-underline"
            >
              <span className="sr-only">[{labels.added}] </span>
              {segment.text}
            </ins>
          ) : (
            <del key={index} className="rounded-sm bg-error-surface text-error">
              <span className="sr-only">[{labels.removed}] </span>
              {segment.text}
            </del>
          ),
        )}
      </p>
      {diff.truncated ? (
        <p className="text-xs text-foreground-muted">{labels.truncated}</p>
      ) : null}
    </>
  );
}

export function RevisionDiff({
  before,
  after,
  labels,
  languageName,
}: {
  readonly before: readonly Translation[];
  readonly after: readonly Translation[];
  readonly labels: RevisionDiffLabels;
  readonly languageName: (code: string) => string;
}) {
  const earlier = new Map(before.map((entry) => [entry.languageCode, entry]));
  const later = new Set(after.map((entry) => entry.languageCode));
  return (
    <section className="flex flex-col gap-3 rounded-control border border-border bg-surface p-3">
      <h3 className="text-sm font-semibold">{labels.heading}</h3>
      {after.map((translation) => {
        const previous = earlier.get(translation.languageCode);
        if (previous === undefined) {
          return (
            <p key={translation.languageCode} className="text-sm">
              {labels.languageAdded(languageName(translation.languageCode))}
            </p>
          );
        }
        return (
          <div key={translation.languageCode} className="flex flex-col gap-2">
            {after.length > 1 ? (
              <p className="text-xs font-semibold text-foreground-muted">
                {languageName(translation.languageCode)}
              </p>
            ) : null}
            <p className="text-xs text-foreground-muted">{labels.title}</p>
            <Diff
              diff={wordDiff(previous.title, translation.title)}
              labels={labels}
              lang={translation.languageCode}
            />
            <p className="text-xs text-foreground-muted">{labels.body}</p>
            <Diff
              diff={wordDiff(htmlToText(previous.html), htmlToText(translation.html))}
              labels={labels}
              lang={translation.languageCode}
            />
          </div>
        );
      })}
      {before
        .filter((entry) => !later.has(entry.languageCode))
        .map((entry) => (
          <p key={entry.languageCode} className="text-sm">
            {labels.languageRemoved(languageName(entry.languageCode))}
          </p>
        ))}
    </section>
  );
}
