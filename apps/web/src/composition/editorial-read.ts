import 'server-only';
import { createEditorialPublicReader } from '@minhaj/database';
import { taxonomyRuntime } from './taxonomy';
import { createEditorialReadService } from '@/contexts/editorial';

let runtime: ReturnType<typeof createEditorialReadService> | null = null;
export function editorialReadRuntime() {
  return (runtime ??= createEditorialReadService(createEditorialPublicReader()));
}

import type { Locale } from '@minhaj/contracts';
import type { PublicEditorial } from '@minhaj/contracts/editorial';
import { peopleReadRuntime } from './people-read';
export async function editorialPublicReferences(record: PublicEditorial, locale: Locale) {
  const [people, topics] = await Promise.all([
    peopleReadRuntime().people.contributorReferences(
      [...new Set(record.contributors.map((row) => row.personId))],
      locale,
    ),
    taxonomyRuntime().taxonomy.topicReferences(record.topicIds, locale),
  ]);
  return { people, topics };
}
