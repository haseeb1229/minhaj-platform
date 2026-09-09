'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// A REAL tsconfig path alias (`~server/*`) into protected server-only source.
//
// Review #3 (N3) found the variant of this name using a relative `../../../`
// climb, which duplicated the `relative-source` case and left the alias route
// untested. This import resolves ONLY through the `paths` mapping declared in
// this fixture's tsconfig, so the build must reach the protected module by
// alias and reject it for the server-only boundary.
import { sanitiseForLog } from '~server/logging/redaction';

export default function AliasSourcePage() {
  return <button onClick={() => sanitiseForLog({})}>alias source</button>;
}
