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
