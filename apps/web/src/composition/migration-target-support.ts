import 'server-only';

import type {
  PublishableAsset,
  StagedImage,
  TargetPublication,
  TargetWithdrawal,
} from '@minhaj/contracts/migration';

/**
 * What every per-kind migration publication target shares — Layer 4
 * (Phase 30; MIGRATION_STRATEGY.md §4.12, §7).
 *
 * ONE VOCABULARY FOR ANSWERS. A domain's REFUSAL is final and is reported as
 * one, as a short code the manifest entry may store; only a THROWN failure the
 * domain itself classifies as an outage is `unavailable`. Each target passes
 * its own domain's classifier, so what counts as a refusal is always the
 * owning domain's word, never this module's guess.
 *
 * NODE-RUNNABLE: shared by the web process and the migration CLIs, so it names
 * packages and explicit `.ts` paths only — never the `@/` alias.
 */

/** Pages of a domain's administrative listing searched when adopting. */
export const ADOPTION_PAGES = 20;

/** Longest refusal code a manifest entry stores. */
const CODE_LENGTH = 32;

/** A domain refusal as a short code. */
export function refusal(reason: string): TargetPublication {
  return { status: 'refused', reason: reason.slice(0, CODE_LENGTH) };
}

/** A domain refusal of a withdrawal as a short code. */
export function withdrawalRefusal(reason: string): TargetWithdrawal {
  return { status: 'refused', reason: reason.slice(0, CODE_LENGTH) };
}

/** Thrown to abandon a call when the domain reports an outage. */
export class Unavailable extends Error {}

export type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * An asker over one domain's failure classifier: the value, a refusal code, or
 * `Unavailable` thrown for an outage.
 */
export function askerOf(classify: (error: unknown) => string) {
  return async function ask<T>(work: () => Promise<T>): Promise<Answer<T>> {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      const reason = classify(error);
      if (reason === 'unavailable') throw new Unavailable();
      return { ok: false, reason };
    }
  };
}

/** Runs a publication, turning an abandoned call into `unavailable`. */
export async function publishing(
  work: () => Promise<TargetPublication>,
): Promise<TargetPublication> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Unavailable) return { status: 'unavailable' };
    throw error;
  }
}

/** Runs a withdrawal, turning an abandoned call into `unavailable`. */
export async function withdrawing(
  work: () => Promise<TargetWithdrawal>,
): Promise<TargetWithdrawal> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Unavailable) return { status: 'unavailable' };
    throw error;
  }
}

/**
 * Localised labels compared as a set, by locale, with the surrounding
 * whitespace the owning domain's schemas trim ignored — the test of whether a
 * record found while adopting carries exactly the payload's words.
 */
export function sameLabels(
  held: readonly {
    readonly locale: string;
    readonly title: string;
    readonly text: string;
  }[],
  staged: readonly {
    readonly locale: string;
    readonly title: string;
    readonly text: string;
  }[],
): boolean {
  if (held.length !== staged.length) return false;
  return staged.every((label) =>
    held.some(
      (entry) =>
        entry.locale === label.locale &&
        entry.title === label.title.trim() &&
        entry.text === label.text.trim(),
    ),
  );
}

/**
 * Phase 30-R. A staged image as a domain may record it: the PUBLIC copy of the
 * rights-cleared acquisition of EXACTLY the image's canonical URL — never the
 * evidence bytes, never another acquisition, never a remote URL. An image with
 * no such acquisition (not acquired, refused, or not decided public-eligible
 * by a person) is no image: the record is published without it.
 *
 * Phase 30-RF. `admits` is the receiving domain's own picture types: an image
 * of any other type — a WebP offered to a domain that shows JPEG and PNG only —
 * is no image either, rather than a picture that domain would refuse to serve.
 */
export const STILL_JPEG_PNG: readonly string[] = Object.freeze([
  'image/jpeg',
  'image/png',
]);

export function clearedImage(
  image: StagedImage | null,
  assets: readonly PublishableAsset[],
  admits: readonly string[],
): {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly credit: string | null;
} | null {
  if (image === null) return null;
  const cleared = assets.find(
    (asset) =>
      asset.originalUrl === image.url &&
      asset.publicCopy !== null &&
      admits.includes(asset.mediaType),
  );
  if (cleared === undefined || cleared.publicCopy === null) return null;
  return {
    assetId: cleared.publicCopy.assetId,
    width: cleared.publicCopy.width,
    height: cleared.publicCopy.height,
    alt: image.alt,
    credit: image.credit,
  };
}
