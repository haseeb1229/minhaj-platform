import { defaultLocale } from '@/config/locale';

/**
 * Foundation page — a Server Component shipping no client JavaScript.
 *
 * Its only job is to prove the application builds, renders and starts. This is
 * NOT the homepage: no hero, no marketing sections, no navigation hierarchy, no
 * visual identity. Those belong to the design phase (OPEN_DECISIONS.md §6.4).
 *
 * Statically renderable. The values shown are build-time constants, so the
 * anonymous public tree keeps the caching capability ARCHITECTURE.md §8
 * requires. Server configuration is validated before the process listens, not
 * read during rendering.
 *
 * Every utility used here is logical-direction (`ms-*`, `ps-*`, `text-start`),
 * establishing the RTL convention from the first page (TECH_STACK.md §5).
 */
export default function FoundationPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16 text-start">
      <h1 className="text-2xl font-semibold">One Minhaj</h1>

      <p>
        Repository and tooling foundation. The platform architecture is recorded in{' '}
        <code>/docs</code>; no domain functionality is implemented yet.
      </p>

      <dl className="flex flex-col gap-2 border-s-2 ps-4">
        <div className="flex gap-2">
          <dt className="font-medium">Phase</dt>
          <dd>0B — Repository &amp; Tooling Foundation</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Rendering</dt>
          <dd>React Server Components by default</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Direction</dt>
          <dd>Logical properties throughout; RTL-ready</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Default locale</dt>
          <dd>{defaultLocale}</dd>
        </div>
      </dl>
    </main>
  );
}
