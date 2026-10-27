import type { FetchOutcome, MigrationFetchPort } from '@minhaj/contracts/migration';

/**
 * `robots.txt` FOR AN AUTHORISED SOURCE (MIGRATION_STRATEGY.md §4.1).
 *
 * Discovery respects the source's own crawling rules even where a written
 * authorisation exists: the rules of the group that names our product token
 * (`OneMinhajMigration`) apply, else those of `*`. Within a group the LONGEST
 * matching rule wins, `Allow` beating `Disallow` on a tie (RFC 9309 §2.2.2),
 * with `*` and `$` patterns. A missing file (4xx) allows everything; any
 * other failure to read it — a 5xx, a refusal, a network error — DISALLOWS
 * everything, because unknown is not permission (RFC 9309 §2.3.1.4).
 */

export const ROBOTS_PRODUCT_TOKEN = 'oneminhajmigration';

interface Rule {
  readonly allow: boolean;
  readonly pattern: string;
}

export interface RobotsPolicy {
  /** May this URL's path (and query) be fetched? */
  allows(url: string): boolean;
}

const ALLOW_ALL: RobotsPolicy = { allows: () => true };
const DISALLOW_ALL: RobotsPolicy = { allows: () => false };

/**
 * A rule or path in the one form they are compared in (RFC 9309 §2.2.2):
 * every non-ASCII character percent-encoded as UTF-8, every `%xx` upper-case.
 * `URL.pathname` is already encoded, so an Urdu or Arabic rule written raw in
 * robots.txt matches the encoded path it names.
 */
export function robotsEncoded(text: string): string {
  let out = '';
  for (const char of text)
    out += char.charCodeAt(0) > 0x7e ? encodeURIComponent(char) : char;
  return out.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
}

/** The product token a User-agent line names: its leading token, lower-cased. */
function agentToken(value: string): string | null {
  const token = /^[a-z_-]+/i.exec(value.trim())?.[0];
  return token === undefined ? null : token.toLowerCase();
}

function matcher(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Parses robots.txt text into the rules that apply to this tool. */
export function parseRobots(text: string): RobotsPolicy {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (current === null || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current === null) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow allows everything; an empty Allow says nothing.
      if (value.length === 0) continue;
      current.rules.push({ allow: field === 'allow', pattern: value });
    }
  }
  // Our group is one naming EXACTLY our product token — never a prefix of it,
  // and never an empty line, which would let a stray group override `*`.
  const ours = groups.filter((group) =>
    group.agents.some((agent) => agentToken(agent) === ROBOTS_PRODUCT_TOKEN),
  );
  const chosen =
    ours.length > 0 ? ours : groups.filter((group) => group.agents.includes('*'));
  const rules = chosen.flatMap((group) => group.rules);
  if (rules.length === 0) return ALLOW_ALL;
  const compiled = rules.map((rule) => {
    const pattern = robotsEncoded(rule.pattern);
    return { allow: rule.allow, pattern, regex: matcher(pattern) };
  });
  return {
    allows(url) {
      let path: string;
      try {
        const parsed = new URL(url);
        path = robotsEncoded(`${parsed.pathname}${parsed.search}`);
      } catch {
        return false;
      }
      let best: { allow: boolean; length: number } | null = null;
      for (const rule of compiled) {
        if (!rule.regex.test(path)) continue;
        const length = rule.pattern.length;
        if (
          best === null ||
          length > best.length ||
          (length === best.length && rule.allow)
        )
          best = { allow: rule.allow, length };
      }
      return best === null || best.allow;
    },
  };
}

/**
 * Reads one host's robots.txt through the source's own safe fetcher. A
 * missing file allows everything; any other failure disallows everything.
 */
export async function readRobots(
  fetcher: MigrationFetchPort,
  origin: string,
): Promise<{ readonly policy: RobotsPolicy; readonly outcome: FetchOutcome }> {
  const outcome = await fetcher.fetch(new URL('/robots.txt', origin).toString());
  if (outcome.kind !== 'response') return { policy: DISALLOW_ALL, outcome };
  if (outcome.status >= 400 && outcome.status < 500)
    return { policy: ALLOW_ALL, outcome };
  if (outcome.status !== 200) return { policy: DISALLOW_ALL, outcome };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(outcome.body);
  } catch {
    return { policy: DISALLOW_ALL, outcome };
  }
  return { policy: parseRobots(text), outcome };
}
