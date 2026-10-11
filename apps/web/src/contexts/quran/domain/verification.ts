import {
  QURAN_LIMITS,
  type CandidateAyah,
  type VerificationMismatch,
  type VerificationMismatchReason,
  type VerificationReport,
} from '@minhaj/contracts/quran';

/**
 * Exact verification of religious text — pure, and the strictest code in the
 * platform (DOMAIN_MODEL.md §8.2, §19.8; Phase 18 §14).
 *
 * EQUAL MEANS THE SAME CODE POINTS, IN THE SAME ORDER, AND NOTHING ELSE.
 * Nothing here normalises: no NFC or NFKC, no trimming, no case folding, no
 * substitution of one letter for a lookalike, no removal of a diacritic or of
 * an invisible character. Two strings a reader would call "the same" — a
 * precomposed letter beside its decomposed sequence, an Arabic yeh beside a
 * Farsi one, a text with and without a byte-order mark — are DIFFERENT here,
 * because each normalisation is an editorial decision about scripture and the
 * verifier's job is to refuse to make one.
 *
 * A REPORT NEVER CARRIES TEXT. It names references, categories and code-point
 * offsets, so it can be logged, stored as evidence and shown to an operator
 * without becoming a second, unverified copy of what it describes.
 */

/**
 * The index, in CODE POINTS, of the first position at which `a` and `b`
 * differ — or `null` when they are identical.
 *
 * Counted in code points rather than UTF-16 units, so the offset an operator is
 * shown means the same thing whichever environment counts it: a character
 * outside the Basic Multilingual Plane is one position, not two. When one text
 * is a prefix of the other, the difference is where the shorter one ends.
 */
export function compareExact(a: string, b: string): number | null {
  if (a === b) return null;

  let index = 0;
  let i = 0;
  let j = 0;
  for (;;) {
    const left = a.codePointAt(i);
    const right = b.codePointAt(j);
    if (left === undefined || right === undefined || left !== right) return index;
    i += left > 0xffff ? 2 : 1;
    j += right > 0xffff ? 2 : 1;
    index += 1;
  }
}

/** Why a candidate's bytes could not become text. */
export type DecodeRefusal = 'malformed-encoding' | 'unsupported-encoding';

export type DecodeResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: DecodeRefusal };

/**
 * Bytes to text in the source's declared encoding — or a refusal, never a
 * repair.
 *
 * ONE ENCODING. A registered source declares `utf-8`; anything else is refused
 * as `unsupported-encoding` rather than guessed at.
 *
 * FATAL ON MALFORMED INPUT. A replacement character silently standing in for
 * bytes that did not decode would make the candidate a different text that
 * still "decoded", so an invalid sequence is `malformed-encoding`.
 *
 * THE BYTE-ORDER MARK IS KEPT. Stripping it would be a normalisation; a
 * candidate that carries one differs from a source that does not, at offset 0,
 * and is reported as exactly that.
 */
export function decodeExact(bytes: Uint8Array, encoding: string): DecodeResult {
  if (encoding !== 'utf-8') return { ok: false, reason: 'unsupported-encoding' };
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    return { ok: true, text: decoder.decode(bytes) };
  } catch {
    return { ok: false, reason: 'malformed-encoding' };
  }
}

/** The order reasons are listed in for one reference — fixed, so reports repeat. */
const REASON_ORDER: Readonly<Record<VerificationMismatchReason, number>> = {
  'malformed-encoding': 0,
  'unsupported-encoding': 1,
  'unknown-reference': 2,
  'duplicate-reference': 3,
  'missing-reference': 4,
  'juz-mismatch': 5,
  'text-mismatch': 6,
};

function byPosition(a: VerificationMismatch, b: VerificationMismatch): number {
  return (
    (a.ref?.surah ?? 0) - (b.ref?.surah ?? 0) ||
    (a.ref?.ayah ?? 0) - (b.ref?.ayah ?? 0) ||
    REASON_ORDER[a.reason] - REASON_ORDER[b.reason]
  );
}

const keyOf = (surah: number, ayah: number) => `${surah}:${ayah}`;

/** A report from a finished list of mismatches — bounded, ordered, content-free. */
export function reportOf(
  checked: number,
  mismatches: readonly VerificationMismatch[],
): VerificationReport {
  const ordered = [...mismatches].sort(byPosition);
  return {
    passed: ordered.length === 0,
    checked,
    mismatchCount: ordered.length,
    mismatches: ordered.slice(0, QURAN_LIMITS.reportedMismatches),
  };
}

/**
 * Verifies a candidate corpus against a source's own Ayat.
 *
 * EVERY DIFFERENCE IS FOUND, AND COUNTED; the first
 * `QURAN_LIMITS.reportedMismatches` in canonical order are named. Order is
 * canonical — Surah, then Ayah, then a fixed order of reasons — never the
 * order the candidate happened to arrive in, so the same candidate always
 * yields the same report.
 *
 *   - `unknown-reference` — the candidate names an Ayah the source lacks;
 *   - `duplicate-reference` — each further time it names one it already named;
 *   - `missing-reference` — the source has an Ayah the candidate never names;
 *   - `juz-mismatch` — the candidate assigns a different Juz;
 *   - `text-mismatch` — the texts differ, at the first differing code point.
 *
 * A Juz and a text are independent facts, so an Ayah wrong in both is reported
 * twice. `checked` is how many candidate entries were examined.
 */
export function verifyCorpus(
  reference: readonly CandidateAyah[],
  candidate: readonly CandidateAyah[],
): VerificationReport {
  const source = new Map<string, CandidateAyah>();
  for (const ayah of reference) source.set(keyOf(ayah.surah, ayah.ayah), ayah);

  const mismatches: VerificationMismatch[] = [];
  const seen = new Set<string>();

  for (const entry of candidate) {
    const key = keyOf(entry.surah, entry.ayah);
    const ref = { surah: entry.surah, ayah: entry.ayah };

    if (seen.has(key)) {
      mismatches.push({ reason: 'duplicate-reference', ref, offset: null });
      continue;
    }
    seen.add(key);

    const expected = source.get(key);
    if (expected === undefined) {
      mismatches.push({ reason: 'unknown-reference', ref, offset: null });
      continue;
    }
    if (expected.juz !== entry.juz)
      mismatches.push({ reason: 'juz-mismatch', ref, offset: null });

    const offset = compareExact(entry.text, expected.text);
    if (offset !== null) mismatches.push({ reason: 'text-mismatch', ref, offset });
  }

  for (const [key, ayah] of source) {
    if (!seen.has(key))
      mismatches.push({
        reason: 'missing-reference',
        ref: { surah: ayah.surah, ayah: ayah.ayah },
        offset: null,
      });
  }

  return reportOf(candidate.length, mismatches);
}
