import { z } from 'zod';

import { mediaIdSchema, type MediaReferencePort } from '@minhaj/contracts/media';

/**
 * Media's REFERENCE interface — what another context's composition may ask
 * about a Gallery identity: Editorial choosing which Galleries photograph an
 * Event (Phase 14, Editorial → Media). Identity, words and lifecycle state
 * only; no Photo, no asset, no membership, no write. The caller has already
 * checked its own permission, and Media imports nothing of the caller's.
 */
export function createGalleryReferences(port: MediaReferencePort) {
  return {
    galleryChoices(text: string | null) {
      const query = z.string().trim().min(1).max(120).safeParse(text);
      return port.galleryChoices(query.success ? query.data : null);
    },
    galleriesByIds(ids: readonly string[]) {
      return port.galleriesByIds(z.array(mediaIdSchema).max(50).parse(ids));
    },
    async gallerySelectable(id: string) {
      return mediaIdSchema.safeParse(id).success ? port.gallerySelectable(id) : false;
    },
  };
}

export type GalleryReferences = ReturnType<typeof createGalleryReferences>;
