/**
 * Typed declarations for the environment variables this phase uses.
 *
 * Two constraints meet here:
 *
 *   1. `noPropertyAccessFromIndexSignature` (strict baseline) rejects
 *      `process.env.FOO` when `FOO` is only known through an index signature.
 *   2. Next.js inlines `NEXT_PUBLIC_` variables by TEXTUAL substitution of the
 *      DOT form at build time. Bracket access is not substituted, so a client
 *      bundle would read `undefined` — the validation would then be checking
 *      nothing at all.
 *
 * Declaring the names explicitly satisfies the type rule while keeping the dot
 * access Next requires. It also means an undeclared variable is a type error,
 * which is a small bonus: configuration must be declared to be used.
 *
 * Only Phase 0B variables appear here. Database, auth, OAuth, email, storage
 * and payment configuration belong to the phases that introduce them.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    // --- Server, private -----------------------------------------------
    readonly NODE_ENV: 'development' | 'test' | 'production';
    readonly PORT?: string;
    readonly LOG_LEVEL?: string;
    readonly DEFAULT_LOCALE?: string;

    /** Set by Next.js to the runtime executing the current code. */
    readonly NEXT_RUNTIME?: 'nodejs' | 'edge';

    // --- Client, PUBLIC — inlined into the browser bundle ----------------
    readonly NEXT_PUBLIC_SITE_URL?: string;
    readonly NEXT_PUBLIC_DEFAULT_LOCALE?: string;
  }
}
