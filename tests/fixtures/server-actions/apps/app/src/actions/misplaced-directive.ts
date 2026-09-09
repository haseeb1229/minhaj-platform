// FIXTURE — MUST FAIL. A directive-looking string AFTER the prologue has
// already ended. Prettier normalises the bare form to a parenthesised
// expression, which is itself the point: the tooling will not let a misplaced
// directive masquerade as one, and neither does the parser.
//
// The BARE misplaced form — `const x = 1;` followed by an unparenthesised
// `'use server';` — is asserted directly against the parser in
// `tests/architecture/server-actions.test.ts`, where no formatter can rewrite
// it. This file covers the same mistake end to end, through the client graph.
const preamble = 'not a directive prologue';
('use server');

import { createLogger } from '@minhaj/server-core';

export async function misplaced(): Promise<string> {
  return `${preamble}${typeof createLogger}`;
}
