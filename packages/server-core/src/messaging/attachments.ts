import 'server-only';

import {
  MESSAGING_IMAGE_LIMITS,
  MESSAGING_LIMITS,
  type MessagingAttachmentType,
} from '@minhaj/contracts/messaging';
import type { AssetRejection, UploadPolicy } from '@minhaj/contracts/platform';

import type { MessagingRefusalReason } from './types.ts';

/**
 * What one attachment upload asks of Storage, and how its answer is told.
 *
 * MESSAGING NARROWS, STORAGE STILL DECIDES. The declared type only chooses
 * which of Storage's policies applies — still images go through the image
 * policy, which re-encodes nothing but strips hidden metadata and refuses a
 * decompression bomb; a PDF through the plain sniff. Storage sniffs the bytes
 * against that list, so a declared `image/png` that is really a PDF is
 * refused there, never accepted here.
 */

/** Displayed filename column width (MessageAttachment.displayName NVARCHAR(200)). */
const DISPLAY_NAME_UNITS = 200;

/**
 * Characters a displayed filename may not carry: C0 and C1 controls, DEL, the
 * bidirectional marks, overrides and isolates that let `cod.exe` render as
 * `exe.doc`, and path separators. A code-point test rather than a regular
 * expression class of control characters, which is unreadable in review.
 */
function unsafeInName(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    character === '/' ||
    character === '\\'
  );
}

/**
 * The client's filename, made safe to keep in Messaging's own row: display
 * metadata and nothing else — never a path, key or header. Bounded to the
 * column in UTF-16 units without splitting a surrogate pair.
 */
export function cleanDisplayName(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  let bounded = '';
  for (const character of value.normalize('NFC').trim()) {
    if (unsafeInName(character)) continue;
    if (bounded.length + character.length > DISPLAY_NAME_UNITS) break;
    bounded += character;
  }
  bounded = bounded.trim();
  return bounded === '' ? null : bounded;
}

export function uploadPolicy(input: {
  readonly declared: MessagingAttachmentType;
  readonly displayName: string | null;
  readonly releaseToken: string;
}): UploadPolicy {
  const common = {
    maxBytes: MESSAGING_LIMITS.attachmentMaxBytes,
    declaredMediaType: input.declared,
    displayName: input.displayName,
    releaseToken: input.releaseToken,
  };
  return input.declared === 'application/pdf'
    ? { ...common, allowedMediaTypes: ['application/pdf'] }
    : {
        ...common,
        allowedMediaTypes: ['image/jpeg', 'image/png'],
        image: MESSAGING_IMAGE_LIMITS,
      };
}

/** A refused upload, in the words the person can act on. */
export function rejectionRefusal(
  rejection: AssetRejection | null,
): MessagingRefusalReason {
  switch (rejection) {
    case 'too-large':
    case 'dimensions-too-large':
      return 'too-large';
    case 'infected':
    case 'unscannable':
      return 'not-cleared';
    default:
      return 'unsupported';
  }
}
