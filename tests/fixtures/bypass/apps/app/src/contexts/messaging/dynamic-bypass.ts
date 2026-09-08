// FIXTURE — MUST FAIL. Review bypass: dynamic import().
export async function load() {
  const mod = await import('@/contexts/quran');
  return mod;
}
