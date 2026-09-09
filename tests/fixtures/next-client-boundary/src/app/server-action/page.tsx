'use client';

// FIXTURE CONTROL — MUST BUILD.
//
// A Client Component calling a Server Action whose implementation reaches
// server-only code. This is the half of the Server Action rule that a Vitest
// assertion cannot prove: only the real Next bundler decides what reaches a
// browser, and this route asserts that it permits the pattern the architecture
// prescribes.
//
// It lives in `src/app/` rather than in `variants/`, so EVERY build in
// `npm run check:server-only` compiles it — the control that must always
// succeed, beside the twenty reaches that must always fail.
import { recordEvent } from '@/actions/record-event';

export default function ServerActionControlPage() {
  return (
    <main>
      <button type="button" onClick={() => void recordEvent('clicked')}>
        send
      </button>
    </main>
  );
}
