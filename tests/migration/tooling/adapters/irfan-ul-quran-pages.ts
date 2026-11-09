/**
 * TRIMMED REAL surah pages and rows of www.irfan-ul-quran.com (fetched
 * 2026-11-09 and 2026-11-10), first-party Minhaj-ul-Quran text admitted under
 * OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS. Every
 * row keeps exactly what the parser reads, as the site wrote it — the ayah
 * trigger's `data-sura`/`data-ayat`, both `h2.ur`, `h2.en` and the
 * `p.en` note slot — and the Urdu and English labels; the Arabic, the other
 * translations, the copy payloads, scripts and page chrome are cut. A short
 * surah is kept whole because the parser refuses a partial one; a long
 * surah's note row is kept alone, for a test to place among synthetic rows.
 *
 *   al-Munafiqun (63) — a "٭" note: ayah 5 carries the "٭" mark and its
 *                       row's second `h2.ur` holds the note opened by it (the
 *                       English keeps the same note in `p.en`).
 *   al-Ikhlas (112)   — no note: every second `h2.ur` empty.
 *   al-Kawthar (108)  — an unmarked note: ayah 1 carries "٭", its note opens
 *                       with no mark, and its `p.en` is filled.
 *   az-Zumar 39:31    — an ASCII "*" mark and a note opened by "*".
 *   ash-Shura 42:52   — numbered marks "(1)" "(2)" and ONE note holding
 *                       "1:-" … "2:-".
 *   Muhammad 47:19    — an ASCII "*" mark and a note opened by "٭".
 *
 * Quran Part 6 (parser version 3 reads the notes; rows copied from the pages
 * fetched 2026-11-10, both note slots and both translations kept):
 *
 *   at-Tawbah 9:29    — ONE `p.en` holding two English notes, "*" and "**",
 *                       a blank source line apart, for the marks "*" and "**".
 *   at-Tawbah 9:101   — an English note whose translation carries no mark
 *                       (the note is the ayah's as a whole); Urdu "٭" note.
 *   an-Nur 24:35      — an English note of two paragraphs (`<br><br>`).
 *   al-Ahzab 33:6     — an English slot holding only its mark "* ": no note.
 *   al-Ahzab 33:37    — an Urdu note opened "٭:".
 *   an-Najm 53:39     — an English note opened with no mark, for the one "*".
 *   an-Nisa 4:34      — an English note whose words include a link and an
 *                       italic: the words are read, never the address.
 */

const lines = (rows: readonly string[]): string => rows.join('\n');

const page = (rows: readonly string[]): string =>
  [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head><body>',
    ...rows,
    '</body></html>',
  ].join('\n');

export const AL_MUNAFIQUN_PAGE = page([
  '<div class="brows-job-list ayatno_" id="ayatno_1">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="1"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo1"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/1/">',
  '<h2 class="ur dir-rtl">1. (اے حبیبِ مکرّم!) جب منافق آپ کے پاس آتے ہیں تو کہتے ہیں: ہم گواہی دیتے ہیں کہ آپ یقیناً اللہ کے رسول ہیں، اور اللہ جانتا ہے کہ یقیناً آپ اُس کے رسول ہیں، اور اللہ گواہی دیتا ہے کہ یقیناً منافق لوگ جھوٹے ہیں<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">1. When the hypocrites come to you (O Prophet!), they say: ‘We bear witness that you certainly are the Messenger of Allah.’ And Allah knows that you are indeed His Messenger (blessings and peace be upon him), but Allah bears witness that the hypocrites are surely liars.</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_2">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="2"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo2"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/2/">',
  '<h2 class="ur dir-rtl">2. انہوں نے اپنی قَسموں کو ڈھال بنا رکھا ہے پھر یہ (لوگوں کو) اللہ کی راہ سے روکتے ہیں، بیشک وہ بہت ہی برا (کام) ہے جو یہ لوگ کر رہے ہیں<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">2. They take their (false) oaths as a shield, and then they hinder (others) from the way of Allah. Evil indeed is what they used to do.</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_3">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="3"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo3"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/3/">',
  '<h2 class="ur dir-rtl">3. یہ اِس وجہ سے کہ وہ (زبان سے) ایمان لائے پھر (دل سے) کافر رہے تو اُن کے دلوں پر مُہر لگا دی گئی سو وہ (کچھ) نہیں سمجھتے<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">3. That is because they believed and then abandoned (their) faith. So their hearts were sealed. Hence, they do not understand.</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_4">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="4"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo4"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/4/">',
  '<h2 class="ur dir-rtl">4. (اے بندے!) جب تو انہیں دیکھے تو اُن کے جسم (اور قد و قامت) تجھے بھلے معلوم ہوں، اور اگر وہ باتیں کریں تو اُن کی گفتگو تُو غور سے سنے (یعنی تجھے معقول دکھائی دیں، مگر حقیقت یہ ہے کہ) وہ لوگ گویا دیوار کے سہارے کھڑی کی ہوئی لکڑیاں ہیں، وہ ہر اونچی آواز کو اپنے اوپر (بَلا اور آفت) سمجھتے ہیں، وہی (منافق تمہارے) دشمن ہیں سو اُن سے بچتے رہو، اللہ انہیں غارت کرے وہ کہاں بہکے پھرتے ہیں<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">4. When you see them, their appearance impresses you, and if they speak, you listen to their speech, but they are (just) like dried timbers leaning (against a wall). They think every cry (they hear) is against them. They are the enemy, so beware of them. May Allah destroy them. How perverted they are!</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_5">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="5"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo5"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/5/">',
  '<h2 class="ur dir-rtl">5. اور جب اُن سے کہا جاتا ہے کہ آؤ رسول اللہ (صلی اللہ علیہ وآلہ وسلم) تمہارے لئے مغفرت طلب فرمائیں تو یہ (منافق گستاخی سے) اپنے سر جھٹک کر پھیر لیتے ہیں اور آپ انہیں دیکھتے ہیں کہ وہ تکبر کرتے ہوئے (آپ کی خدمت میں آنے سے) گریز کرتے ہیں٭<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl">٭ یہ آیت عبد اللہ بن اُبیّ (رئیس المنافقین) کے بارے میں نازل ہوئی، جب اسے حضور نبی اکرم صلی اللہ علیہ وآلہ وسلم کی خدمتِ اقدس میں بخشش طلبی کے لئے حاضر ہونے کا کہا گیا تو سر جھٹک کر کہنے لگا: میں نہیں جاتا، میں ایمان بھی لا چکا ہوں، ان کے کہنے پر زکوٰۃ بھی دے دی ہے۔ اب کیا باقی رہ گیا ہے فقط یہی کہ محمد صلی اللہ علیہ وآلہ وسلم کو سجدہ بھی کروں؟ (الطبری، الکشاف، نسفی، بغوی، خازن)۔</h2>',
  '<h2 class="en page_speed_1029578972">5. And when it is said to them: ‘Come! So Allah’s Messenger (blessings and peace be upon him) may seek forgiveness for you,’ they turn their heads aside (rudely), and you see them turning away in arrogance.</h2>',
  '<p class="en page_speed_1425939351">* This verse was sent down concerning ‘Abd Allah b. Ubayy (the chief of the hypocrites). When asked to appear before the presence of the Holy Prophet (blessings and peace be upon him) for seeking forgiveness, he said twisting his head: ‘I will not go. I have believed and have paid Zakat (the Alms-due) on his advice. Now what is left except that I should now prostrate myself before Muhammad?’</p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_6">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="6"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo6"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/6/">',
  '<h2 class="ur dir-rtl">6. اِن (بدبخت گستاخانِ رسول صلی اللہ علیہ وآلہ وسلم) کے حق میں برابر ہے کہ آپ اُن کے لئے استغفار کریں یا آپ ان کے لئے استغفار نہ کریں، اللہ ان کو (تو) ہرگز نہیں بخشے گا (کیونکہ یہ آپ پر طعنہ زنی کرنے والے اور آپ سے بے رخی اور تکبّر کرنے والے لوگ ہیں)۔ بیشک اللہ نافرمان لوگوں کو ہدایت نہیں فرماتا<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">6. It makes no difference for them whether you seek forgiveness for them or do not seek forgiveness for them: Allah will never forgive them (for they mock you and behave arrogantly towards you). Indeed, Allah does not guide the rebellious people.</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_7">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="7"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo7"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/7/">',
  '<h2 class="ur dir-rtl">7. (اے حبیبِ مکرّم!) یہی وہ لوگ ہیں جو (آپ سے بُغض و عِناد کی بنا پر) یہ (بھی) کہتے ہیں کہ جو (درویش اور فقراء) رسول اللہ (صلی اللہ علیہ وآلہ وسلم) کی خدمت میں رہتے ہیں اُن پر خرچ مت کرو (یعنی ان کی مالی اعانت نہ کرو) یہاں تک کہ وہ (سب انہیں چھوڑ کر) بھاگ جائیں (منتشر ہوجائیں)، حالانکہ آسمانوں اور زمین کے سارے خزانے اللہ ہی کے ہیں لیکن منافقین نہیں سمجھتے<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">7. They are the ones who say: ‘Do not spend (anything) on those who remain (as devotees) in the presence of the Messenger of Allah until they break away (from him).’ And to Allah belong the treasures of the heavens and the earth, but the hypocrites do not understand.</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_8">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="8"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo8"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/8/">',
  '<h2 class="ur dir-rtl">8. وہ کہتے ہیں: اگر (اب) ہم مدینہ واپس ہوئے تو (ہم) عزّت والے لوگ وہاں سے ذلیل لوگوں (یعنی مسلمانوں) کو باہر نکال دیں گے، حالانکہ عزّت تو صرف اللہ کے لئے اور اس کے رسول (صلی اللہ علیہ وآلہ وسلم) کے لئے اور مومنوں کے لئے ہے مگر منافقین (اس حقیقت کو) جانتے نہیں ہیں<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">8. They say: ‘If we return to Medina, then (we) the honourable will surely expel the dishonourable (i.e. the Muslims) from it.’ But all honour belongs to Allah, His Messenger and the believers. However, the hypocrites do not understand.</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_9">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="9"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo9"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/9/">',
  '<h2 class="ur dir-rtl">9. اے ایمان والو! تمہارے مال اور تمہاری اولاد (کہیں) تمہیں اللہ کی یاد سے ہی غافل نہ کر دیں، اور جو شخص ایسا کرے گا تو وہی لوگ نقصان اٹھانے والے ہیں<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">9. O believers! Do not let your possessions or your children divert you from the remembrance of Allah. For whoever does that, it is they who are the losers.</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_10">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="10"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo10"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/10/">',
  '<h2 class="ur dir-rtl">10. اور تم اس (مال) میں سے جو ہم نے تمہیں عطا کیا ہے (اللہ کی راہ میں) خرچ کرو قبل اِس کے کہ تم میں سے کسی کو موت آجائے پھر وہ کہنے لگے: اے میرے رب! تو نے مجھے تھوڑی مدت تک کی مہلت اور کیوں نہ دے دی کہ میں صدقہ و خیرات کرلیتا اور نیکوکاروں میں سے ہو جاتا<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">10. Spend (in charity) from whatever We have provided you before death comes upon one of you, and he says: ‘O my Lord! If only You would grant me respite for a while so I could give charity and be among the righteous?’</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_11">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="63" data-ayat="11"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo11"><a class="ayat-div" href="/english/Surah-al-Munafiqun-with-english-translation/11/">',
  '<h2 class="ur dir-rtl">11. اور اللہ ہرگز کسی شخص کو مہلت نہیں دیتا جب اس کی موت کا وقت آجاتا ہے، اور اللہ اُن کاموں سے خوب آگاہ ہے جو تم کرتے ہو<span class="page_speed_188414072">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1029578972">11. Allah shall never grant respite to a soul when its appointed time (of death) has arrived. And Allah is All-Aware of what you do.</h2>',
  '<p class="en page_speed_1425939351"></p>',
  '</a></div></div>',
  '<div data-type="ur" class="item sortable-item"><span class="text">Urdu</span></div>',
  '<div data-type="en" class="item sortable-item"><span class="text">English - Manifest</span></div>',
]);

export const AL_IKHLAS_PAGE = page([
  '<div class="brows-job-list ayatno_" id="ayatno_1">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="112" data-ayat="1"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo1"><a class="ayat-div" href="/english/Surah-al-Ikhlas-with-english-translation/1/">',
  '<h2 class="ur dir-rtl">1. (اے نبئ مکرّم!) آپ فرما دیجئے: وہ اللہ ہے جو یکتا ہے<span class="page_speed_2117637003">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1672101713">1. Say: ‘He is Allah, the Unique One.</h2>',
  '<p class="en page_speed_93320091"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_2">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="112" data-ayat="2"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo2"><a class="ayat-div" href="/english/Surah-al-Ikhlas-with-english-translation/2/">',
  '<h2 class="ur dir-rtl">2. اللہ سب سے بے نیاز، سب کی پناہ اور سب پر فائق ہے<span class="page_speed_2117637003">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1672101713">2. Allah is Self-Sufficient and the Most Superior Sustainer upon whom all depend.</h2>',
  '<p class="en page_speed_93320091"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_3">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="112" data-ayat="3"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo3"><a class="ayat-div" href="/english/Surah-al-Ikhlas-with-english-translation/3/">',
  '<h2 class="ur dir-rtl">3.  نہ اس سے کوئی پیدا ہوا ہے اور نہ ہی وہ پیدا کیا گیا ہے<span class="page_speed_2117637003">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1672101713">3. He neither begets nor was He begotten (i.e. He is neither a father nor a son).</h2>',
  '<p class="en page_speed_93320091"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_4">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="112" data-ayat="4"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo4"><a class="ayat-div" href="/english/Surah-al-Ikhlas-with-english-translation/4/">',
  '<h2 class="ur dir-rtl">4. اور نہ ہی اس کا کوئی ہمسر ہے<span class="page_speed_2117637003">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1672101713">4. And none is equal (or comparable) to Him.’</h2>',
  '<p class="en page_speed_93320091"></p>',
  '</a></div></div>',
  '<div data-type="ur" class="item sortable-item"><span class="text">Urdu</span></div>',
  '<div data-type="en" class="item sortable-item"><span class="text">English - Manifest</span></div>',
]);

export const AL_KAWTHAR_PAGE = page([
  '<div class="brows-job-list ayatno_" id="ayatno_1">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="108" data-ayat="1"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo1"><a class="ayat-div" href="/english/Surah-al-Kawthar-with-english-translation/1/">',
  '<h2 class="ur dir-rtl">1. بیشک ہم نے آپ کو (ہر خیر و فضیلت میں) بے انتہا کثرت بخشی ہے٭<span class="page_speed_1364871071">o</span></h2>',
  '<h2 class="ur dir-rtl">کوثر سے مراد حوض کوثر یا نہر جنت بھی ہے اور قرآن اور نبوت و حکمت بھی، فضائل و معجزات کی کثرت یا اصحاب و اتباع اور امت کی کثرت بھی مراد لی گئی ہے۔ رفعت ذکر اور خلق عظیم بھی مراد ہے اور دنیا و آخرت کی نعمتیں بھی، نصرت الٰہیہ اور کثرت فتوحات بھی مراد ہیں اور روز قیامت مقام محمود اور شفاعت عظمیٰ بھی مراد لی گئی ہے۔</h2>',
  '<h2 class="en page_speed_482181316">1. (O Prophet!) Indeed, We have granted you an infinite abundance of goodness.*</h2>',
  '<p class="en page_speed_1483626782">* There are numerous meanings of <i>al-Kawthar</i> mentioned by the great scholars. According to the most popular view, it is the abundant goodness that Allah has bestowed upon His beloved Messenger (blessings and peace be upon him). According to another widespread opinion, it is a river in Paradise whose banks are of gold and its water flows over rubies and pearls. The scent of this water is finer than musk and sweeter than honey and it is whiter than milk. It also refers to the greater intercession upon the praised station gifted to the Prophet Muhammad (blessings and peace be upon him) on the Day of Judgement. It also refers to the highly esteemed status of his Prophethood. It also refers to the Prophet’s numerous miracles and exclusive virtues. It also refers to the Prophet’s unimaginable expanse in knowledge. Some commentators say that it refers to the abundance of the Prophet’s progeny. Moreover, it may also refer to the abundance of great scholars in his <i>Umma</i>. It may also refer to the uncountable virtues of the Qur’an and Islam. It may also refer to the abundance of his lovers, followers and community members compared to all other communities. It also refers to the abundance of his beautiful moral values and spiritual virtues of his noble conduct. It also refers to the unlimited blessings and favours of Allah Almighty bestowed upon the esteemed Prophet (blessings and peace be upon him) in this world and the Hereafter. It also refers to the everlasting remembrance of the Holy Prophet (blessings and peace be upon him) and the inseparable mentioning of his name along with the name and remembrance of Almighty Allah.</p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_2">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="108" data-ayat="2"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo2"><a class="ayat-div" href="/english/Surah-al-Kawthar-with-english-translation/2/">',
  '<h2 class="ur dir-rtl">2. پس آپ اپنے رب کے لئے نماز پڑھا کریں اور قربانی دیا کریں (یہ ہدیۂ تشکرّ ہے)<span class="page_speed_1364871071">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_482181316">2. So pray to your Lord and offer sacrifice.</h2>',
  '<p class="en page_speed_1483626782"></p>',
  '</a></div></div>',
  '<div class="brows-job-list ayatno_" id="ayatno_3">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="108" data-ayat="3"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo3"><a class="ayat-div" href="/english/Surah-al-Kawthar-with-english-translation/3/">',
  '<h2 class="ur dir-rtl">3. بیشک آپ کا دشمن ہی بے نسل اور بے نام و نشاں ہوگا<span class="page_speed_1364871071">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_482181316">3. Indeed, your enemy shall be the one without posterity. (Or: indeed, your enemy shall be the one cut off from all goodness.)</h2>',
  '<p class="en page_speed_1483626782"></p>',
  '</a></div></div>',
  '<div data-type="ur" class="item sortable-item"><span class="text">Urdu</span></div>',
  '<div data-type="en" class="item sortable-item"><span class="text">English - Manifest</span></div>',
]);

export const AZ_ZUMAR_31_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_31">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="39" data-ayat="31"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo31"><a class="ayat-div" href="/english/Surah-az-Zumar-with-english-translation/31/">',
  '<h2 class="ur dir-rtl">31. پھر بلاشبہ تم لوگ قیامت کے دن اپنے رب کے حضور باہم جھگڑا کروگے*<span class="page_speed_429588967">o</span></h2>',
  '<h2 class="ur dir-rtl">* ایک گروہ دوسرے کو کہے گا کہ ہمیں مقامِ نبوّت اور شانِ رسالت کو سمجھنے سے تم نے روکا تھا، وہ کہیں گے: نہیں تم خود ہی بدبخت اور گمراہ تھے۔</h2>',
  '<h2 class="en page_speed_1893945610">31. Then, on the Day of Resurrection, you will dispute with one another before your Lord.*</h2>',
  '<p class="en page_speed_1842245304">* One group will say to the other: ‘You stopped us from understanding the esteemed station of the Prophet and accepting his glorious message.’ Others will reply: ‘No, you were misguided yourselves.’</p>',
  '</a></div></div>',
]);

export const ASH_SHURA_52_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_52">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="42" data-ayat="52"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo52"><a class="ayat-div" href="/english/Surah-ash-Shura-with-english-translation/52/">',
  '<h2 class="ur dir-rtl">52. سو اسی طرح ہم نے آپ کی طرف اپنے حکم سے روحِ (قلوب و ارواح) کی وحی فرمائی (جو قرآن ہے)، اور آپ (وحی سے قبل اپنی ذاتی درایت و فکر سے) نہ یہ جانتے تھے کہ کتاب کیا ہے اور نہ ایمان (کے شرعی احکام کی تفصیلات کو ہی جانتے تھے جو بعد میں نازل اور مقرر ہوئیں)(1) مگر ہم نے اسے نور بنا دیا۔ ہم اِس (نور) کے ذریعہ اپنے بندوں میں سے جسے چاہتے ہیں ہدایت سے نوازتے ہیں، اور بیشک آپ ہی صراطِ مستقیم کی طرف ہدایت عطا فرماتے ہیں(2)<span class="page_speed_993339367">o</span></h2>',
  '<h2 class="ur dir-rtl">1:- آپ صلی اللہ علیہ وآلہ وسلم کی شانِ اُمّیت کی طرف اشارہ ہے تاکہ کفّار آپ کی زبان سے قرآن کی آیات اور ایمان کی تفصیلات سن کر یہ بدگمانی نہ پھیلائیں کہ یہ سب کچھ حضرت محمد مصطفی صلی اللہ علیہ وآلہ وسلم نے اپنے ذاتی علم اور تفکر سے گھڑ لیا ہے کچھ نازل نہیں ہوا، سو یہ اَز خود نہ جاننا حضور صلی اللہ علیہ وآلہ وسلم کا عظیم معجزہ بنا دیا گیا۔ 2:- اے حبیب! آپ کا ہدایت دینا اور ہمارا ہدایت دینا دونوں کی حقیقت ایک ہی ہے اور صرف انہی کو ہدایت نصیب ہوتی ہے جو اس حقیقت کی معرفت اور اس سے وابستگی رکھتے ہیں۔</h2>',
  '<h2 class="en page_speed_141907104">52. Thus have We revealed to you the Spirit of Our command (i.e. the Qur’an). You did not know (before the revelation) what the Book was nor (the details of) the faith.* But We made it a Light by which We may guide whomever We wish among Our servants. And indeed, you guide (people)to the straight path.</h2>',
  '<p class="en page_speed_1831169097">* This verse refers to the unique status of the Holy Prophet (blessings and peace be upon him) as being an <i>Ummi</i>, not tutored by anyone to read or write. So, after hearing the verses of the Qur’an and the details of the faith, the disbelievers may not have any plausible reason to accuse him of being the inventor of the Book through acquired knowledge and scholarship.</p>',
  '</a></div></div>',
]);

export const MUHAMMAD_19_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_19">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="47" data-ayat="19"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo19"><a class="ayat-div" href="/english/Surah-Muhammad-with-english-translation/19/">',
  '<h2 class="ur dir-rtl">19. پس جان لیجیے کہ اللہ کے سوا کوئی معبود نہیں اور آپ (اظہارِ عبودیت اور تعلیمِ امت کی خاطر اللہ سے) معافی مانگتے رہا کریں کہ کہیں آپ سے (اپنی شان اقدس اور خصوصی عظمت و رِفعت کے تناظر میں) خلافِ اَولیٰ فعل صادر نہ ہو جائے* اور مومن مردوں اور مومن عورتوں کے لیے بھی طلبِ مغفرت (یعنی ان کی شفاعت) فرماتے رہا کریں (یہی ان کا سامان بخشش ہے)، اور (اے لوگو!) اللہ (دنیا میں) تمہارے چلنے پھرنے کے ٹھکانے اور (آخرت میں) تمہارے ٹھہرنے کی منزلیں (سب) جانتا ہے<span class="page_speed_1397614354">o</span></h2>',
  '<h2 class="ur dir-rtl">٭ (حالانکہ وہ فعل اپنی جگہ شرعاً بالکل جائز بلکہ مستحسن ہو گا مگر آپ صلی اﷲ علیہ وآلہ وسلم کا مقام و مرتبہ اور عظمت و رِفعت محض جواز اور استحسان کے مراتب سے بھی بہت بلند اور اَرفع و اَعلیٰ ہے)</h2>',
  '<h2 class="en page_speed_1274865235">19. Know that there is no god except Allah, and (O Prophet!) seek (Allah’s) protection from any action unworthy of your esteemed station. And (also) seek (His) pardon for the believing men and the believing women. And (O people!) Allah fully knows (about) your movements and your final abode (in the Hereafter).</h2>',
  '<p class="en page_speed_1300036006">* Given that the action may be a pious deed compatible with Islamic law, rather an act par excellence, your august station, majesty and exaltation is far elevated and dignified than mere permissibility and higher grades of moral excellence.</p>',
  '</a></div></div>',
]);

export const AT_TAWBAH_29_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_29">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="9" data-ayat="29"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo29"><a class="ayat-div" href="/english/Surah-at-Tawbah-with-english-translation/29/">',
  '<h2 class="ur dir-rtl">29. (اے مسلمانو!) تم اہلِ کتاب میں سے ان لوگوں کے ساتھ (بھی جوابی) جنگ کرو (جنہوں نے تمہارے ساتھ مدینہ میں کیے ہوئے معاہدۂ اَمن کو توڑ کر، جلا وطنی کے باوُجود جنگ اَحزاب میں مدینہ پر حملہ آور کفارِ مکہ کی اَفواج کی بھرپور مدد کی اور اب بھی تمہارے خلاف تمام ممکنہ سازشیں جاری رکھے ہوئے ہیں) جو نہ اللہ پر ایمان رکھتے ہیں نہ یومِ آخرت پر اور نہ ان چیزوں کو حرام جانتے ہیں جنہیں اللہ اور اس کے رسول (صلی اللہ علیہ وآلہ وسلم) نے حرام قرار دیا ہے اور نہ ہی دینِ حق اختیارکرتے ہیں، یہاں تک کہ وہ (ریاست کے دستور اور نظام کے) تابع ہو کر اپنے ہاتھ سے ریاستی حفاظت کا ٹیکس (جو عسکری خدمات سے اِستثناء کی صورت میں وصول کیا جاتا ہے) ادا کریں<span class="page_speed_981314611">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_684456012">29. Fight (the treacherous people) among those given the book who do not believe in Allah, nor the Last Day, nor do they forbid what Allah and His Messenger have forbidden, nor do they practise the true religion (instead, they have breached the Treaty of Medina by committing an act of treason against the state), until they pay the indemnity tax (al-Jizya) with a willing hand*, and they submit to the command of the state.**</h2>',
  '<p class="en page_speed_117091857">* Jizya legally refers to an indemnity tax received from non-Muslim combatants who surrendered to the Muslim State through a treaty, demanding their security, indemnity from military services and exemption from prescribed alms, payable to the state. These non-Muslims were not citizens of the state; instead, they were security seekers after surrendering from the battlefield. They used to contribute tax to military defence for their exemption from army services, whereas, in contrast, Muslim citizens would offer their personal services for the protection of the state whenever invaded by their enemies. The Jizya tax would also exempt those non-Muslims from Zakat and Kharaj taxes (trade and agricultural taxes), which were obligatory for Muslims. This particular category of non-Muslims, being non-citizens, were known as ‘Treaty People’ (Ahl al-Dhimma) or ‘Covenant Holders’. The Islamic State would provide them with all rights of security, equality and freedom against the tax, known as Jizya, which means reward or compensation. Women, children, the elderly, the clergy, the poor, the sick and those unable to work were exempt from this tax. Those who opted to join the army were also exempt. Instead, the poor among them were supported financially by the state. The Muslim rulers would refund the Jizya, if they failed to protect their lives or possessions. This kind of taxation system has existed since ancient times; the Old Testament and the New Testament in the Bible provide several references regarding this practice. Islam did not introduce it; instead, Islam introduced many humanitarian reforms in this old existing tradition among the nations. This term does not entail disgrace, inequality or humiliation of non-Muslims, nor does it uniformly apply to any non-Muslim citizen of a Muslim state.\n\n** This verse refers to a retributive or punitive action taken against certain tribes, such as Qurayza and al-Nadir, who, in violation of the terms of alliance and the constitution, had supported the Meccan armies during their invasions of Medina, particularly in the battle of the confederates (al-Ahzab) by mobilizing them and providing them arms, ammunition and strategic information. Such punitive action against any party who breached the peace treaty and acted treacherously was repeatedly demanded in various articles of the constitution of Medina, jointly signed by the Jews and the Muslims years before.</p>',
  '</a></div></div>',
]);

export const AT_TAWBAH_101_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_101">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="9" data-ayat="101"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo101"><a class="ayat-div" href="/english/Surah-at-Tawbah-with-english-translation/101/">',
  '<h2 class="ur dir-rtl">101. اور (مسلمانو!) تمہارے گرد و نواح کے دیہاتی گنواروں میں بعض منافق ہیں اور بعض باشندگانِ مدینہ بھی، یہ لوگ نفاق پر اڑے ہوئے ہیں، آپ انہیں (اب تک) نہیں جانتے، ہم انہیں جانتے ہیں (بعد میں حضور صلی اللہ علیہ وآلہ وسلم کو بھی جملہ منافقین کا علم اور معرفت عطا کر دی گئی)۔ عنقریب ہم انہیں دو مرتبہ (دنیا ہی میں) عذاب دیں گے٭ پھر وہ (قیامت میں) بڑے عذاب کی طرف پلٹائے جائیں گے<span class="page_speed_981314611">o</span></h2>',
  '<h2 class="ur dir-rtl">٭ ایک بار جب ان کی پہچان کرا دی گئی اور حضور صلی اللہ علیہ وآلہ وسلم نے خطبۂ جمعہ کے دوران ان منافقین کو نام لے لے کر مسجد سے نکال دیا، یہ پہلا عذاب بصورتِ ذلت و رسوائی تھا؛ اور دوسرا عذاب بصورتِ ہلاکت و مُقاتلہ ہوا جس کا حکم بعد میں آیا۔</h2>',
  '<h2 class="en page_speed_684456012">101. (O believers!) Some of the Bedouins who dwell (in the deserts) around you are hypocrites, and some of the town people (of Medina) have grown bold in hypocrisy. You do not know them, but We know them well. We shall punish them twice. Then, they will be returned to (face) a grievous punishment (in the Hereafter).</h2>',
  '<p class="en page_speed_117091857">* Firstly, they were identified and the Holy Messenger (blessings and peace be upon him) expelled them from the Mosque pointing them out by name during his Friday address. This was the first torment in the form of humiliation and ignominy. Secondly, they were punished through fighting and killings, for which the command came later.</p>',
  '</a></div></div>',
]);

export const AN_NUR_35_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_35">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="24" data-ayat="35"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo35"><a class="ayat-div" href="/english/Surah-an-Nur-with-english-translation/35/">',
  '<h2 class="ur dir-rtl">35. اللہ آسمانوں اور زمین کا نور ہے۔ اس کے نور کی مثال (جو نورِ محمدی کی شکل میں دنیا میں روشن ہے) اُس طاق (نما سینۂ اَقدس) جیسی ہے جس میں چراغِ (نبوت روشن) ہے؛ (وہ) چراغ (قلبِ محمدی کے) فانوس میں رکھا ہے۔ (یہ) فانوس (نورِ الٰہی کے پَرتو سے اس قدر منور ہے) گویا ایک درخشندہ ستارہ ہے (یہ چراغِ نبوت) جو زیتون کے مبارک درخت سے (یعنی عالم قدس کے بابرکت رابطہ وحی سے یا انبیاء و رُسل ہی کے مبارک شجرۂ نبوت سے) روشن ہوا ہے نہ (فقط) شرقی ہے اور نہ غربی (بلکہ اپنے فیضِ نور کی وسعت میں عالم گیر ہے)۔ ایسا معلوم ہوتا ہے کہ اس کا تیل (خود ہی) چمک رہا ہے اگرچہ ابھی اسے (وحیِ ربّانی اور معجزاتِ آسمانی کی) آگ نے چھوا بھی نہیں۔ (وہ) نور کے اوپر نور ہے (یعنی نورِ وجود پر نورِ نبوت گویا وہ ذات دوہرے نور کا پیکر ہے)۔ اللہ جسے چاہتا ہے اپنے نور (کی معرفت) تک پہنچا دیتا ہے، اور اللہ لوگوں (کی ہدایت) کے لیے مثالیں بیان فرماتا ہے، اور اللہ ہر چیز سے خوب آگاہ ہے٭<span class="page_speed_1793167989">o</span></h2>',
  '<h2 class="ur dir-rtl">٭ یہ حضرت عبد ﷲ بن عباس اور عبد ﷲ بن عمر رضی اللہ عنہ کے علاوہ تابعین میں سے کعب الاحبار، سعید بن جبیر، ابو العالیہ اور الضحاک بن مزاحم کا بیان کردہ معنی ہے؛ جسے امام عبد بن حمید، ابن جریر الطبری، ابن المنذر، ابن ابی حاتم الرازی، ابو منصور الماتریدی، الطبرانی، ابو اللیث السمرقندی، السلمی، ابو اسحاق الثعلبی، مکی بن ابی طالب المقری، البغوی، القاضی عیاض، ابن عطیہ، ابن الجوزی، فخر الدین الرازی، القرطبی، ابن حیان، ابن القیم، ابو حفص الحنبلی، السیوطی، القسطلانی، الآلوسی اور دیگر بہت سے مفسرین نے بیان کیا ہے۔</h2>',
  '<h2 class="en page_speed_678436958">35. Allah is the Light of the heavens and the earth. His Light is like a niche in which there is a lamp (and) the lamp is in a glass. The glass seems like a glittering star, kindled from a blessed olive tree. It is neither Eastern nor Western (rather universal in its luminosity). Its oil would almost shine, even if no fire touched it. Light upon light! Allah guides whomever He pleases to His Light. And Allah draws such parables for people, and Allah is All-Knowing of everything.*</h2>',
  '<p class="en page_speed_1627832908">* The likeness of Allah’s Light refers to the light of Prophet Muhammad (blessings and peace be upon him). The niche refers to his sacred breast wherein the lamp of Prophethood is glowing. This lamp of Prophethood is placed in a glass, which is the radiant heart of the Prophet Muhammad (blessings and peace be upon him). This glass is shining like a glittering star. This lamp is lit with the sacred olive tree, which may refer to the blessing of Divine revelation or the blissful genealogical tree of the Prophets and the Messengers (peace be upon them). The blessing of Prophethood or the guidance of Divine revelation is neither Eastern nor Western. Instead, it is a universal and timeless guidance. This lamp of Muhammad’s Prophethood is almost shining due to its inherent qualities even before revelation had touched him. This Light of Prophethood radiates under the Light of the Holy Essence of God. In such a way, Allah guides people to understand the reality of His Light.\n<br><br>\n‘Abd Allah b. ‘Abbas (may God be pleased with both of them), ‘Abd Allah b. ‘Umar (may God be pleased with both of them), Ka‘b al-Ahbar, Sa‘id b. Jubayr, Abu al-‘Aliya and al-Dahhak b. Mazahim have described these meanings of the Verse of Light. ‘Abd b. Humayd, Ibn Jarir al-Tabari, Ibn al-Mundhir, Ibn Abi Hatim al-Razi, Abu Mansur al-Maturidi, al-Tabarani, Abu al-Layth al-Samarqandi, al-Sulami, Abu Ishaq al-Tha‘labi, Makki b. Abi Talib al-Muqri, al-Baghawi, al-Qadi ‘Iyad, Ibn ‘Atiyya, Ibn al-Jawzi, Fakhr al-Din al-Razi, al-Qurtubi, Ibn Hayyan, Ibn al-Qayyim, Abu Hafs al-Hanbali, al-Suyuti, al-Qastallani, al-Alusi and many other exegetes have reported the above-mentioned meanings. The parable of the light may also refer to the light in the heart of the believers. The niche can be the breast of the believers, the lamp can be the Qur’an and faith, and the glass can be the heart of the believers. Many other such interpretations have also been given for the Verse of Light.</p>',
  '</a></div></div>',
]);

export const AL_AHZAB_6_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_6">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="33" data-ayat="6"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo6"><a class="ayat-div" href="/english/Surah-al-Ahzab-with-english-translation/6/">',
  '<h2 class="ur dir-rtl">6. یہ نبیِ (مکرّم) مومنوں کے ساتھ اُن کی جانوں سے زیادہ قریب اور حق دار ہیں اور آپ کی اَزواجِ (مطہّرات) اُن کی مائیں ہیں، اور خونی رشتہ دار اللہ کی کتاب میں (دیگر) مومنین اور مہاجرین کی نسبت (تقسیمِ وراثت میں) ایک دوسرے کے زیادہ حق دار ہیں سوائے اس کے کہ تم اپنے دوستوں پر احسان کرنا چاہو، یہ حکم کتابِ (الٰہی) میں لکھا ہوا ہے<span class="page_speed_1346021979">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1010692381">6. The Prophet (blessings and peace be upon him) is closer to the believers than their (own) souls,* while his wives are their mothers. The blood relatives are more entitled to inherit from one another according to the Book of Allah than (the rest of) the believers and the emigrants unless you show kindness to your close friends (through bequest). All this is written in the Book.</h2>',
  '<p class="en page_speed_467896041">* </p>',
  '</a></div></div>',
]);

export const AL_AHZAB_37_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_37">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="33" data-ayat="37"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo37"><a class="ayat-div" href="/english/Surah-al-Ahzab-with-english-translation/37/">',
  '<h2 class="ur dir-rtl">37. اور (اے حبیب!) یاد کیجئے جب آپ نے اس شخص سے فرمایا جس پر اللہ نے انعام فرمایا تھا اور اس پر آپ نے (بھی) اِنعام فرمایا تھا کہ تُو اپنی بیوی (زینب) کو اپنی زوجیت میں روکے رکھ اور اللہ سے ڈر، اور آپ اپنے دل میں وہ بات٭ پوشیدہ رکھ رہے تھے جِسے اللہ ظاہر فرمانے والا تھا اور آپ (دل میں حیاءً) لوگوں (کی طعنہ زنی) کا خوف رکھتے تھے۔ (اے حبیب! لوگوں کو خاطر میں لانے کی کوئی ضرورت نہ تھی) اور فقط اللہ ہی زیادہ حق دار ہے کہ آپ اس کا خوف رکھیں (اور وہ آپ سے بڑھ کر کس میں ہے؟)، پھر جب (آپ کے متبنٰی) زید نے اسے طلاق دینے کی غرض پوری کرلی، تو ہم نے اس سے آپ کا نکاح کر دیا تاکہ مومنوں پر ان کے منہ بولے بیٹوں کی بیویوں (کے ساتھ نکاح) کے بارے میں کوئی حَرج نہ رہے جبکہ (طلاق دے کر) وہ ان سے بے غَرض ہو گئے ہوں، اور اللہ کا حکم تو پورا کیا جانے والا ہی تھا<span class="page_speed_1346021979">o</span></h2>',
  '<h2 class="ur dir-rtl">٭: (کہ زینب کی تمہارے ساتھ مصالحت نہ ہو سکے گی اور منشاء ایزدی کے تحت وہ طلاق کے بعد اَزواجِ مطہرات میں داخل ہوں گی۔)</h2>',
  '<h2 class="en page_speed_1010692381">37. And (remember) when you said to him whom Allah had blessed, and you (too) had blessed: ‘Retain your wife for yourself (in the bond of marriage) and be God-conscious.’ And you had concealed (the secret) within yourself; what Allah would reveal (later). And (out of decency) you were worried about the people (that they might misunderstand the situation). Whereas it is more befitting that you consider Allah’s command fearfully. But when (your adopted son) Zayd gave up his claim upon her (through divorce), We wedded her to you. So, there should be no restriction for the believers in (marrying) the ex-wives of their adopted sons when they have finished their marital relationship with them. And Allah’s command is bound to be fulfilled.</h2>',
  '<p class="en page_speed_467896041">* This verse refers to the inability of Zaynab bint Jahsh to reconcile with Zayd b. Haritha because she insisted on getting a divorce. According to another report, Zayd insisted on divorcing her. Since Zayd and Zaynab came from two different social classes, the marriage was not successful, despite the Prophet’s advice to them on several occasions to retain the marriage. In contrast, Allah had willed that Zaynab would be wedded to the Prophet (blessings and peace be upon him) after her divorce. The Prophet (blessings and peace be upon him) was worried that people would misunderstand the situation. Hence, this verse was revealed.</p>',
  '</a></div></div>',
]);

export const AN_NAJM_39_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_39">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="53" data-ayat="39"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo39"><a class="ayat-div" href="/english/Surah-an-Najm-with-english-translation/39/">',
  '<h2 class="ur dir-rtl">39. اور یہ کہ انسان کو (عدل میں) وہی کچھ ملے گا جس کی اُس نے کوشش کی ہوگی (رہا فضل اس پر کسی کا حق نہیں وہ محض اللہ کی عطاء و رضا ہے جس پر جتنا چاہے کر دے)<span class="page_speed_1032486696">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_1162095385">39. And that nothing belongs to human being (as his right) except what he strives for.*</h2>',
  '<p class="en page_speed_1871421829">As for Allah’s Grace, there are no limits. He can grant whatever He wills to whomever He pleases, as stated in <i>Sura al-Nur</i>, verse 38: <i>“So that Allah may reward them for the best of what they have performed and give them more out of His grace. And Allah provides for whomever He pleases without any measure.”</i></p>',
  '</a></div></div>',
]);

export const AN_NISA_34_ROW = lines([
  '<div class="brows-job-list ayatno_" id="ayatno_34">',
  '<div class="ayat-row-controls"><button type="button" class="ayat-menu-trigger" title="Options" data-sura="4" data-ayat="34"></button></div>',
  '<div class="col-md-12 col-sm-12" id="joo34"><a class="ayat-div" href="/english/Surah-an-Nisa-with-english-translation/34/">',
  '<h2 class="ur dir-rtl">34. مَرد عورتوں (کی معاشی اور سکونتی ضروریات کی کفالت) کے ذِمہ دار اور منتظم ہیں اس لیے کہ اللہ نے ان میں سے بعض کو بعض پر فضیلت دی ہے اور اس وجہ سے (بھی) کہ مرد (ان پر) اپنے مال خرچ کرتے ہیں، پس نیک بیویاں اطاعت شعار ہوتی ہیں شوہروں کی عدم موجودگی میں اللہ کی حفاظت کے ساتھ (اپنی عزت کی) حفاظت کرنے والی ہوتی ہیں۔ اور تمہیں جن عورتوں کی نافرمانی و سرکشی کا اندیشہ ہو تو اُنہیں نصیحت کرو اور (اگر نہ سمجھیں تو) اُنہیں خواب گاہوں میں (خود سے) علیحدہ کر دو اور (اگر پھر بھی اِصلاح پذیر نہ ہوں تو) اُن سے (تادیباً) عارضی طور پر الگ ہو جاؤ؛ پھر اگر وہ (رضائے الٰہی کے لیے) تمہارے ساتھ تعاون کرنے لگیں تو ان کے خلاف کوئی راستہ تلاش نہ کرو۔ بے شک اللہ سب سے بلند سب سے بڑا ہے<span class="page_speed_925989838">o</span></h2>',
  '<h2 class="ur dir-rtl"></h2>',
  '<h2 class="en page_speed_341136627">34. Men are the caretakers of women (maintaining their financial and housing needs) through the blessings Allah has graced upon some of them above others and through what they spend out of their wealth (to support others). So righteous women are sincere, pious and guarding what Allah has (entrusted them to keep) protected in the absence (of their husbands). As for those (wives) you fear rebellious conduct on their part, (first) advise them, and (if ineffective) leave them alone in their beds, and (as a last resort) turn them away (from yourselves, striking a temporary separation)*. Then, if they cooperate with you, do not seek any course (of action) against them. Indeed, Allah is All-Exalted, All-Great.</h2>',
  '<p class="en page_speed_1698440172"><a class="ayat-div" href="/english/Surah-an-Nisa-with-english-translation/34/">* For details about this translation and the linguistic and legal implications of ‘<i>wadribuhunna</i>’, see </a><a href="/english/tid/57724/Appendix-The-Linguistic-and-Legal-Im-plications-of-Wadribuhunna-in-Sura-al-Nisa-434.html">appendix</a>.</p>',
  '</a></div></div>',
]);
