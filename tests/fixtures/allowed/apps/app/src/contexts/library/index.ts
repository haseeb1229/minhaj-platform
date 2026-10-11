export function createLibraryReadService(_port: string): {
  workReferences(ids: readonly string[]): readonly string[];
} {
  return { workReferences: (_ids: readonly string[]) => [] };
}
