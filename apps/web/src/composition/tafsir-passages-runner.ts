import 'server-only';

import {
  createAuthorizationReader,
  createLibraryPersistence,
  createMediaPersistence,
  createQuranPersistence,
} from '@minhaj/database';
import type { QuranPassage, TimedQuranPassage } from '@minhaj/contracts/passage';
import type { QuranAuthorityPort } from '@minhaj/contracts/quran';
import { createAuthorizationService } from '@minhaj/server-core/authorization';

import { createLibraryService } from '../contexts/library/index.ts';
import { createMediaService } from '../contexts/media/index.ts';
import { createQuranService } from '../contexts/quran/index.ts';

/**
 * THE TAFSIR-PASSAGES OPERATOR TOOL'S COMPOSITION ROOT — Layer 4 (Quran Part
 * 8; `docker/staging/bin/tafsir-passages.sh`).
 *
 * The tool proposes, from their TITLES, the Quran passages Library Works and
 * Media Videos explain, and applies an operator-confirmed set. It runs under
 * plain Node in the exact-SHA operations image, as the RUNTIME principal, so
 * this wires the three owners' administrative services exactly as the web
 * process's roots do — the SAME services, the SAME live authority (every call
 * re-reads the operator's permissions) — without their Next-only imports:
 *
 *   - Quran's administrative service, for the Surahs' canonical names and
 *     counts (`quran.read`);
 *   - Library's and Media's administrative services, for their records
 *     (`library.read`, `media.read`) and the one passage act each owns,
 *     `applyTitleQuranPassages` (`library.administer`, `media.administer`),
 *     which never overwrites a record that already carries a passage.
 *
 * Nothing else is reachable: no Work or Video is saved, so the references
 * port answers no to everything (fail closed), and no picture is accepted.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

const REFUSE_REFERENCES = {
  validPeople: async () => false,
  validTopics: async () => false,
  validLanguage: async () => false,
};

export function composeTafsirPassagesRunner(operator: string) {
  const authorization = createAuthorizationService({
    reader: createAuthorizationReader(),
  });
  const permits = (accountId: string, permission: string) =>
    authorization.hasPermission(accountId, permission);
  const quranAuthority: QuranAuthorityPort = {
    permits,
    // The tool performs no canonical act.
    verifyCanonical: async () => false,
  };
  const quran = createQuranService({
    persistence: createQuranPersistence(),
    authority: quranAuthority,
  });
  const library = createLibraryService({
    persistence: createLibraryPersistence(),
    authority: { permits },
    references: REFUSE_REFERENCES,
  });
  const media = createMediaService({
    persistence: createMediaPersistence(),
    authority: { permits },
    references: REFUSE_REFERENCES,
  });
  const actor = { accountId: operator };

  return {
    surahs: () => quran.surahs(actor),
    works: (offset: number) => library.works(actor, offset),
    work: (id: string) => library.work(actor, id),
    videos: (offset: number) => media.videos(actor, { offset }),
    video: (id: string) => media.video(actor, id),
    applyWork: (id: string, version: number, passages: readonly QuranPassage[]) =>
      library.applyTitleQuranPassages(actor, id, version, passages),
    applyVideo: (id: string, version: number, passages: readonly TimedQuranPassage[]) =>
      media.applyTitleQuranPassages(actor, id, version, passages),
  };
}

export type TafsirPassagesRunner = ReturnType<typeof composeTafsirPassagesRunner>;
