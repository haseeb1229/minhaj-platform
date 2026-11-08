import { SURAH_AYAH_COUNTS } from '../../packages/contracts/src/migration/payloads.ts';

/**
 * A SYNTHETIC pair of files SHAPED like the Tanzil Uthmani 1.1 text and the
 * Tanzil metadata 1.0 — for the reader's tests and the import proof.
 *
 * NOTHING HERE IS THE QURAN. Every Surah name is `NON_QURAN_FIXTURE_SURAH_<n>`
 * and every Ayah is `NON_QURAN_FIXTURE_<surah>_<ayah>` followed by the neutral
 * phrase "non-Quranic test text". The shape is the edition's — 114 Surahs and
 * their ayah counts (the structural table the migration context already
 * holds), 6,236 ayat, 30 Juz, 240 quarters, 604 pages and 15 prostrations — so
 * the reader's structural checks run in full; the BOUNDARIES are evenly spaced
 * engineering positions, not Tanzil's, and the marks are placed where this
 * fixture's own boundaries fall.
 */

const NEUTRAL = 'نص اختبار غير قرآني';
const RUB_EL_HIZB = '۞';
const SAJDAH_MARK = '۩';

export interface TanzilFixture {
  readonly text: string;
  readonly metadata: string;
}

interface Position {
  readonly surah: number;
  readonly ayah: number;
}

export function tanzilFixture(): TanzilFixture {
  const ayat: Position[] = [];
  SURAH_AYAH_COUNTS.forEach((count, index) => {
    for (let ayah = 1; ayah <= count; ayah += 1) ayat.push({ surah: index + 1, ayah });
  });
  const total = ayat.length;
  const at = (index: number): Position => ayat[index] ?? { surah: 0, ayah: 0 };
  const spread = (count: number) =>
    Array.from({ length: count }, (_, i) => at(Math.floor((i * total) / count)));

  const quarters = spread(240);
  const juz = quarters.filter((_, i) => i % 8 === 0);
  const pages = spread(604);
  const sajdahs = Array.from({ length: 15 }, (_, i) => ({
    ...at(97 + i * 401),
    type: i % 4 === 3 ? 'obligatory' : 'recommended',
  }));

  const key = (p: Position) => `${p.surah}:${p.ayah}`;
  const quarterStarts = new Set(quarters.filter((p) => p.ayah !== 1).map(key));
  const prostrations = new Set(sajdahs.map(key));

  const text: string[] = [
    '<?xml version="1.0" encoding="utf-8" ?>',
    '<!--',
    '',
    '# SYNTHETIC FIXTURE shaped like Tanzil Quran Text (Uthmani, Version 1.1)',
    '#  License: Creative Commons Attribution 3.0',
    '#  NON_QURAN_FIXTURE: engineering test data only.',
    '',
    '-->',
    '<quran>',
  ];
  SURAH_AYAH_COUNTS.forEach((count, index) => {
    const surah = index + 1;
    text.push(`\t<sura index="${surah}" name="NON_QURAN_FIXTURE_SURAH_${surah}">`);
    for (let ayah = 1; ayah <= count; ayah += 1) {
      const p = { surah, ayah };
      const body =
        `${quarterStarts.has(key(p)) ? `${RUB_EL_HIZB} ` : ''}` +
        `NON_QURAN_FIXTURE_${surah}_${ayah} ${NEUTRAL}` +
        `${prostrations.has(key(p)) ? ` ${SAJDAH_MARK}` : ''}`;
      const bismillah =
        ayah === 1 && surah !== 1 && surah !== 9 ? ` bismillah="${NEUTRAL}"` : '';
      text.push(`\t\t<aya index="${ayah}" text="${body}"${bismillah} />`);
    }
    text.push('\t</sura>');
  });
  text.push('</quran>', '');

  let start = 0;
  const metadata: string[] = [
    '<?xml version="1.0" encoding="utf-8" ?>',
    '<quran type="metadata" version="1.0" copyright="NON_QURAN_FIXTURE" license="cc-by">',
    '\t<suras alias="chapters">',
  ];
  SURAH_AYAH_COUNTS.forEach((count, index) => {
    const surah = index + 1;
    metadata.push(
      `\t\t<sura index="${surah}" ayas="${count}" start="${start}" name="NON_QURAN_FIXTURE_SURAH_${surah}" tname="Fixture" ename="Fixture" type="${surah % 3 === 0 ? 'Medinan' : 'Meccan'}" order="${surah}" rukus="1" />`,
    );
    start += count;
  });
  const boundaries = (tag: string, alias: string, element: string, list: Position[]) => [
    `\t<${tag}${alias === '' ? '' : ` alias="${alias}"`}>`,
    ...list.map(
      (p, i) => `\t\t<${element} index="${i + 1}" sura="${p.surah}" aya="${p.ayah}" />`,
    ),
    `\t</${tag}>`,
  ];
  metadata.push(
    '\t</suras>',
    ...boundaries('juzs', 'parts', 'juz', juz),
    ...boundaries('hizbs', 'groups', 'quarter', quarters),
    ...boundaries('pages', '', 'page', pages),
    '\t<sajdas>',
    ...sajdahs.map(
      (p, i) =>
        `\t\t<sajda index="${i + 1}" sura="${p.surah}" aya="${p.ayah}" type="${p.type}" />`,
    ),
    '\t</sajdas>',
    '</quran>',
    '',
  );

  return { text: text.join('\n'), metadata: metadata.join('\n') };
}

export const utf8 = (value: string) => new TextEncoder().encode(value);
