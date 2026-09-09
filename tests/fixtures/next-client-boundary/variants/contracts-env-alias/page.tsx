'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// The server environment IMPLEMENTATION reached through a tsconfig alias.
//
// This module has no package specifier at all — it is absent from the contracts
// `exports` map — so an alias into its source path is the remaining route a
// determined Client Component could take. It carries the `server-only`
// marker like its public entry point does, so the marker fires however the
// module is reached — an `exports` map cannot help here, because a source path
// never consults one.
import { parseServerEnv } from '~contracts/env/server-schema';

export default function ContractsEnvAliasPage() {
  return <button onClick={() => parseServerEnv({})}>env alias</button>;
}
