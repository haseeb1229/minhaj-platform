import { describe, expect, it } from 'vitest';

import {
  referenceEvidence,
  irfanEvidence,
} from '../../packages/database/src/lifecycle/quran-reference.ts';
import {
  readTanzilCorpus,
  readTanzilSurahNames,
  sha256Hex,
  TanzilCorpusError,
} from '../../packages/database/src/lifecycle/tanzil-corpus.ts';
import {
  fixtureMeaning,
  fixtureTransliteration,
  tanzilFixture,
  utf8,
} from './tanzil-fixture.ts';

/**
 * Rebaseline R2 — the Tanzil reader the reference import trusts, over a
 * SYNTHETIC Tanzil-shaped pair of files (`./tanzil-fixture.ts`; nothing here
 * is the Quran).
 *
 * It must return the corpus exactly as written — every mark kept, nothing
 * normalised — with Juz, hizb, page and prostration taken from the metadata,
 * and REFUSE anything that is not the recorded file or on which the two files
 * disagree. A refusal names a position or a rule, never text.
 */

const base = tanzilFixture();

function read(text: string, metadata = base.metadata, expected?: string) {
  const bytes = utf8(text);
  return readTanzilCorpus({
    text: bytes,
    metadata: utf8(metadata),
    expectedSha256: expected ?? sha256Hex(bytes),
  });
}

function refused(work: () => unknown, rule: RegExp) {
  expect(work).toThrow(TanzilCorpusError);
  expect(work).toThrow(rule);
}

describe('the Tanzil reader', () => {
  it('reads the whole edition, exactly as written', () => {
    const corpus = read(base.text);
    expect(corpus.surahs).toHaveLength(114);
    expect(corpus.ayat).toHaveLength(6236);
    expect(new Set(corpus.ayat.map((a) => a.juz)).size).toBe(30);
    expect(new Set(corpus.ayat.map((a) => a.hizb)).size).toBe(60);
    expect(new Set(corpus.ayat.map((a) => a.page)).size).toBe(604);
    expect(corpus.ayat.filter((a) => a.sajdah !== null)).toHaveLength(15);
    expect(corpus.ayat.filter((a) => a.sajdah === 'obligatory').length).toBeGreaterThan(
      0,
    );
    // Verbatim: the marks the file carries stay in the text.
    const marked = corpus.ayat.filter((a) => a.text.startsWith('۞ '));
    expect(marked.length).toBeGreaterThan(100);
    expect(corpus.ayat[0]).toMatchObject({ surah: 1, ayah: 1, juz: 1, hizb: 1, page: 1 });
    expect(corpus.ayat.at(-1)).toMatchObject({
      surah: 114,
      juz: 30,
      hizb: 60,
      page: 604,
    });
    expect(corpus.surahs[2]).toMatchObject({ number: 3, revelation: 'medinan' });
    expect(corpus.textSha256).toBe(sha256Hex(utf8(base.text)));
    expect(corpus.notice).toContain('License: Creative Commons Attribution 3.0');
  });

  it('keeps the notice in the source evidence, within the column', () => {
    const corpus = read(base.text);
    const evidence = referenceEvidence(corpus);
    expect(evidence).toContain(corpus.textSha256);
    expect(evidence).toContain(corpus.metadataSha256);
    expect(evidence).toContain(corpus.notice);
    expect(evidence).toContain('not reviewed by Minhaj-ul-Quran');
    expect(evidence.length).toBeLessThanOrEqual(2000);
    for (const language of ['ur', 'en'] as const)
      expect(irfanEvidence(language).length).toBeLessThanOrEqual(2000);
  });

  it('refuses a file that is not the one recorded', () => {
    refused(() => read(base.text, base.metadata, '0'.repeat(64)), /SHA-256 differs/);
    refused(() => read(base.text, base.metadata, 'not-a-digest'), /not a SHA-256/);
  });

  it('refuses bytes that are not clean UTF-8', () => {
    refused(
      () => read(`${String.fromCharCode(0xfeff)}${base.text}`),
      /byte-order mark|XML declaration/,
    );
    const broken = new Uint8Array([...utf8(base.text.slice(0, 200)), 0xff, 0xfe]);
    refused(
      () =>
        readTanzilCorpus({
          text: broken,
          metadata: utf8(base.metadata),
          expectedSha256: sha256Hex(broken),
        }),
      /not valid UTF-8/,
    );
  });

  it('refuses text it would have to decode, never interpreting it', () => {
    refused(
      () =>
        read(base.text.replace('NON_QURAN_FIXTURE_1_1 ', 'NON_QURAN_FIXTURE_1_1 &amp; ')),
      /unexpected content/,
    );
    refused(
      () => read(base.text.replace('<sura index="2"', '<extra />\n\t<sura index="2"')),
      /unexpected content/,
    );
  });

  it('refuses a missing, repeated or misnumbered Ayah or Surah', () => {
    const line = /\t\t<aya index="2" text="NON_QURAN_FIXTURE_2_2[^\n]*\n/u;
    refused(() => read(base.text.replace(line, '')), /out of order/);
    refused(
      () => read(base.text.replace('<sura index="3"', '<sura index="4"')),
      /out of order/,
    );
    refused(() => read(base.text.replace('</quran>', '')), /ends before/);
  });

  it('refuses files that disagree on a Surah', () => {
    refused(
      () =>
        read(
          base.text,
          base.metadata.replace('name="NON_QURAN_FIXTURE_SURAH_5"', 'name="OTHER"'),
        ),
      /name Surah 5 differently/,
    );
    refused(
      () =>
        read(
          base.text,
          base.metadata.replace(/ayas="7" start="0"/u, 'ayas="8" start="0"'),
        ),
      /disagree on the ayat of Surah 1/,
    );
  });

  it('refuses a Juz or hizb the text does not mark', () => {
    const corpus = read(base.text);
    const juzTwo = corpus.ayat.find((a) => a.juz === 2);
    expect(juzTwo).toBeDefined();
    const needle = `text="۞ NON_QURAN_FIXTURE_${juzTwo!.surah}_${juzTwo!.ayah} `;
    expect(base.text).toContain(needle);
    refused(
      () =>
        read(
          base.text.replace(
            needle,
            `text="NON_QURAN_FIXTURE_${juzTwo!.surah}_${juzTwo!.ayah} `,
          ),
        ),
      /Juz 2 starting at .* is not marked/,
    );
  });

  it('refuses prostrations the two files disagree on', () => {
    const first = /<sajda index="1" sura="(\d+)" aya="(\d+)"/u.exec(base.metadata);
    expect(first).not.toBeNull();
    refused(() => read(base.text.replace(' ۩"', '"')), /disagree on the prostration/);
    refused(
      () =>
        read(
          base.text.replace(
            'NON_QURAN_FIXTURE_1_1 نص اختبار غير قرآني"',
            'NON_QURAN_FIXTURE_1_1 نص اختبار غير قرآني ۩"',
          ),
        ),
      /disagree on the prostration at 1:1/,
    );
  });

  it('refuses boundaries out of reading order, missing, or beyond the text', () => {
    refused(
      () =>
        read(
          base.text,
          base.metadata.replace(
            /<page index="3" sura="\d+" aya="\d+" \/>/u,
            '<page index="3" sura="1" aya="1" />',
          ),
        ),
      /page starts are not in reading order/,
    );
    refused(
      () => read(base.text, base.metadata.replace(/\t\t<page index="604"[^\n]*\n/u, '')),
      /page entries/,
    );
    refused(
      () =>
        read(
          base.text,
          base.metadata.replace(
            /<page index="5" sura="\d+" aya="\d+" \/>/u,
            '<page index="5" sura="1" aya="999" />',
          ),
        ),
      /which the text does not have/,
    );
  });

  it('records the metadata digest in the evidence as the names import looks for it', () => {
    const corpus = read(base.text);
    expect(referenceEvidence(corpus)).toContain(
      `cc-by, SHA-256 ${corpus.metadataSha256}; hizb derived`,
    );
  });

  it('refuses a metadata file that is not the edition under its licence', () => {
    refused(
      () => read(base.text, base.metadata.replace('license="cc-by"', 'license="other"')),
      /not Tanzil Quran Metadata 1.0/,
    );
    refused(
      () =>
        read(
          base.text.replace('License: Creative Commons Attribution 3.0', 'License: none'),
        ),
      /not Tanzil Uthmani 1.1/,
    );
  });
});

/* ===========================================================================
 * Quran Part 2 — the Surah names
 * ========================================================================= */

function names(metadata = base.metadata, expected?: string) {
  const bytes = utf8(metadata);
  return readTanzilSurahNames({
    metadata: bytes,
    expectedSha256: expected ?? sha256Hex(bytes),
  });
}

describe('the Tanzil Surah names', () => {
  it('reads the 114 names exactly as written — Arabic, transliteration and meaning', () => {
    const read = names();
    expect(read.metadataSha256).toBe(sha256Hex(utf8(base.metadata)));
    expect(read.surahs).toHaveLength(114);
    read.surahs.forEach((surah, index) => {
      expect(surah).toEqual({
        number: index + 1,
        nameArabic: `NON_QURAN_FIXTURE_SURAH_${index + 1}`,
        transliteration: fixtureTransliteration(index + 1),
        meaning: fixtureMeaning(index + 1),
      });
    });
    // Verbatim: the apostrophe and the doubled vowel survive untouched.
    expect(read.surahs[5]?.transliteration).toBe("NON_QURAN_FIXTURE_Aa'-6");
  });

  it('names the same Surahs, in the same words, as the corpus read from the same file', () => {
    const corpus = read(base.text);
    const read2 = names();
    expect(read2.metadataSha256).toBe(corpus.metadataSha256);
    expect(read2.surahs.map((surah) => surah.nameArabic)).toEqual(
      corpus.surahs.map((surah) => surah.nameArabic),
    );
  });

  it('refuses a metadata file that is not the one recorded', () => {
    refused(() => names(base.metadata, '0'.repeat(64)), /SHA-256 differs/);
    refused(() => names(base.metadata, 'not-a-digest'), /not a SHA-256/);
    refused(
      () => names(`${String.fromCharCode(0xfeff)}${base.metadata}`),
      /byte-order mark/,
    );
  });

  it('refuses a name it would have to decode, an empty or padded one, and a missing Surah', () => {
    refused(
      () =>
        names(
          base.metadata.replace(
            'tname="NON_QURAN_FIXTURE_TNAME_2"',
            'tname="NON_QURAN_FIXTURE &amp; 2"',
          ),
        ),
      /sura entries/,
    );
    refused(
      () =>
        names(base.metadata.replace('ename="NON_QURAN_FIXTURE meaning 3"', 'ename=""')),
      /empty or padded name/,
    );
    refused(
      () =>
        names(
          base.metadata.replace(
            'ename="NON_QURAN_FIXTURE meaning 4"',
            'ename=" NON_QURAN_FIXTURE meaning 4"',
          ),
        ),
      /empty or padded name/,
    );
    refused(
      () => names(base.metadata.replace(/\t\t<sura index="114"[^\n]*\n/u, '')),
      /sura entries/,
    );
    refused(
      () =>
        names(
          base.metadata.replace(
            'tname="NON_QURAN_FIXTURE_TNAME_7"',
            `tname="${'x'.repeat(101)}"`,
          ),
        ),
      /longer than the store holds/,
    );
  });

  it('refuses a metadata file that is not the edition under its licence', () => {
    refused(
      () => names(base.metadata.replace('license="cc-by"', 'license="other"')),
      /not Tanzil Quran Metadata 1.0/,
    );
  });
});
