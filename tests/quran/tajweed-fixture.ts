/**
 * Quran Part 9 — a miniature of the two quran-tajweed files, in their exact
 * SHAPES: the annotation file's `{annotations: [{end, rule, start}], ayah,
 * surah}` entries with the source's own rule names, and the 2017 base text's
 * `surah|ayah|text` lines ended by CR LF and followed by the Tanzil notice.
 *
 * NOTHING HERE IS THE QURAN. Every text is a short sentinel phrase of ordinary
 * Arabic words ("a word, an example and a text"); what is real is how the two
 * printings of a text differ, one Ayah per shape the real files show:
 *
 *   1:1  the same text in both — offsets kept;
 *   1:2  the same text, no span — kept, colouring nothing;
 *   1:3  a tatweel inserted inside a span — skipped whole;
 *   2:1  an opening phrase at the head of the 2017 text only — re-mapped;
 *   2:2  a pause mark written as its own word between spans that overlap —
 *        re-mapped;
 *   2:3  a pause mark added after the text, no span — re-mapped.
 */

/** The 2017-shaped text of each Ayah. */
const BASE: readonly (readonly [number, number, string])[] = [
  [1, 1, 'كَلِمَةٌ مَٰثَالٌ وَنَصٌّ'],
  [1, 2, 'نَصٌّ آخَرُ'],
  [1, 3, 'كَلِمَةٌ مَٰثَالٌ وَنَصٌّ'],
  [2, 1, 'بِسْمِ مِثَالٍ مِثَالٌ ثَانٍ'],
  [2, 2, 'وَنَصٌّ كَلِمَةٌ'],
  [2, 3, 'نَصٌّ'],
];

/** The canonical (1.1-shaped) text of the same ayat. */
export const CANONICAL: readonly { surah: number; ayah: number; text: string }[] = [
  { surah: 1, ayah: 1, text: 'كَلِمَةٌ مَٰثَالٌ وَنَصٌّ' },
  { surah: 1, ayah: 2, text: 'نَصٌّ آخَرُ' },
  { surah: 1, ayah: 3, text: 'كَلِمَةٌ مَـٰثَالٌ وَنَصٌّ' },
  { surah: 2, ayah: 1, text: 'مِثَالٌ ثَانٍ' },
  { surah: 2, ayah: 2, text: 'وَنَصٌّ ۛ كَلِمَةٌ' },
  { surah: 2, ayah: 3, text: 'نَصٌّ ۚ' },
];

/** The base text file, byte for byte as the source writes its shape. */
export const BASE_TEXT_FILE =
  BASE.map(([surah, ayah, text]) => `${String(surah)}|${String(ayah)}|${text}\r\n`).join(
    '',
  ) +
  '\r\n\r\n# PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK\r\n#  NON_QURAN_FIXTURE notice\r\n#=====\r\n';

/** The annotation file's entries, with the source's rule names. */
export function annotationFile(): unknown {
  const at = (rule: string, start: number, end: number) => ({ end, rule, start });
  return [
    { annotations: [at('madd_2', 11, 12), at('ghunnah', 20, 23)], ayah: 1, surah: 1 },
    { annotations: [], ayah: 2, surah: 1 },
    { annotations: [at('madd_2', 9, 12)], ayah: 3, surah: 1 },
    { annotations: [at('madd_2', 18, 20), at('qalqalah', 21, 22)], ayah: 1, surah: 2 },
    { annotations: [at('ghunnah', 9, 13), at('ikhfa', 11, 15)], ayah: 2, surah: 2 },
    { annotations: [], ayah: 3, surah: 2 },
  ];
}
