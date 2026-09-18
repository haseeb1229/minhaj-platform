/**
 * Typed declarations for the environment variables this phase uses.
 *
 * Two constraints meet here:
 *
 *   1. `noPropertyAccessFromIndexSignature` (strict baseline) rejects
 *      `process.env.FOO` when `FOO` is only known through an index signature.
 * Declaring the names explicitly satisfies the type rule. It also means an
 * undeclared variable is a type error, which is a small bonus: configuration
 * must be declared to be used.
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

    /** Set by Next.js to the runtime executing the current code. */
    readonly NEXT_RUNTIME?: 'nodejs' | 'edge';

    /** Validated and substituted by next.config.ts when the artifact is built. */
    readonly MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED?: 'true' | 'false';
  }
}
