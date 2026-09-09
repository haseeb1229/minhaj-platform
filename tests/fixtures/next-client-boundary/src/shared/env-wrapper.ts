// A neutral wrapper re-exporting the guarded server environment entry point.
// Laundering the import through an intermediate module must not launder the
// boundary — the `server-only` marker inside `env/server.ts` still fires.
export { parseServerEnv } from '@minhaj/contracts/env/server';
