/**
 * TRIMMED REAL QuranEnc API answers (fetched 2026-11-10 from
 * `https://quranenc.com/api/v1/translation/sura/{key}/{sura}`, re-published
 * under QuranEnc's terms: https://quranenc.com/en/home/api/) for the QuranEnc
 * adapter suite. Each Surah is the API's `result` exactly, its rows' fields
 * verbatim, except `arabic_text` — which the adapter never reads — left out.
 * The rows are single ayat whose footnotes take each surveyed form.
 */

/** Surah 108 (3 ayat), every pinned translation, keyed by its QuranEnc key. */
export const AL_KAWTHAR: Readonly<
  Record<string, { readonly result: readonly Record<string, string>[] }>
> = {
  urdu_junagarhi: {
    result: [
      {
        id: '6205',
        sura: '108',
        aya: '1',
        translation: 'یقیناً ہم نے تجھے (حوض) کوﺛر (اور بہت کچھ) دیا ہے.[1]',
        footnotes:
          '[1] كَوْثَرٌ، کثرت سے ہے۔ اس کے معتدد معنی بیان کیے گئے ہیں۔ ابن کثیر نے (خیر کثیر) کے مفہوم کو ترجیح دی ہے کیوں کہ اس میں ایسا عموم ہے کہ جس میں دوسرے معنی بھی آجاتے ہیں۔ مثلاً صحیح احادیث میں بتلایا گیا ہے، کہ اس سے ایک نہر مراد ہےجو جنت میں آپ (صلى الله عليه وسلم) کو عطا کی جائے گی۔ اسی طرح بعض احادیث میں اس کا مصداق حوض بتلایا گیا ہے، جس سے اہل ایمان جنت میں جانے سے قبل نبی (صلى الله عليه وسلم) کے دست مبارک سے پانی پئیں گے۔ اس حوض میں پھر پانی اسی جنت والی نہر سے آرہا ہوگا۔ اسی طرح دنیا کی فتوحات اور آپ (صلى الله عليه وسلم) کا رفع ودوام ذکر اور آخرت کا اجر وثواب، سب ہی چیزیں (خیر کثیر) میں آجاتی ہیں۔ (ابن کثیر) ۔',
      },
      {
        id: '6206',
        sura: '108',
        aya: '2',
        translation: 'پس تو اپنے رب کے لئے نماز پڑھ اور قربانی کر.[1]',
        footnotes:
          '[1] یعنی نماز بھی صرف ایک اللہ کے لئے اور قربانی بھی صرف ایک اللہ کے نام پر۔ مشرکین کی طرح ان میں دوسروں کو شریک نہ کر۔ نَحْرٌ کے اصل معنی ہیں اونٹ کے حلقوم میں نیزہ یا چھری مار کر اسے ذبح کرنا۔ دوسرے جانوروں کو زمین پر لٹا کر ان کے گلوں پر چھری پھیری جاتی ہے اسے ذبح کرنا کہتے ہیں۔ لیکن یہاں نحر سے مراد مطلق قربانی ہے، علاوہ ازیں اس میں بطور صدقہ وخیرات جانور قربان کرنا۔ حج کے موقعے پر منیٰ میں اور عیدالاضحیٰ کے موقعے پر قربانی کرنا، سب شامل ہیں۔',
      },
      {
        id: '6207',
        sura: '108',
        aya: '3',
        translation: 'یقیناً تیرا دشمن ہی ﻻوارث اور بے نام ونشان ہے.[1]',
        footnotes:
          '[1] أَبْتَرُ ایسے شخص کوکہتے ہیں جو مقطوع النسل یا مقطوع الذکر ہو، یعنی اس کی ذات پر اس کی نسل کا خاتمہ ہوجائے یا کوئی اس کا نام لیوا نہ رہے۔ جب نبی (صلى الله عليه وسلم) کی اولاد نرینہ زندہ نہ رہی تو بعض کفار نے نبی (صلى الله عليه وسلم) کو ابتر کہا، جس پر اللہ تعالیٰ نے آپ (صلى الله عليه وسلم) کو تسلی دی کہ ابتر تو نہیں، تیرے دشمن ہی ہوں گے۔ چنانچہ اللہ تعالیٰ نے آپ (صلى الله عليه وسلم) کی نسل کو باقی رکھا گو اس کا سلسلہ لڑکی کی طرف سے ہی ہے۔ اسی طرح آپ (صلى الله عليه وسلم) کی امت بھی آپ (صلى الله عليه وسلم) کی اوالاد معنوی ہی ہے، جس کی کثرت پر آپ (صلى الله عليه وسلم) قیامت والے دن فخر کریں گے، علاوہ ازیں آپ (صلى الله عليه وسلم) کا ذکر پوری دنیا میں نہایت عزت واحترام سے کیا جاتا ہے، جبکہ آپ (صلى الله عليه وسلم) سے بغض وعناد رکھنے والے صرف صفحات تاریخ پر ہی موجود رہ گئے ہیں لیکن کسی دل میں ان کا احترام نہیں اور کسی زبان پر ان کا ذکر خیرنہیں۔',
      },
    ],
  },
  english_saheeh: {
    result: [
      {
        id: '6205',
        sura: '108',
        aya: '1',
        translation: 'Indeed, We have granted you, [O Muḥammad], al-Kawthar.',
        footnotes: '',
      },
      {
        id: '6206',
        sura: '108',
        aya: '2',
        translation: 'So pray to your Lord and offer sacrifice [to Him alone].',
        footnotes: '',
      },
      {
        id: '6207',
        sura: '108',
        aya: '3',
        translation: 'Indeed, your enemy is the one cut off.[2002]',
        footnotes: '[2002] From all good in this world and the Hereafter.',
      },
    ],
  },
  english_rwwad: {
    result: [
      {
        id: '6205',
        sura: '108',
        aya: '1',
        translation:
          'We have surely given you [O Prophet] al-Kauthar [i.e., abundance][1],',
        footnotes:
          '[1] i.e., abundance, of which is the river of al-Kauthar in Paradise.',
      },
      {
        id: '6206',
        sura: '108',
        aya: '2',
        translation: 'so pray and offer sacrifice to your Lord alone.',
        footnotes: '',
      },
      {
        id: '6207',
        sura: '108',
        aya: '3',
        translation:
          'Indeed, the one who hates you is truly cut off [from all goodness][2].',
        footnotes: '[2] Both in this world and in the Hereafter.',
      },
    ],
  },
  english_hilali_khan: {
    result: [
      {
        id: '6205',
        sura: '108',
        aya: '1',
        translation:
          'Verily, We have granted you (O Muhammad صلى الله عليه وسلم) Al-Kauthar (a river in Paradise).[1]',
        footnotes:
          '[1] Narrated Anas رضي الله عنه: When the Prophet صلى الله عليه وسلم was made to ascend to the heavens. He صلى الله عليه وسلم said (after his return), "I came upon a river (in Paradise) the banks of which were made of tents of hollow pearls. I asked Jibrîl (Gabriel), ‘What is this (river)?’ He replied, ‘This is the Kauthar’ " (Sahih Al-Bukhâri, Vol.6, Hadîth No. 488).',
      },
      {
        id: '6206',
        sura: '108',
        aya: '2',
        translation: 'Therefore turn in prayer to your Lord and sacrifice (to Him only).',
        footnotes: '',
      },
      {
        id: '6207',
        sura: '108',
        aya: '3',
        translation:
          'For he who hates you (O Muhammad صلى الله عليه وسلم), he will be cut off (from posterity and every good thing in this world and in the Hereafter).[2]',
        footnotes:
          '[2] Narrated Anas رضي الله عنه : The Prophet صلى الله عليه وسلم said, "None of you will have Faith till he loves me more than his father, his children and all mankind. (Sahih Al-Bukhari, Vol.1, Hadith No.14).',
      },
    ],
  },
};

/** Saheeh 1:2 — a bracketed interpolation ("[All]") beside a footnote mark. */
export const SAHEEH_1_2 = {
  translation: '[All] praise is [due] to Allāh, Lord[4] of the worlds -',
  footnotes:
    '[4] When referring to Allāh (subḥānahu wa taʿālā) , the Arabic term "rabb" (translated as "Lord") includes all of the following meanings: "owner, master, ruler, controller, sustainer, provider, guardian and caretaker."',
};

/** Rowwad 2:3 — two footnotes set on one line. */
export const RWWAD_2_3 = {
  translation:
    'those who believe in the unseen, establish prayer[3], and spend out of what We[4] have provided for them,',
  footnotes:
    '[3] At its proper times and fulfill its all conditions. [4] "We" in reference to Allah in the Qur’anic verses is necessarily understood to denote grandeur and power.',
};

/** Rowwad 2:255 — eight footnotes, each on its own line after a space. */
export const RWWAD_2_255 = {
  translation:
    'Allah: none has the right to be worshiped except Him, the Ever-Living[143], All-Sustaining[144]. Neither drowsiness overtakes Him nor sleep[145]. To Him belongs all that is in the heavens and all that is on earth. Who is there that can intercede with Him except with His permission? He knows what was before them and what will be after them[146], while they encompass nothing of His knowledge, except what He wills. His Kursī[147] [i.e., footstool] extends over the heavens and earth, and safeguarding of both does not weary Him, for He is the Most High[148], the Most Great[149].[150]',
  footnotes:
    "[143] Whose life is perfect, complete, and eternal, without beginning or end.\n [144] Dependent on none for His existence while being the sustainer of all created beings.\n [145] Dozing off and falling asleep are but normal to all creation that are inherently frail.\n [146] Allah's knowledge encompasses every aspect of His creations in the past, present and future.\n [147] Chair or footstool. It is not to be confused with al-‘Arsh (the Throne), which is infinitely higher and greater than al-Kursī.\n [148] Above all of His creations and superior to them in essence, rank, and position.\n [149] Whose greatness is unlimited, beyond description or imagination.\n [150] This verse is known as Āyat al-Kursī, lit. The verse of the Footstool. It is the greatest verse in the Qur’an.",
};

/** Junagarhi 5:8 — one footnote for two marks ("[1] ، [2]"). */
export const JUNAGARHI_5_8 = {
  translation:
    'اے ایمان والو! تم اللہ کی خاطر حق پر قائم ہو جاؤ، راستی اور انصاف کے ساتھ گواہی دینے والے بن جاؤ[1] ، کسی قوم کی عداوت تمہیں خلاف عدل پر آماده نہ کردے[2]، عدل کیا کرو جو پرہیز گاری کے زیاده قریب ہے، اور اللہ تعالیٰ سے ڈرتے رہو، یقین مانو کہ اللہ تعالیٰ تمہارے اعمال سے باخبر ہے۔',
  footnotes:
    '[1] ، [2]پہلے جملے کی تشریح سورۃ النساء آیت نمبر 135 میں اور دوسرے جملہ کی سورۃ المائدۃ کے آغاز میں گزر چکی ہے۔ نبی کریم (صلى الله عليه وسلم) کے نزدیک عادلانہ گواہی کی کتنی اہمیت ہے، اس کا اندازہ اس واقعے سے ہوتا ہے جو حدیث میں آتا ہے حضرت نعمان بن بشیر (رضی اللہ عنہ) کہتے ہیں میرے باپ نے مجھے عطیہ دیا تو میری والدہ نے کہا، اس عطیے پر آپ جب تک اللہ کے رسول کو گواہ نہیں بنائیں گے میں راضی نہیں ہوں گی۔ چنانچہ میرے والد نبی (صلى الله عليه وسلم) کی خدمت میں آئے تو آپ (صلى الله عليه وسلم) نے پوچھا کیا تم نے اپنی ساری اولاد کو اسی طرح کا عطیہ دیا ہے؟ انہوں نے نفی میں جواب دیا تو آپ (صلى الله عليه وسلم) نے فرمایا ”اللہ سے ڈرو! اور اولاد کے درمیان انصاف کرو“ اور فرمایا کہ ”میں ظلم پر گواہ نہیں بنوں گا“۔ (صحيح بخاري ومسلم، كتاب الهبة)',
};

/** Junagarhi 2:285 — a footnote with no mark, on an ayah whose translation has none. */
export const JUNAGARHI_2_285 = {
  translation:
    'رسول ایمان ﻻیا اس چیز پر جو اس کی طرف اللہ تعالیٰ کی جانب سے اتری اور مومن بھی ایمان ﻻئے، یہ سب اللہ تعالیٰ اور اس کے فرشتوں پر اور اس کی کتابوں پر اور اس کے رسولوں پر ایمان ﻻئے، اس کے رسولوں میں سے کسی میں ہم تفریق نہیں کرتے، انہوں نے کہہ دیا کہ ہم نے سنا اور اطاعت کی، ہم تیری بخشش طلب کرتے ہیں اے ہمارے رب! اور ہمیں تیری ہی طرف لوٹنا ہے،',
  footnotes:
    '- اس آیت میں پھر ان ایمانیات کا ذکر ہے جن پر ا ہل ایمان کو ایمان رکھنے کا حکم دیا گیا ہے اور اس سے اگلی آیت «لا يُكَلِّفُ اللَّهُ» میں اللہ تعالیٰ کی رحمت وشفقت اور اس کے فضل وکرم کا تذکرہ ہے کہ اس نے انسانوں کو کسی ایسی بات کا مکلف نہیں کیا ہے جو ان کی طاقت سے بالا ہو۔ ان دونوں آیات کی احادیث میں بڑی فضیلت آئی ہے۔ نبی (صلى الله عليه وسلم) نے فرمایا: «جو شخص سورۂ بقرہ کی آخری دو آیتیں رات کو پڑھ لیتا ہے تو یہ اس کو کافی ہوجاتی ہیں»۔ (صحیح بخاری۔ ابن کثیر) یعنی اس عمل کی بدولت اللہ تعالیٰ اس کی حفاظت فرماتا ہے۔ دوسری حدیث میں ہے۔ نبی (صلى الله عليه وسلم) کو معراج کی رات جو تین چیزیں ملیں، ان میں سے ایک سورۂ بقرہ کی یہ آخری دو آیات بھی ہیں۔ (صحیح مسلم، باب فی ذکر سدرۃ المنتہی) کئی روایت میں یہ بھی وارد ہے کہ اس سورہ کی آخری آیات آپ (صلى الله عليه وسلم) کو ایک خزانے سے عطا کی گئیں جو عرش الٰہی کے نیچے ہے۔ اور یہ آیات آپ کے سوا کسی اور نبی کو نہیں دی گئیں (أحمد، نسائي ، طبراني، بيهقي، حاكم دارمي وغيره-در منثور) حضرت معاذ (رضي الله عنه) اس سورت کے خاتمے پر آمین کہا کرتے تھے۔ (ابن کثیر)',
};
