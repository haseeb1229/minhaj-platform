import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SURAH_AYAH_COUNTS } from '../../packages/contracts/src/passage/index.ts';
import {
  SPELLINGS,
  foldName,
  nameIndex,
  planFingerprint,
  planPassages,
  readTitle,
  readTitles,
  type SurahNameInput,
  type TitledOwner,
} from '../../scripts/quran/title-passages.ts';

/**
 * Quran Part 8 — the strict title reader behind `tafsir-passages.sh`, over REAL
 * staging titles (the survey of 2026-11-10: 615 books and 2,020 videos, every
 * title Latin-script, quoted verbatim below) and the canonical names the Quran
 * reader exposes — here the English display names as the staging corpus
 * records them (Tanzil's transliterations), for the Surahs these titles touch
 * and the names they could be confused with.
 */

const NAMES: Readonly<Record<number, string>> = {
  1: 'Al-Faatiha',
  2: 'Al-Baqara',
  3: 'Aal-i-Imraan',
  4: 'An-Nisaa',
  5: 'Al-Maaida',
  6: "Al-An'aam",
  7: "Al-A'raaf",
  8: 'Al-Anfaal',
  9: 'At-Tawba',
  12: 'Yusuf',
  14: 'Ibrahim',
  17: 'Al-Israa',
  18: 'Al-Kahf',
  19: 'Maryam',
  22: 'Al-Hajj',
  24: 'An-Noor',
  28: 'Al-Qasas',
  30: 'Ar-Room',
  36: 'Yaseen',
  37: 'As-Saaffaat',
  47: 'Muhammad',
  52: 'At-Tur',
  53: 'An-Najm',
  55: 'Ar-Rahmaan',
  56: 'Al-Waaqia',
  62: "Al-Jumu'a",
  73: 'Al-Muzzammil',
  76: 'Al-Insaan',
  89: 'Al-Fajr',
  97: 'Al-Qadr',
  103: 'Al-Asr',
  105: 'Al-Fil',
  108: 'Al-Kawthar',
  112: 'Al-Ikhlaas',
  114: 'An-Naas',
};

const SURAHS: readonly SurahNameInput[] = Object.entries(NAMES).map(([number, name]) => ({
  number: Number(number),
  ayahCount: SURAH_AYAH_COUNTS[Number(number) - 1] ?? 0,
  names: [name],
}));

const whole = (surah: number) => ({
  surah,
  ayahFrom: 1,
  ayahTo: SURAH_AYAH_COUNTS[surah - 1] ?? 0,
});

const read = (title: string) => readTitle(title, SURAHS);

describe('one spelling rule for every name', () => {
  it.each([
    ['Al-Faatiha', 'fatiha'],
    ['al-Fatihah', 'fatiha'],
    ['Fatiha', 'fatiha'],
    ['Aal-i-Imraan', 'imran'],
    ['Aal Imran', 'imran'],
    ["Al-An'aam", 'anam'],
    ['As-Saaffaat', 'safat'],
    ['At-Tawba', 'tauba'],
    ['Taubah', 'tauba'],
    ['Yaseen', 'yasin'],
    ['Al-Muzzammil', 'muzamil'],
  ])('%s folds to %s', (name, folded) => {
    expect(foldName(name)).toBe(folded);
  });

  it('keeps a spelling only when one Surah owns it', () => {
    const index = nameIndex([
      { number: 1, ayahCount: 7, names: ['Same'] },
      { number: 2, ayahCount: 286, names: ['Same', 'Other'] },
    ]);
    expect(index.has('same')).toBe(false);
    expect(index.get('other')).toBe(2);
  });

  it('records each documented spelling for its own Surah only', () => {
    const index = nameIndex(SURAHS);
    for (const [surah, spellings] of Object.entries(SPELLINGS))
      for (const spelling of spellings)
        expect(index.get(foldName(spelling))).toBe(Number(surah));
  });
});

describe('titles that name a Surah after a marker (staging survey, verbatim)', () => {
  it.each([
    ['Asma-e-Sura Fatiha', [whole(1)]],
    ['Awwaliyyat-e-Sura Fatiha awr Awwaliyyat-e-Nur-e-Muhammadi', [whole(1)]],
    ['Life & Leadership Lessons from Sura Al-Kahf', [whole(18)]],
    ['Surah Yusuf: Qiyadat aur Hukmrani ke Qurani Usool', [whole(12)]],
    ['Tafseer Sura al-Fatiha', [whole(1)]],
    ['Tafsir Minhaj-ul-Qur’an (Sura al-Baqara)', [whole(2)]],
    ['Tafsir Minhaj-ul-Qur’an (Sura al-Fatiha; Part-I)', [whole(1)]],
    ['Uslub e Sura Fatiha awr Nizam e Fikr-o-Amal', [whole(1)]],
    ['Maarif Surah alAsr awr Falsafa Fana o Baqa', [whole(103)]],
    ['Maarif Sura al-Asr & Paigham e Inqilab', [whole(103)]],
    ['Daee Kay-Liye 5 Nukati Nuskha Sabr (Surah Muzzammil ki Roshni main)', [whole(73)]],
    ['Dawra-e-Quran: Surah al-Araf (Session 6)', [whole(7)]],
    ['Dawra-e-Quran: Surah al-Anaam (Part 5)', [whole(6)]],
    ['Dawra-e-Quran: Surah al-Maida (Session 4)', [whole(5)]],
    ['Dowra Quran Surah an-Nisa (3rd Session)', [whole(4)]],
    ['Dawra-e-Quran: Surah Al-Imran & Surah an-Nisa (Session 2)', [whole(3), whole(4)]],
    [
      'Dawra e Quran: Surah al-Fatihah & Surah al-Baqarah - 1st Session',
      [whole(1), whole(2)],
    ],
    ['Azmat e Ahl e Bait o Shahadat e Imam e Hussain | Surah Al-dhar', [whole(76)]],
    ['Allah sy Tijarat awr us k Tqazay (Surah AlSaffat)(Vol 1)', [whole(37)]],
    ['Tafseer Surah Fajr aur Huzoor (S.A.W) ki Zaat e Aqdas', [whole(89)]],
    ['Haqq ki Dawat mein anewaly Masaib o Mushkilat (Dars Surah Maryam)', [whole(19)]],
    [
      'Batil Nizam kay Khilaf Payghambarana Jidd-o-Juhad | Sura al-Qasas ki Roshani Main',
      [whole(28)],
    ],
    ['Reflections of Quran from Surah al-Fatiha (Part: 11 - 12)', [whole(1)]],
    ['Waqia Miraj (Surah at-Tur aur an-Najm ki Roshni main)', [whole(52), whole(53)]],
    [
      'Alamat e Munafiqeen awr Rah e Haq ke Masaib (Sura Baqara ki roshni main)',
      [whole(2)],
    ],
    [
      'Mustafavi Inqilab ky liey Jihad ky Taqazy (Surah Taubah ki Roshni mein)',
      [whole(9)],
    ],
    [
      'Maqam e Wilayat aur Shaan e Ghaus e Aazam (R.A)(Surah Kahf ky hawaly sy)',
      [whole(18)],
    ],
    ['Tasawar e Rehmat(Surah Kahf ki Roshni main)', [whole(18)]],
    ['Marifat e Tawhid awr Zaroorat e Risalat (Tafseer Surah Ikhlas)', [whole(112)]],
    ['Waqia Miraj un Nabi (S.A.W) (Surah Al-Isra ki Roshani Main)', [whole(17)]],
    ['Surah Fatiha ky Asma awr un ky Ausaf (Volume 2)', [whole(1)]],
  ])('%s', (title, passages) => {
    expect(read(title)).toEqual({ kind: 'passages', passages });
  });
});

describe('ayat stated in a title', () => {
  it('reads "verse 13 to 18" for the one Surah named (mtv-3383)', () => {
    expect(read('Sura Aal Imran (verse 13 to 18) ke Batini Ma`arif')).toEqual({
      kind: 'passages',
      passages: [{ surah: 3, ayahFrom: 13, ayahTo: 18 }],
    });
  });

  it('reads other shapes of a range and a single Ayah', () => {
    expect(read('Dars Surah Kahf Ayat 1-10')).toEqual({
      kind: 'passages',
      passages: [{ surah: 18, ayahFrom: 1, ayahTo: 10 }],
    });
    expect(read('Surah al-Baqarah, ayah 255')).toEqual({
      kind: 'passages',
      passages: [{ surah: 2, ayahFrom: 255, ayahTo: 255 }],
    });
  });

  it('never reads Part, Volume, Session or Episode numbers as ayat', () => {
    expect(read('Reflections of Quran from Surah al-Fatiha (Part: 27 - 28)')).toEqual({
      kind: 'passages',
      passages: [whole(1)],
    });
    expect(read('Darajat Bandagi (Volume 2)(Surah Kahf ki Roshni main)')).toEqual({
      kind: 'passages',
      passages: [whole(18)],
    });
  });

  it('refuses a range with two Surahs, none, or beyond its Surah', () => {
    expect(read('Surah Fatiha & Surah Baqara verses 1 to 5')).toEqual({
      kind: 'refused',
      reason: 'range-without-one-surah',
    });
    expect(read('Tafseer verses 1 to 5')).toEqual({
      kind: 'refused',
      reason: 'range-without-one-surah',
    });
    expect(read('Surah Fatiha verses 1 to 8')).toEqual({
      kind: 'refused',
      reason: 'range-outside-surah',
    });
    expect(read('Surah Kahf ayat 5 to 3')).toEqual({
      kind: 'refused',
      reason: 'range-outside-surah',
    });
  });
});

describe('the one named Ayah', () => {
  it.each([
    'Tafseer Ayat tul Kursi',
    'Dars-e-Quran : Tafseer Ayat tul Kursi',
    'Ma‘arif Aaya al-Kursi',
  ])('%s is 2:255', (title) => {
    expect(read(title)).toEqual({
      kind: 'passages',
      passages: [{ surah: 2, ayahFrom: 255, ayahTo: 255 }],
    });
  });
});

describe('titles that name no Surah (negatives from the survey, verbatim)', () => {
  it.each([
    // A Surah's name as an ordinary word, with no marker.
    'Falsafa-e-Hajj',
    'Hajj Mazhar e Mahabbat',
    'Masala Noor o Bashar ki Wazahat',
    'Quran aur silsila e Noor (Khutba e Juma)',
    'Day:7 | Qurb e Ilahi | Laylatul Qadr',
    'Waqt | Ahmiyat Aur Qadr o Qimat | Episode: 1',
    'Interview of Dr Muhammad Tahir-ul-Qadri',
    'Muhammad the Merciful',
    'Shab e Barat: Tauba aur Nijat ki raat',
    'Tawba wa Istighfar',
    '‘Asr-e-Hazir awr Falsafa-e-Ijtihad',
    'Ikhlas Kia Hai? | Layla-tul-Qadr',
    'Nuzool-e-Masih ibn-e-Maryam (A.S)',
    'Hazrat Yusuf (A.S)',
    'Hajj Main Hazrat Ibrahim A.S Ko Markazi Haisiyat Kuin?',
    'Falsafa tul Hayat fil Islam',
    'Tafsir Bismillah ir-Rahman ir-Rahim (Volume 1)',
    'Waqia Ashab e Kahf ki Arifana Tafseer',
    'Ma‘arif al-Kawthar',
    'Inna Aatainak al Kausar',
    'Molana Rum',
    'Imran Khan',
    // Tafsir, Dars and Quran with no Surah.
    'Al-Fath al-Kabir fi Ulum al-Tafsir [2 Volumes]',
    'Duroos e Quran',
    'Irfan-ul-Quran',
    'Dars e Nahaj ul Balagha',
    'Kaifiyyat, Haal Awr Muqam, Husn e Adab Ki Ahmiyat Awr Asrat (Dars 09)',
    'Tafakkur e Quran (Volume 17): Tasawwur e Naiki',
    'Faza’il-e-Namaz par Muntakhab Ayat-o-Ahadith awr Asar-o-Aqwal',
    'Aayat e Miraj ki Ilmi o Ruhani Tafsir',
    'Irada-e-Ilahi, Ayat-e-Tatheer aur Shaan-e-Ahl-e-Bait (A.S)',
    // The plural "Suwar" is never a marker.
    'al-Durar min Marif al-Suwar',
    'Horizons of Ramadan (Part: 1 - 6)',
  ])('%s', (title) => {
    expect(read(title)).toEqual({ kind: 'none' });
  });
});

describe('a marker that names nothing is refused, never guessed', () => {
  it.each([
    'Riyasat e Madina ka Aain awr Pakistan ki Maujuda Surat e Hal',
    'Inqilab: Kab awr Kaise? (Mulki Soorat e Hal ke Tanazur main)',
    'Takwin al-Shakhs al-Insani fi Surat al-Sab al-Masani',
    'Dowra Quran Surah Alinfaal (Part 11)',
  ])('%s', (title) => {
    expect(read(title)).toEqual({ kind: 'refused', reason: 'marker-without-surah' });
  });
});

describe('an owner’s titles together', () => {
  it('agrees across locales, keeps a title that names nothing, refuses a disagreement', () => {
    expect(readTitles(['Surah Kahf ki Roshni main', 'Surah Kahf'], SURAHS)).toEqual({
      kind: 'passages',
      passages: [whole(18)],
    });
    expect(readTitles(['Surah Kahf ki Roshni main', 'Tasawar e Rehmat'], SURAHS)).toEqual(
      {
        kind: 'passages',
        passages: [whole(18)],
      },
    );
    expect(readTitles(['Surah Kahf', 'Surah Maryam'], SURAHS)).toEqual({
      kind: 'refused',
      reason: 'titles-disagree',
    });
  });
});

describe('the plan an operator confirms', () => {
  const owner = (overrides: Partial<TitledOwner>): TitledOwner => ({
    kind: 'video',
    id: 'v1',
    version: 3,
    published: true,
    titles: ['Tasawar e Rehmat(Surah Kahf ki Roshni main)'],
    hasPassages: false,
    ...overrides,
  });
  const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

  it('plans published, unannotated records only, and counts the rest', () => {
    const plan = planPassages(
      [
        owner({}),
        owner({ id: 'v2', published: false }),
        owner({ id: 'v3', hasPassages: true }),
        owner({ id: 'v4', titles: ['Hajj Mazhar e Mahabbat'] }),
        owner({ id: 'v5', titles: ['Surat e Hal'] }),
        owner({ kind: 'work', id: 'w1', titles: ['Tafseer Sura al-Fatiha'] }),
      ],
      SURAHS,
    );
    expect(plan.planned.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      'video:v1',
      'work:w1',
    ]);
    expect(plan.counts).toMatchObject({
      worksRead: 1,
      videosRead: 5,
      unpublished: 1,
      kept: 1,
      works: 1,
      videos: 1,
      passages: 2,
      'refused:marker-without-surah': 1,
    });
  });

  it('fingerprints the exact set: a version or a passage changing changes it', () => {
    const base = planPassages([owner({})], SURAHS).planned;
    const first = planFingerprint(base, sha);
    expect(first.count).toBe(1);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(planFingerprint(planPassages([owner({})], SURAHS).planned, sha)).toEqual(
      first,
    );
    expect(
      planFingerprint(planPassages([owner({ version: 4 })], SURAHS).planned, sha)
        .fingerprint,
    ).not.toBe(first.fingerprint);
    expect(
      planFingerprint(
        planPassages([owner({ titles: ['Dars Surah Kahf Ayat 1-10'] })], SURAHS).planned,
        sha,
      ).fingerprint,
    ).not.toBe(first.fingerprint);
  });
});
