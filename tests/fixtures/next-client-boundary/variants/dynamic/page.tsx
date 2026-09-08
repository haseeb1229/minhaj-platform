'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// A Client Component reaching server-core through a dynamic import.
export default function DynamicPage() {
  async function load() {
    const mod = await import('@minhaj/server-core');
    return mod.createLogger({ level: 'info', nodeEnv: 'development' });
  }
  return <button onClick={() => void load()}>dynamic</button>;
}
