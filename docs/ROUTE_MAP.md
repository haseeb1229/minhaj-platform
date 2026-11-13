# Route Map & SEO Contract — One Minhaj Platform

**Status:** Living canonical baseline for the current accepted repository. Updated in the same
task as any accepted change that directly affects it (DELIVERY_PLAN.md §5.1).
**Origin:** Phase 0A Architecture Freeze, revised after independent architecture audit, and
revised continuously through the delivered phases.
**Document type:** Routing surface and SEO contract. The target routing surface is stated
throughout; "Delivered in Phase N" notes record the routes each accepted phase implemented. This
document authorises no implementation by itself.

---

## 1. Locale routing

### 1.1 Strategy

**English addresses are unprefixed; Urdu and Arabic carry their locale segment** (owner decision,
Rebaseline R1, 2026-11-06 — OPEN_DECISIONS.md §8).

```
/...           English     e.g. /  ·  /library  ·  /watch/videos/{slug}
/ur/...        Urdu        e.g. /ur  ·  /ur/library
/ar/...        Arabic      e.g. /ar  ·  /ar/watch/videos/{slug}
```

**One canonical address per interface locale still holds.** Every `/en` and `/en/…` request is
answered with **one 301** to the unprefixed English address, query preserved; where the same
request also needs a slug-history 301 (§1.4), the two are merged into that single hop. So
`/quran` and `/en/quran` never coexist as two answering URLs — the anti-duplicate rationale
(duplicate URLs, split search authority, unstable canonical links for a corpus meant to be cited
for decades) is met by the permanent redirect rather than by a mandatory prefix.

**Locale resolution is deterministic: the address alone decides the interface language.** No
cookie and no `Accept-Language` header ever redirects an unprefixed URL; there is no locale
cookie at all. `/` is the English home and answers **200**. A shared link shows every visitor the
same language, and a crawler sees what a visitor sees. (next-intl `localePrefix: 'as-needed'`,
`localeDetection: false`, `localeCookie: false` — `apps/web/src/i18n/routing.ts`.)

**Every localised pathname is built by one helper and parsed by one helper**:
`localizedPath(locale, path)` and `splitLocalePath(pathname)` in
`packages/contracts/src/locale-path.ts` (`UNPREFIXED_LOCALE = 'en'`). Links, redirects, canonical
URLs, alternates and the proxy therefore cannot disagree about what a localised address looks
like. `LegacyMapping` (§9.7) is **not** used for locale redirects. The change was made before
public indexing (§9.5), so no search equity was affected.

> **Historical, superseded by Rebaseline R1 (2026-11-06).** From Phase 3A until R1 every route
> carried an explicit `/{locale}/` segment (`locale ∈ { en, ur, ar }`), there was no unprefixed
> variant, and `/` (or any unprefixed path) answered a **307** to a locale resolved from the
> stored preference cookie, then `Accept-Language`, then `en`. That resolution order, the
> locale cookie and the 307 no longer exist. Examples elsewhere in the docs written as
> `/{locale}/…` describe the internal route tree (`app/[locale]/…`); the public English address
> of such a route is its unprefixed form.

**This policy is implemented by the application's routing layer together with next-intl.**
It is not built-in framework behaviour. It is delivered **once**, in the Localisation Foundation
phase (DELIVERY_PLAN.md, Phase 3A), **before any phase is required to deliver en/ur/ar routes** —
including the authentication surfaces of §4. No later phase re-implements it; Rebaseline R1
changed its URL shape in that one routing layer (the proxy, `i18n/routing.ts` and the
locale-path helper) rather than re-implementing it elsewhere.

### 1.2 Locale properties

| Locale | Language | Direction |
|---|---|---|
| `en` | English | LTR — the unprefixed locale |
| `ur` | Urdu | **RTL** |
| `ar` | Arabic | **RTL** |

RTL is first-class from day one: logical properties (`margin-inline-start`, never
`margin-left`), and Quranic Arabic rendering correctly in all three locales including within
an otherwise LTR page.

### 1.3 Locale switching

**Switching the locale switches the interface, and always preserves the current route and its
parameters.** The locale segment changes; the resource does not.

**Since Rebaseline R1 the language switcher is a set of plain links** built by the same
`localizedPath` helper as every other address: each keeps the exact path and query, the English
link is the unprefixed address (never a `/en` hop through the 301), and following one writes no
cookie — the chosen address is the whole of the choice.

What the visitor then sees depends on **content language**, which is a different concept
(§1.5, DOMAIN_MODEL.md §19.1):

| Situation | Behaviour |
|---|---|
| The content exists in the requested locale | Render it in that locale |
| The content exists, but **not** in that locale | **Stay on the resource.** Render the available language with a **visible language notice**, while the UI chrome follows the requested locale (§9.3) |
| **The resource itself does not exist at all** | The visitor reaches the nearest valid ancestor with a clear notice — **never a 404 produced by switching locale**, and never a silent bounce to the home page |

> **A previous revision said switching preserves the route "where the content exists in that
> locale", which implied leaving the resource whenever a translation was missing.** That
> conflated interface locale with content language and contradicted §9.3. **Corrected:** a
> missing *translation* never moves the visitor off the resource — only a missing *resource*
> does.

The SEO consequences are unchanged and are stated in §9.2–§9.3: an untranslated page is
**never** listed as an `hreflang` alternate, and its canonical points to the existing-language
URL rather than to the fallback rendering.

### 1.4 Slugs

Stable and permanent. Display titles may be edited freely; changing a slug creates a **301**
from the old slug. Slugs are never reused.

> **Slug history is native to the owning context**, delivered in the same phase that makes the
> slug editable (DOMAIN_MODEL.md §19.7). It is **not** provided by Migration, and it does not
> wait for it. `LegacyMapping` maps **legacy source URLs** and is Migration-owned (§9.7); using
> it for ordinary renames would invert the dependency rules and leave every pre-migration rename
> without a redirect.

### 1.5 Content language vs interface locale

`/ur/library/books` is the Library UI in Urdu, listing books in **all** content languages
unless filtered by `?language=`. Independent concerns (DOMAIN_MODEL.md §19.1).

---

## 2. Canonical resource policy

Correcting duplicate indexable routes in the prior revision.

### 2.1 One resource, one canonical URL

> **Every resource has exactly one indexable canonical URL. Aliases 301 to it.**

| Resource | Canonical route | Resolution |
|---|---|---|
| **Contributor profile** | `/{locale}/people/{slug}` | `/authors/{slug}` and `/library/authors/{slug}` **both 301 here.** One profile page presenting the person's author, speaker, scholar and teacher facets as applicable |
| **Topic** | `/{locale}/topics/{slug}` | Canonical for every topic |
| **Work / book** | `/{locale}/library/books/{slug}` | — |
| **Video** | `/{locale}/watch/videos/{slug}` | — |
| **Fatwa** | `/{locale}/fatwa/{slug}` | — |
| **Quran ayah** | `/{locale}/quran/surah/{surah}/{ayah}` | Reading preferences are query parameters |
| **Hadith** | `/{locale}/hadith/{collectionSlug}/{hadithNumber}` | Short citation form is canonical; deep structural paths carry a canonical link to it |

In this table and in §4, `/{locale}/…` names the route in every interface locale; its public
address follows §1.1 — unprefixed in English (`/people/{slug}`), `/ur/…` and `/ar/…` otherwise.

**One contributor profile route** replaces the prior two. A Person may hold author, speaker,
scholar and teacher profiles (DOMAIN_MODEL.md §5.2); presenting them at separate indexable
URLs would fragment one human being's search authority across several pages.

### 2.2 Domain topic views

Domain-specific topic paths — `/quran/topics/{slug}`, `/hadith/topics/{slug}`,
`/watch/topics/{slug}`, `/fatwa/topics/{slug}` — exist for UX. They are **filtered views**,
not independent SEO entities.

Each such page **carries `rel="canonical"` pointing to `/topics/{slug}`**. They are legitimate
navigation, but they are not separate resources and must never compete in the index.

### 2.3 Four kinds of route — and which of them may be a path

`Latest`, `Popular` and `Featured` are flags and queries (INFORMATION_ARCHITECTURE.md §1.1).
The prior revision contradicted its own rule with `/fatwa/latest` and `/fatwa/popular`.

**Corrected:** `/fatwa?sort=latest` and `/fatwa?sort=popular` — derived views of one resource
collection, canonical to `/fatwa`, **not indexable resource hierarchies**.

But a blanket "filters are never paths" rule would be wrong in the other direction, because
this route map **deliberately** uses navigational path views — `/watch/lectures`,
`/news/press-releases`, `/quran/topics/{slug}`, `/library/research`. Those are not sloppy
filters; they are how the product's information architecture is browsed. **Four kinds of route
are therefore distinguished:**

| Kind | Example | Indexable? | Canonical target |
|---|---|---|---|
| **Canonical entity** | `/library/books/{slug}` | **Yes** | Itself |
| **Intentional navigational view** — a named, curated part of the IA | `/watch/lectures`, `/news/press-releases`, `/quran/topics/{slug}` | **Yes**, where it is a genuine browse destination — but a **domain topic view canonicalises to `/topics/{slug}`** (§2.2) | Itself, or the canonical hub it mirrors |
| **Query filter or sort** — an arbitrary combination | `/fatwa?sort=latest`, `/library/books?language=ur` | Indexable but **canonical to the base**, and **excluded from sitemaps** | The base resource |
| **Legacy alias** | `/authors/{slug}` | **No** | **301** to the canonical URL |

**The test is whether the route names something the information architecture actually curates.**
A named section a visitor would navigate to may be a path. An arbitrary, combinable filter is a
query parameter — because filters combine and paths do not, and because every combination would
otherwise become an indexable URL.

### 2.4 Sign-out is not a GET route

**Sign-out is a state-changing POST/action with CSRF protection.** A GET route that mutates
session state can be triggered by any image tag or prefetch. `/signout` is removed as a
navigable route.

---

## 3. Public routes

Every route is localised per §1.1: unprefixed in English, under `/ur` or `/ar` otherwise.
(Historical: until Rebaseline R1 every route was prefixed with `/{locale}`, English included.)

### 3.1 Root

| Route | Purpose |
|---|---|
| `/` | Home |
| `/search` | Unified search — `?q, type, topic, language, from, to, page` · **`noindex`** |
| `/donate` | Donation entry point — delivered in Phase 27: published campaigns and an anonymous start; no per-campaign route |
| `/sitemap` | Human-readable sitemap |
| `/topics` · `/topics/{slug}` | **Canonical taxonomy browser and topic hub** |
| `/people/{slug}` | **Canonical contributor profile** |
| `/collections` · `/collections/{slug}` | Editorial collections. Delivered in Phase 15: `/collections` lists published Collections newest first (`?offset=` is a page of it, canonical to it); a Collection page lists its currently public members in their one order, each linking to its OWNER's canonical address — there is no second member address under `/collections`. There is no `/collections/latest`, `/popular` or `/featured`. A former Collection slug answers one 301; the `collections` sitemap segment lists published Collections at their current slug in the languages they genuinely have |
| `/membership` · `/contact` · `/help` · `/help/{article}` · `/feedback` | Utility destinations |

`/topics/{slug}` is among the most important routes on the platform — the realisation of the
unified content graph, presenting works, videos, articles, research, Fatawa, courses, audio
and contributors for one topic. It sits at root level because it serves every context.

**Rebaseline R2 (2026-11-06).** No root route is added. `/search` offers result-type facets only
for kinds whose domain has published content (the shell's presence evidence) — the chosen kind is
always offered, and only the current facet carries a count, the one total the index reports; a
query that finds nothing lists the main areas that hold published content instead. A search
palette in the header (Ctrl+K, ⌘K on a Mac) is the same GET form to `/search?q=`
(INFORMATION_ARCHITECTURE.md §2.2). A Collection page takes **`?order=curated|newest|oldest`**:
`curated` is the editor's saved order and the bare address; `newest`/`oldest` order by each
member's own date where its owner states one (members without a date follow, in curated order),
offered only when at least two members are dated; anything else is `curated`. Every `?order`
variant is canonical to the bare Collection address and is never a sitemap entry. `/contact` may
carry a published Editorial Page above the contact form — the source's contact page is bound to it
in the R2 migration catalogue (MIGRATION_STRATEGY.md §19).

**Owner direction 2026-11-08 — the home page's features restored.** No route changes. The R2 home
page had dropped features the Phase-30 portal (commit `0382218`) carried; they are back, in R2's
visual components: the hero's search box (a GET form to `/search?q=`, beside the header's search
palette) and its link to `/explore`; the **Quran and Hadith** cards, always present as peers and
each saying whether a text is available (available · reference preview · test text only · not yet
published); the six other areas (Learn, Library, Watch, Fatwa, News and Events, Global) and the
seven Explore sections, always; and, each only while its owner has something published, audio
lectures (→ `/listen/lectures`), Events (upcoming, else the latest past ones, labelled as past),
the latest rulings while Fatwa is activated, the organisation's published Explore Pages, and the
taxonomy's top-level topics (→ `/topics`). The Global module's way on is the Centre finder once a
Centre is listed, else the countries directory.

### 3.2 Explore

| Route | Purpose |
|---|---|
| `/explore` | Section landing |
| `/explore/about` · `/explore/about/{page}` | introduction · vision · mission · values · objectives · history · timeline · global-impact |
| `/explore/leadership` | Leadership |
| `/explore/shaykh-ul-islam` · `/{page}` | biography · early-life · education · academic-work · achievements · works · isnad · views-of-dignitaries |
| `/explore/shaykh-ul-islam/{books\|articles\|lectures\|collections}` | Filtered listings, canonical to their domain collections. `collections` stays a reserved shell after Phase 15: no accepted contract identifies a Person–Collection relation deterministically, and none is hard-coded |
| `/explore/organization` · `/{page}` | governance · departments · forums · wings · institutions · annual-reports · un-recognition · awards |
| `/explore/our-work` · `/{area}` | education · research · welfare · women · youth · students · interfaith · human-rights · peace |
| `/explore/community` | Community |
| `/explore/digital-resources` · `/{item}` | mobile-apps · newsletter · rss · social-media |

**Phase 30-R.** An Explore address carries its **published Editorial Page** once one is bound to
it, at the same canonical URL — eight pre-adoption pages are bound (about/introduction,
about/global-impact, shaykh-ul-islam/biography, organization/forums, organization/un-recognition,
our-work/peace, digital-resources/mobile-apps and digital-resources/social-media); on staging
three were published at Phase-30-R exit (un-recognition, peace, mobile-apps — MIGRATION_STRATEGY.md
§15.1), and since Phase 30-RF seven are (global-impact, the Shaykh-ul-Islam biography, forums and
social-media added — §16), and since Phase 30-RD all **eight** are: about/introduction is published
at its same canonical address once a person cleared its personal-data findings as public
organisational contacts (OPEN_DECISIONS.md §3.8; MIGRATION_STRATEGY.md §17). Every other item stays
a reserved page. The source's three curated archives are Collections at the existing canonical
`/collections/{slug}` (`al-hidayah`, `mawlid-conferences`, `itikaf-during-ramadhan`) — no
legacy category route exists. `/explore/leadership` lists the published leadership profiles, each
canonical at `/people/{slug}`, and links the Shaykh-ul-Islam biography. No new path is created.

**Rebaseline R2.** `/explore` opens with a narrative — the organisation's own published Pages,
picture-led (the founder's biography first when published), then its published leadership by
portrait — before the index of every section, which is the same panel the header's About MQI
group renders; until 2026-11-08 it listed published pages only (historical, superseded below).
The R2 migration catalogue binds one more Explore address, `organization/annual-reports` (and the
root `/contact`, §3.1), and extends the curated archives to all fourteen genuine `lkcatid`
archives at `/collections/{slug}` (OPEN_DECISIONS.md §3.9; MIGRATION_STRATEGY.md §19). No new path
is created.

**Owner direction 2026-11-08.** The `/explore` index again lists **every section and every page it
reserves**, whatever is published, as it did at Phase-30 exit; the narrative above it still shows
published Pages and people only. Each section landing lists its published Pages as picture-led
cards and then every other page it reserves — a page not yet published marked "Not yet published"
and answering with its honest reserved state, a page an owner delivers elsewhere linking there
(Digital resources → `/newsletter`) — and carries the publication-status notice while anything
it reserves is unpublished. No route changes.

### 3.3 Quran

| Route | Purpose |
|---|---|
| `/quran` | Landing |
| `/quran/read` | Reader entry — resumes progress when signed in *(uncached island)* |
| `/quran/surah` · `/quran/surah/{surahNumber}` | Surah index (`?q` filter, `?sort` order — Quran Part 2) and view — `?translation, tafsir, reciter, transliteration, words` (`words`: Quran Part 7); `?from` names the reading window (Quran Part 1) |
| `/quran/surah/{surahNumber}/{ayahNumber}` | **Canonical ayah citation URL** |
| `/quran/page/{pageNumber}` | One mushaf page, as text (Quran Part 1) — 404 for a page no public Ayah carries |
| `/quran/juz` · `/quran/juz/{juzNumber}` | Juz index (`?q` filter by number or hizb — Quran Part 3) and view — `?hizb` and `?part` name the reading window (Quran Part 3; the Phase-18 `?offset` paging is historical) |
| `/quran/search` | Quran search — `noindex`; `?q`, `?page`, and the filters `?surah`, `?juz`, `?language` (Quran Part 4) |
| `/quran/translations` · `/{slug}` · `/quran/translations/compare` | Translation works, each with its counted coverage and translator's notes; `compare` (`?surah`, `?ayah`) shows one Ayah in every public translation (Quran Part 6) — a reserved address no translation may take as its slug |
| `/quran/tafsir` · `/{slug}` · `/quran/tafsir/surah/{surahNumber}` | The **Tafsir hub** (Quran Part 8): public Tafsir texts, the Surah grid, and the tafsir books and lectures linked to the ayat they explain — `?surah` (and `?ayah`) is its find form, one redirect to that Surah's tafsir; a Tafsir work's own page; one Surah's tafsir — whole-Surah resources, then each group of overlapping passages with its ayat (`?translation`, `none` for the Arabic alone), texts, books and lectures; `?ayah` lands on that Ayah (or says nothing explains it yet); 404 outside 1–114. `surah` is reserved from Tafsir slugs |
| `/quran/transliteration` · `/quran/word-by-word` | Transliteration and word-by-word works (Quran Part 7) — **hidden until published**: each a 404 while no work of it is public |
| `/quran/tajweed` · `/quran/tajweed/{rule}` | Study aids. Since Quran Part 9, with a public tajweed colour overlay, the **Tajweed hub**: every rule the overlay marks (the 18 of `QURAN_TAJWEED_RULES`) with its colour, its counts and the shortest ayat where it occurs (only that rule coloured, each linked to its Ayah), the colour key, the published guidance on other subjects, and the overlay's credit and standing ("not yet reviewed by a qari"); `/quran/tajweed/{rule}` for such a rule shows its colour, its guidance where an editor published a Tajweed rule of that slug ("not yet" otherwise) and six examples. Without a public overlay, the published guidance alone, as before; an unknown or unpublished slug is 404 |
| `/quran/recitations` · `/quran/recitations/{reciter}` | **Recitations — owned by Quran** (DOMAIN_MODEL.md §8.1) |
| `/quran/topics/{slug}` | Filtered view, canonical → `/topics/{slug}` |
| `/quran/{books\|videos\|articles\|research\|courses\|teachers}` | Related material, canonical to their domain collections |

Translation, tafsir and reciter selections are **query parameters, not path segments**, so a
citation remains valid regardless of reading preferences.

**Quran Part 8 — the Tafsir hub (DOMAIN_MODEL.md §8.8).** `/quran/tafsir` and
`/quran/tafsir/surah/{n}` compose Quran's public reader with Library's and Media's public passage
reads at Layer 4; the canonical address of each is the bare path (the find form's and the jump's
`?surah`, `?ayah` and `?translation` never are). In the reader, an Ayah something explains gains a
Tafsir action — a link to `/quran/tafsir/surah/{n}?ayah={a}` without script, a sheet with it — and
an Ayah nothing explains has none. A lecture is opened at a passage by
`/watch/videos/{slug}?start={seconds}` (§3.7).

**Quran Part 9 — tajweed colours (DOMAIN_MODEL.md §8.9).** No new address and no query
parameter: the reader's "Tajweed colours" switch (in its settings, offered only while a colour
overlay is public) is a browser preference like the reading mode, applied before the first paint, so
every reading address — Surah, Juz, mushaf page, Ayah — stays the bare citation. The colour key
appears beneath the reader's bar only while the colours are on.

**Delivered in Phase 18 (engineering — no authoritative corpus is supplied; DELIVERY_PLAN.md
Phase-18 continuity).** Every route above except the three related views named below. Surah, Ayah
and Juz addresses are numbers; `?translation`, `?transliteration` and `?tafsir` name a public work's
slug, `?reciter` a public Recitation's slug and `?size` a reading size — each validated, an unknown
value reported rather than broadened, and the canonical URL always the bare citation. `/quran/read`
is an anonymous entry form; signed-in progress arrives with Phase 21. `/quran/recitations/{reciter}`
is the reciter's People slug. **Corpus states:** while no corpus is active, section pages render an
honest unavailable state and named resources answer 404; a fixture-mode corpus carries a visible
non-authoritative notice on every page and is `noindex`; only an approved corpus is indexable.
Related views: `/quran/books`, `/quran/videos` and `/quran/research` are delivered — each the
owner's own public listing for the seeded `quran` topic, canonical to the owner's collection;
`/quran/articles` and `/quran/teachers` stay absent and unlinked until an owner exposes a
deterministic by-topic read. **Phase 22:** `/quran/courses` is delivered — Learning's own public
Course listing for the seeded `quran` topic, composed at Layer 4 and canonical to the Course catalogue
(Quran imports nothing of Learning).

**Rebaseline R2 — the reference mode and the reader (OPEN_DECISIONS.md §1.1; DOMAIN_MODEL.md
§8.4).** A third corpus state joins the two above: a **reference** corpus (a licensed external text
reproduced verbatim — on staging, the Tanzil Uthmani text with Minhaj-ul-Quran's own Irfan-ul-Quran
translation) is active **only on a deployment that admits it** (`RELIGIOUS_REFERENCE_PREVIEW`,
refused beside public indexing — SECURITY_BASELINE.md §5.1); everywhere else it is inactive and the
section is as with no corpus. In reference mode every Quran page is **`noindex`**, emits **no
canonical or alternates**, and the `quran` sitemap segment is empty — the same posture as fixture
mode, decided by one exhaustive table (`QURAN_MODE_POSTURE`) that only the approved mode makes
indexable — and every Quran page names its sources and says the text has not been reviewed by
Minhaj-ul-Quran's religious authority (one line at the top and an "About this text" panel, not a
banner on every Ayah). Unlike fixture mode, a reference corpus is a navigation destination
(INFORMATION_ARCHITECTURE.md §2.2).

- **`/quran/read?q=` is the quick jump** — "18", "18:10", a Surah name the corpus records, or
  "juz 15" (Arabic-Indic digits accepted, input at most 60 characters), parsed against the
  reader's own Surahs, ayah counts and recorded names. A match answers a redirect to the canonical
  Surah, Ayah or Juz address built from the parsed numbers — never from the typed text, so `q` is no
  redirect parameter; no match re-renders the entry form with the input and an explained refusal.
  The landing's quick-jump form and its client island answer the same input the same way.
- **Reader defaults.** Which default translations are shown and the Arabic and translation sizes are
  the visitor's own presentation preferences, kept in the browser (`localStorage`, never sent,
  validated on read) beside the last Ayah read on that device. With no stored choice the page shows
  the interface language's translation where one exists — **none in the Arabic interface**, whose
  readers read the text itself — otherwise the one that exists. `?translation` and the other
  queries above still win, and the canonical URL is still the bare citation.
- **Bismillah header** — shown at the head of a Surah only in reference mode, as Al-Fatiha's first
  Ayah's stored text unchanged (the Tanzil text carries it in 1:1 alone), never counted or copied as
  an Ayah and hidden from assistive technology; **never on Surahs 1 or 9**. An approved corpus
  decides its own convention, so nothing is shown there until that is a recorded decision.

**Owner direction 2026-11-08.** The `/quran` landing's hero again carries the full-text search
form (a GET form to `/quran/search?q=`, working without JavaScript) beneath R2's quick jump, and its
Read, Study and Explore groups carry their introductions again. No route changes.

**Quran Part 1 — the reading experience (owner direction 2026-11-09; DELIVERY_PLAN.md, the Quran
Part 1 record).** One new route and a changed Surah view; every corpus-state, `noindex`, attribution
and fixture rule above is unchanged.

- **`/quran/surah/{surahNumber}` reads in windows of 40 ayat.** The page server-renders one window,
  complete without JavaScript; `?from={n}` (a canonical decimal Ayah number inside the Surah — any
  other value is the first window) opens the window that holds Ayah `n`, and windows start at fixed
  places (1, 41, 81 …), so each has one address. The next window is a plain link the reader's island
  fetches (the same public address, parsed inertly) and appends as the reader nears it; earlier
  windows are a link back. **Every Ayah element is `id="ayah-{surah}-{ayah}"`** on every listing (the
  R2 Surah page's `ayah-{n}` is historical; the island still honours it). A fragment the server never
  sees — `/quran/surah/2#ayah-2-255` — is landed by the island, which moves to that Ayah's window;
  the canonical address stays the bare Surah address, and the canonical citation
  `/quran/surah/2/255` is unchanged. Al-Baqarah no longer ships 286 ayat with two translations in one
  document. No corpus read is cached: each window is one bounded read per layer.
- **`/quran/page/{pageNumber}`** — the ayat whose stored `page` is that number (the Tanzil
  metadata's Medina mushaf pages on the reference preview), in canonical order, grouped by Surah with
  each Surah's opening and the Bismillah rule above, a "Page 50 · Juz 3 · Hizb 5" header, and the
  previous and next page. Text only — no mushaf image (none is licensed). A page outside the corpus's
  range, any page of a corpus that records none, and any page while no corpus is active are 404. The
  reading preferences are query values; the canonical URL is the bare page address.
- **Three reading modes over one document** — Translation (verse by verse), Reading (the Arabic
  alone, flowing, each Ayah closed by its presentational end mark and one button that opens its
  translation in a sheet) and Mushaf (the same flow under page headers). The mode, which of the
  rendered translations show (up to four public works, stacked or side by side), both text sizes and
  the line spacing are the visitor's presentation preferences in `localStorage`, applied before the
  first paint by a fixed inline script on the reader element; the no-JS GET form remains. No mode is
  part of any address.
- **Division markers** — where a Juz, a hizb or a mushaf page begins (from the stored numbers only)
  and sajdah ayat, inline. Rub' al-hizb quarters are not stored apart from the text, which carries
  its own ۞ sign.
- **`/quran/read` is a start page**: "Continue where you stopped" (an island: the signed-in person's
  own position from `GET /api/my/quran-position` after render, else this browser's last place), the
  quick jump (now also "page 50"), popular starting points as fixed citations offered only where the
  corpus holds them (1, 18, 36, 67 and 2:255, with the corpus's own recorded names), and the Surah,
  Juz and page indexes. `?page={n}` opens a recorded page; `?surah=&ayah=&place=surah` (the Surah
  page's "Go to an Ayah") opens that Ayah in its Surah's window rather than its citation page. Every
  address it produces is built from numbers the reader confirmed. The page is the same document for
  every visitor.

**Quran Part 2 — the Surah index and the Surah display names (owner direction 2026-11-09;
DELIVERY_PLAN.md, the Quran Part 2 record).** No new route; every corpus-state, `noindex`, attribution
and fixture rule above is unchanged.

- **`/quran/surah?q=&sort=`** — each Surah is a row whose whole area is its link: number, display name
  and the name's meaning in the language each is in, ayat, revelation place where the source recorded
  one, the Juz it spans (derived from the reader's own Juz ranges) and the source's Arabic name in the
  Quran face (at most two fifths of the row, wrapping rather than squeezing the title). `?q` (at most 60
  characters; longer is cut) keeps the Surahs whose number begins with it ("1", "18", "۱۸", "Surah 18")
  or one of whose recorded names or meanings, in any language or script, contains it, compared folded
  (case, marks, letter variants, punctuation, a doubled Latin letter, a leading article) and never
  shown folded. `?sort` is `number` (default), `revelation` (grouped Meccan, Medinan, then not
  recorded, each in number order), `longest` or `shortest` (ties by number); an unknown value is the
  default. It is a GET form answered on the server, so it works without JavaScript; with it, a client
  island answers each keystroke with the same pure functions, keeps the address in step and announces
  the number shown in a `role="status"` line. The canonical URL is always the bare `/quran/surah`.
  Above the index, the "Continue where you stopped" card of Part 1 where there is a place to return
  to. The landing's Surah tab is the same component (its form opens `/quran/surah`). **Revelation
  order is not offered**: the Surah structure records no revelation order (it is copied from the
  registered source by the canonical procedure, and the registered source is immutable), so no order
  is invented for it.
- **Display names in every interface.** English shows the recorded English display name and its
  meaning (on staging, the Tanzil metadata's transliteration and English meaning, verbatim —
  DOMAIN_MODEL.md §8.4). Urdu and Arabic show a name recorded in that locale, otherwise the source's
  own Arabic name marked `lang="ar"`, never an English transliteration in its place; no English
  meaning is shown there. The quick jump (`/quran/read?q=`) also resolves a recorded meaning
  ("The Cave") and a transliteration typed with single vowels ("Fatiha" for "Al-Faatiha").

**Quran Part 3 — the Juz index and the Juz reading page (owner direction 2026-11-09;
DELIVERY_PLAN.md, the Quran Part 3 record).** No new route; every corpus-state, `noindex`,
attribution and fixture rule above is unchanged.

- **`/quran/juz?q=`** — thirty cards, each whole card its link: the number; the **opening words of
  the Juz's first Ayah** (the first Juz: Al-Baqarah 2:1, "الٓمٓ", its traditional name — `juzOpeningAyah`), cut verbatim from the stored text (its first three words — a word is a
  space-separated run carrying a letter, so a leading ۞ is not one and a pause mark between words
  stays where the text has it — with a presentational "…" hidden from assistive technology when the
  Ayah goes on), in the Quran face; "From 2:142 to 2:252 · 111 ayat"; the Surah it begins in and the
  one it ends in by their display names (Part 2's rule and fallback; "· 37 Surahs" where it spans
  more); and its pages and hizb where the source recorded them. **No Juz name is written anywhere**:
  a Juz is known by its opening words, and those are the stored words. `?q` (at most 60 characters)
  keeps the Juz whose number begins with it ("1", "15", "۱۵", "Juz 15", "Para 15") or, for "hizb 30"
  (also حزب / الحزب), the Juz the source recorded that hizb in; anything else keeps nothing. A GET
  form answered on the server, live per keystroke with a client island that keeps the address in
  step and announces the count; the canonical URL is the bare index; Part 1's continue card sits
  above it. The landing's Juz tab is the same component without the opening words (the landing shows
  no verse).
- **`/quran/juz/{n}` reads one window at a time, by the source's own divisions** — one window per
  recorded hizb (two to a Juz in the Tanzil structure); a hizb of more than 100 ayat (the short ayat
  at the Quran's end) is read in parts that break only between mushaf pages, as even as the pages
  allow; ayat with no recorded hizb are read the same way as one run. `?hizb={h}` opens hizb `h` of
  this Juz and `?part={p}` one of its parts; anything else (an unknown hizb, a malformed value, the
  historical `?offset=`) is the first window, which is the bare address and its canonical URL; any
  other window canonicalises to itself. Each window is server-rendered and complete without
  JavaScript — Surah headings where a Surah opens (centred, with Part 1's Bismillah rule) or
  continues, Part 1's markers, modes, settings and `ayah-{s}-{a}` anchors — and the next is a plain
  link the reader island fetches and appends as the reader nears it (the list carries
  `data-series="juz-{n}"`, a Surah's `surah-{n}`). Above the text: the opening words, "Juz n", its
  count, pages and hizb, where it begins and ends (Surah name and citation, linked to the citation
  pages) and the neighbouring Juz; a compact "In this Juz" navigation of its hizb starts and its
  Surahs (each linked to the window that holds its first Ayah in the Juz, at that Ayah); the window's
  name and "Ayat 22–47 of 47 in this Juz", with the island's progress line through the whole Juz.
  Below: the Juz before and after, by their opening words, and the no-JS reading form, which keeps
  the window.
- **Rub' al-hizb quarters are not navigated.** The canonical structure stores the hizb only; a
  quarter's start exists only in the Tanzil metadata, whose 240 quarters the import folds into hizb
  numbers — and Tanzil text 1.1 and metadata 1.0 disagree on one quarter start (15:49 against 15:50,
  `tanzil-corpus.ts`). Storing quarters would change canonical structure and choose between the two
  files; neither is done for navigation (DOMAIN_MODEL.md §8.4). The text's own ۞ sign still marks
  quarters where the source wrote one.
- **The quick jump accepts "hizb 30"** (حزب, الحزب) for a hizb the corpus records, opening
  `/quran/juz/{n}?hizb=30` in the Juz the reader says it begins in — an address built from the
  confirmed numbers, never from the typed text.

**Quran Part 4 — search (owner direction 2026-11-09; DELIVERY_PLAN.md, the Quran Part 4 record).**
No new route; `/quran/search` stays `noindex`, signed out, uncached and throttled by the request
proxy exactly as `/search`, and every corpus-state, attribution and fixture rule above is unchanged.

- **Arabic is found however it is typed.** Matching folds the INDEXED COPY and the query alike —
  harakat and Quranic marks, alef forms and the alef wasla, alef maqsura and the Arabic and
  Urdu/Farsi yeh, keheh and kaf, taa marbuta and the heh forms — and an indexed text also carries
  the words its Uthmani marks spell (the dagger alef, a waw carrying it, the small yeh and waw, a
  hamza on a tatweel), so "الله", "الصلاة", "الرحمن" and "الكتاب" typed plainly find the Uthmani
  text (ARCHITECTURE.md §4.3; TECH_STACK.md §10). The stored text is never what changes: a result
  shows the current text exactly as stored, with the typed words marked in place.
- **Filters, as GET parameters, working without JavaScript.** `?surah={n}` and `?juz={n}` are
  canonical decimal numbers the reader confirms; each becomes a restriction to that Surah's or that
  Juz's citations (both at once intersect), built from the reader's counts and ranges — never a
  list the address carries. `?language=` is `ar` (the Quran text) or a language a public
  translation or transliteration is written in, each option naming its works. A value the reader
  does not hold is refused in words and nothing is searched; a Surah and Juz that do not overlap are
  said to. Active filters are chips (each a link removing only itself), with "Clear all filters";
  paging keeps the filters; the count is the page's status.
- **A citation or a name goes straight there.** A query that is a citation ("2:255", "۲:۲۵۵", "2
  255"), "Surah 18", a Surah's recorded name or meaning in any script, a name with an Ayah number
  ("Al-Baqarah 255", "البقرة ٢٥٥"), "Juz 15", "Hizb 30" or "page 50" is parsed against the
  reader's own index (Part 1's quick jump; on this page a name must be a WHOLE name, or a spelling
  of four letters or more that begins the recorded one, so an ordinary word is never mistaken for a
  name) and offered first as "Go straight there" — an Ayah with its Arabic as stored and its place in
  its Surah, Ayat al-Kursi named as the landing names it. Text matches still follow.
- **Each result is one Ayah**: its Surah's display name and "Surah n, Ayah m" as the heading link
  (the address the owner resolved now), the Arabic in the Quran face (`lang="ar" dir="rtl"
  translate="no"`), and beneath it the public translation and transliteration snippets the typed
  words mark — otherwise the hit's own language, otherwise the interface language's — each in a
  group named by its work and marked with its own language, a long one cut around its first match
  and said to be cut; then "Open the Ayah" and "Read in its Surah" (`/quran/surah/{s}?from={w}#ayah-{s}-{a}`).
  Nothing matched: suggestions (the Arabic spelling hint for an Arabic-script query, fewer words or
  a translation's words, and "Search without filters").

**Quran Part 5 — recitations (owner decisions 2026-11-09; DELIVERY_PLAN.md, the Quran Part 5
record; DOMAIN_MODEL.md §8.5).** No new page route; one new segment layout and one public data
route. Every corpus-state, `noindex`, attribution and fixture rule above is unchanged.

- **The Quran layout** (`app/[locale]/(public)/quran/layout.tsx`) mounts the recitation player once
  over every `/quran/**` page from the PUBLIC recitation catalogue (the same document for every
  visitor), so a client navigation between Quran pages keeps it playing; leaving the section ends
  it. While a recitation is loaded, a link or a GET form to another Quran page in the same interface
  language is followed by the client router; every other link behaves as it always has. Nothing
  renders while no recitation is public, and nothing plays until the visitor presses Play.
- **`GET /api/quran/recitations/{slug}/{surah}`** — what the player needs for one public
  recitation's audio in one Surah: each playable segment's range, how its audio is addressed (the
  first-party asset's three identifiers, or the allowlisted stream descriptor — never a URL), and
  each Ayah's `[ayah, startMs, endMs]` where the recitation is timed — and, for an aligned
  narration's timed segment, each passage's `[startAyah, endAyah, startMs, endMs]` as `translation`
  (Quran translation audio, DOMAIN_MODEL.md §8.5.1; `null` otherwise). Imports no Identity; a
  malformed slug or Surah, or a recitation not public now, is a 404; `private, max-age=300`,
  `noindex`, no query read.
- **Surah, Juz and Ayah pages** carry a **Listen** section: the recitation choice (remembered in this
  browser; `?reciter=` preselects) and Play from the Surah's start, the Juz's first Ayah or the
  cited Ayah; every Ayah row gains "Play from this Ayah" — shown only while the player is ready AND
  the chosen recitation is timed. An untimed recitation is said to play whole Surahs without verse
  highlighting. **Without JavaScript** the section offers each public recitation as a plain link to
  the same page with `?reciter=`, where each segment is the browser's own `<audio controls>`; with
  JavaScript those fallbacks are hidden (`data-quran-audio`), so a page never shows two players.
- **`/quran/recitations`** — cards per recitation (name, reciter link, language, style, "Verse by
  verse" or "Whole Surah", Surah count, attribution, Play, "Listen alongside the text"), filtered by
  `?style=` and `?language=` from a GET form shown only when the public recitations differ in one of
  them; a value no recitation carries matches none. **`/quran/recitations/{reciter}`** lists each
  recitation's Surahs, each with Play and "Read and listen" (`/quran/surah/{n}?reciter=`), and keeps
  the native players collapsed as the no-script fallback. Nothing is downloadable anywhere.
- **Translation audio (2026-11-10; DOMAIN_MODEL.md §8.5.1).** No new route. The dock's settings
  offer "Urdu translation after each passage" (remembered in this browser) where a public narration
  is aligned for the Surah being heard and a recitation of the Arabic is chosen; otherwise they say
  it is unavailable for that Surah (and how many Surahs have it), or that the chosen narration
  already reads the translation. A narration's card and reciter page add "Translation by passage: N
  Surahs" and the identified Arabic recitation ("identified by audio comparison … not confirmed by
  Minhaj-ul-Quran"); a partly timed narration no longer carries the whole-Surah note.

**Quran Part 6 — translations and the translator's notes (DELIVERY_PLAN.md, the Quran Part 6
record; DOMAIN_MODEL.md §8.6).** One new page route; every corpus-state, `noindex`, attribution and
fixture rule above is unchanged.

- **Reading pages** (Surah, Ayah, mushaf page, Juz): each mark a translator's note answers is a link
  to that note (the mark itself, exactly as written, is its only content, so the text, selection and
  Copy are unchanged); the Ayah's notes follow the work's attribution in a native disclosure, in the
  translation's language and direction. With script a mark opens its note in a dialog, and the
  reading settings offer "Show under every Ayah" (`data-notes`, remembered in this browser, set
  before the first paint); **without JavaScript** the notes are in the page and a mark jumps to its
  note.
- **`/quran/translations`** — a card per public translation: name, language, credited People,
  description, attribution, "{n} of {total} Surahs" (and how many in part), the number of
  translator's notes, "Read with this translation" and "Compare translations".
  **`/quran/translations/{slug}`** — what is recorded of the work (no biography is written here),
  its counted coverage and notes, and every Surah of the corpus with its coverage and notes, linked to
  the reader with the work chosen.
- **`/quran/translations/compare?surah=&ayah=`** — the Ayah's Arabic once, and every public
  translation of it beneath (side by side on a wide screen) with its notes open; a GET form chooses
  the Ayah and plain links reach the neighbours, so it is complete without script; an Ayah the
  corpus does not hold is said to be missing and nothing else is shown. Canonical address: the bare
  view.

**Quran Part 7 — transliteration and word by word (DELIVERY_PLAN.md, the Quran Part 7 record;
DOMAIN_MODEL.md §8.7).** One new page route, `/quran/word-by-word`; one new reading preference,
`?words=` (a public word-by-word work's slug, validated like the others); every corpus-state,
`noindex`, attribution and fixture rule above is unchanged.

- **HIDDEN UNTIL PUBLISHED (OPEN_DECISIONS.md §1.2 item 3).** While no Transliteration (or no
  word-by-word work) is public — and so while no corpus is active — `/quran/transliteration` (or
  `/quran/word-by-word`) answers **404**, never an empty "coming soon"; the Quran mega menu and the
  mobile menu leave the link out (`ROUTE_SIGNALS` in `@/shell/presence`, the one exception to the
  unconditional navigation, read from the public presence snapshot — which may lag a publication by
  at most its 30-second cache); the Quran landing lists no card for it; the reader's settings and
  its reading form offer no such choice; and the Quran search page names no such language. The
  prerendered human sitemap never lists either route. As soon as one work is public, each place
  offers it.
- **Reading pages** (Surah, Ayah, mushaf page, Juz): the public transliterations (at most two
  rendered; `?transliteration=` fixes one) sit between the Arabic and the translations, each in its
  own language and direction (a Latin run is isolated left-to-right on an Urdu or Arabic page and
  hugs its own start), quieter than a translation and italic only in a Latin script. The public
  word-by-word works (at most two; `?words=` fixes one) draw an Ayah's Arabic as one unit per word
  with its gloss beneath as real text, wrapping right to left, in place of the plain line — only for
  an Ayah the work glosses. **Neither shows until chosen**: the settings sheet's "Transliteration"
  and "Word by word" choices (none or one work) are remembered in this browser and applied before the
  first paint (`data-transliteration`, `data-words`); without JavaScript the reading form's choice
  renders the server's page with it shown. **Translation mode only**: the Reading and Page modes
  keep the flowing Arabic alone, as they keep translations out. The recitation highlight marks the
  whole Ayah whichever is shown.
- **`/quran/transliteration`** — a card per public Transliteration: name, language, scheme,
  description, attribution, "{n} of {total} Surahs" (and how many in part), a sample (the work's
  first text near the start of the first Surah it covers, beside that Ayah's Arabic) and "Read with
  this transliteration". **`/quran/word-by-word`** — the same for each word-by-word work, with its
  credited People and the words it glosses, its sample drawn word by word, and "Read word by word".
  No work page exists for either: everything recorded of a work fits its card.
- **`/quran/translations/compare`** shows every public transliteration of the Ayah under its
  Arabic.

### 3.4 Hadith

| Route | Purpose |
|---|---|
| `/hadith` · `/hadith/introduction` | Landing and introduction |
| `/hadith/collections` · `/{slug}` · `/{slug}/books` · `/{slug}/books/{bookSlug}` · `/.../chapters/{chapterSlug}` | Structural browsing — deep paths carry canonical links to the short citation form |
| `/hadith/{collectionSlug}/{hadithNumber}` | **Canonical Hadith citation URL** |
| `/hadith/browse` · `/hadith/search` | Browse and search (`search` is `noindex`) |
| `/hadith/topics/{slug}` | Filtered view, canonical → `/topics/{slug}` |
| `/hadith/sciences` · `/{slug}` · `/hadith/commentary` | Study material |
| `/hadith/{books\|videos\|articles\|research\|courses\|scholars}` | Related material |

**Delivered in Phase 19 (engineering — no authoritative corpus is supplied; DELIVERY_PLAN.md
Phase-19 continuity).** Every route above except the three related views named below.
**Citation versus identity:** a Hadith record's identity is source-qualified — collection, source
system, edition and the source's own reference (DOMAIN_MODEL.md §9.1) — and `{hadithNumber}` is not
that key. It is a collection-local public number, mapped by a reviewed, versioned
`HadithCitation` to exactly one record that declared it; other editions' variants coexist without
competing for the URL, and a citation with conflict evidence, an unverified record or an inactive
collection answers 404. `{hadithNumber}` is a canonical decimal (1–999999). `{collectionSlug}` is
immutable and can never be one of this section's own path words (`introduction`, `collections`,
`browse`, `search`, `topics`, `sciences`, `commentary`, `books`, `videos`, `articles`, `research`,
`courses`, `scholars`), so the two-segment citation never shadows a section page. Structural pages
list citations that link to the short form; **no deep Hadith detail route exists**, so the short
citation is the only Hadith entity URL. **Corpus states:** while no collection is activated,
section pages render an honest unavailable state and named resources answer 404; a fixture
activation carries a visible non-authoritative notice on every Hadith page and is `noindex`; only an
approved activation is indexable. Related views: `/hadith/books`, `/hadith/videos` and
`/hadith/research` are delivered — each the owner's own public listing for the seeded `hadith`
topic, canonical to the owner's collection; `/hadith/articles` and `/hadith/scholars` stay absent and
unlinked until an owner exposes a deterministic read. **Phase 22:** `/hadith/courses` is delivered —
Learning's public Course listing for the seeded `hadith` topic, composed at Layer 4.

**Rebaseline R2 — the Hadith works landing (OPEN_DECISIONS.md §1.3).** No route changes. While no
collection is activated, `/hadith` presents MQI's own hadith **works** — the Library's public Works
classified under the `hadith` Topic, as a shelf of covers each linking to its `/library/books/{slug}`
page, with "all" leading to `/hadith/books` — and a short word on the hadith sciences, with one calm
sentence that the collections reader awaits an authorised source; it links nothing that is not open
(the collection, browse and search routes keep their honest unavailable state at their addresses).
With no such Work the shelf is absent. From R2 until 2026-11-08 the shell promoted `/hadith` as
"Hadith works" under a `hadithWorks` signal (historical); since the owner direction of 2026-11-08
the header's Hadith domain links `/hadith` always (INFORMATION_ARCHITECTURE.md §2.2). An activated
collection takes over as before.

**Owner direction 2026-11-08.** While no collection is activated, the landing again shows how the
section is organised, as at Phase-30 exit: Collections and Study each described and marked "Opens
when a collection is activated" (not linked), Explore and Learn linked to the `hadith` topic hub and
Learn; and a link back to the home page. It replaces R2's short "elsewhere on the platform" list,
which repeated those two links. No route changes.

### 3.5 Learn

| Route | Purpose |
|---|---|
| `/learn` | Landing |
| `/learn/courses` · `/learn/courses/{slug}` | Catalogue — `?topic, level, language, format, teacher` |
| `/learn/paths` · `/learn/paths/{slug}` | Learning paths |
| `/learn/live` · `/learn/trial` · `/learn/training` · `/learn/resources` | Learning surfaces |
| `/learn/teachers` | Teacher directory — `?subject, language, availability` |
| `/learn/teachers/{slug}` | **301 → `/people/{slug}`** |

**Delivered in Phase 22 (DOMAIN_MODEL.md §13.4).** `/learn`, `/learn/courses`,
`/learn/courses/{slug}`, `/learn/paths`, `/learn/paths/{slug}` and `/learn/trial`. The catalogue's
`?topic` takes a canonical Topic slug, `?teacher` a People slug (resolved at Layer 4), `?language`
a content-language code, `?level` one of `beginner`, `intermediate`, `advanced` and `?format` one
of `self-paced`, `live`; filters combine, and a malformed or unknown value shows an empty, explained
result — it never broadens the listing. A Course or path slug is editable with native slug history: a
former slug answers one 301 to the current one, and none of `courses`, `paths`, `live`, `trial`,
`training`, `resources` or `teachers` can be a slug. A Course page shows its description and
public syllabus; lesson bodies are read in My Learning. `/learn/trial` explains that a trial class
is a REQUEST on a `live` Course — recorded, not booked — and lists those Courses; the request itself
is made from the Course page's private island. Every Learn page reads no session. **Not delivered:**
`/learn/training` and `/learn/resources` — no owner contract exists; they have no route and no link.

**Delivered in Phase 23 (DOMAIN_MODEL.md §13.5).** `/learn/live` and `/learn/teachers`, both
activation-aware: with no live-learning activation each renders an honest localized unavailable
state, with a `fixture` activation a visible test-state notice, and both are `noindex` and absent from
every sitemap because their content depends on an operator decision. `/learn/live` lists upcoming
scheduled sessions on published live Courses with the Course and the teacher's public People profile
and the time in the class's own zone — never a participant, a Booking, an Attendance mark, a window or
a meeting address. `/learn/teachers` lists teachers who are current on every axis (DOMAIN_MODEL.md
§13.5); `?subject` takes a canonical Topic slug, `?language` a content-language code and
`?availability` exactly `available` (at least one future open, unbooked window); a malformed or unknown
value shows an empty, explained result and never broadens. `/learn/teachers/{slug}` is a one-hop
`301` to `/people/{slug}` for a published contributor and a 404 otherwise, like the author aliases.
Both pages read no session. There is no public per-session route.

### 3.6 Library

| Route | Purpose |
|---|---|
| `/library` · `/library/resources` | Landing and all resources — `?type, topic, language, contributor, from, to` |
| `/library/books` · `/library/books/{slug}` | **Works**, with editions and translations presented on the work page |
| `/library/authors` | Contributor listing — **details 301 → `/people/{slug}`** |
| `/library/topics` · `/library/languages` · `/library/collections` | Filtered browse. `/library/collections` has **no route** after Phase 15: Collections remain Editorial-owned at `/collections`, and a "Collections holding a public Work" view would need Library's current public predicate inside Editorial's bounded page, which neither context may read — so no truthful deterministic filter exists yet, and nothing links to it |
| `/library/articles` · `/library/research` · `/library/research-papers` · `/library/publications` · `/library/encyclopedias` (+ `/{slug}`) | Written works |
| `/library/magazines` · `/{slug}` · `/{slug}/issues/{issueSlug}` | Periodicals |
| `/library/downloads` · `/library/sale-points` | Access |

**Rebaseline R2.** `/library` is a cover-led, data-backed landing rendered per request from the
Library's public reader: the newest publications as a shelf, a shelf for each of the largest topics
and the latest magazine issues, then a directory of every other way in; a shelf with nothing on it is
absent and no deferred capability is linked. `/library/books` takes **`?sort=title|newest`**:
`title` (the default) is A–Z by the title shown in the interface locale (else the Work's primary
title), `newest` the latest publication year among a Work's published Editions first (Works with no
recorded year last, then A–Z); both are total orders ending on the identifier, so pages never repeat
or skip a Work, and an unknown value is the default. The legacy slug order is no longer what a
visitor meets. Like every filter, `?sort` is canonical to the base listing and never a sitemap
entry. A magazine's issues are grouped by year on its page.

**Owner direction 2026-11-08.** `/library` again offers "See every resource type"
(`/library/resources`) in its hero, lists Books first in its directory, introduces each directory
group, and carries the Library's metadata notice — as `/library/books` does again. Each of the
landing's reads fails closed on its own: a read that fails hides only its own shelf, never the
whole page. No route changes.

### 3.7 Watch / Listen

| Route | Purpose |
|---|---|
| `/watch` | Landing — `?sort=featured\|latest`; with nothing featured, the default view opens on Latest and offers no sort tabs |
| `/watch/videos` · `/watch/videos/{slug}` | Videos — `?topic, speaker, series, language`; a Video's page takes `?start` (Quran Part 8: whole seconds within the video, where its Play press begins — ignored otherwise, never part of the canonical address) |
| `/watch/{lectures\|events\|highlights\|interviews\|documentaries}` | Filtered views |
| `/watch/series` · `/{slug}` · `/watch/programs` · `/{slug}` · `/watch/playlists` · `/{slug}` | Groupings — a programme is a Series of kind `program`; each Series is canonical under exactly one of the two families, and the other answers one 301 (Phase 10) |
| `/watch/speakers` | Speaker listing — **details 301 → `/people/{slug}`** |
| `/watch/topics/{slug}` | Filtered view, canonical → `/topics/{slug}` |
| `/listen` · `/listen/lectures` · `/{slug}` · `/listen/series` · `/{slug}` | Audio — a **sibling** of `/watch`, not a child. `/listen/lectures` takes `?topic, speaker, series, language`; each track and audio series is canonical at exactly one address (Phase 11) |
| `/listen/recitations` | **Catalogue projection of Quran-owned recitations**, canonical → `/quran/recitations`. Delivered in Phase 18 as a Layer-4 page over Quran's public reader, present only while a corpus is active — never filled by an AudioTrack |

**Rebaseline R2 — one press plays.** `/watch` is a poster-led landing and `/watch/videos/{slug}`
keeps its privacy facade: no provider request until the visitor presses Play, and that one press now
both loads the provider's privacy-enhanced embed and starts it (`autoplay=1` on the frame the click
creates). To let the browser honour it, the two player routes — `/watch/videos/{slug}` and
`/admin/media/videos/{id}`, in every locale — and only they send a `Permissions-Policy` that
delegates `autoplay` to the page itself and the two embed origins; every other route still declines
`autoplay` (SECURITY_BASELINE.md §16.2; ARCHITECTURE.md §4.7.1). Structured data keeps the plain
embed URL; the CSP is unchanged.

**Owner direction 2026-11-08.** The `/watch` landing's grid shows twelve videos again, and its
browse groups (formats, groupings, find) carry their introductions again. No route changes.

### 3.8 Fatwa

| Route | Purpose |
|---|---|
| `/fatwa` | Landing and browse — **`?sort=latest\|popular`, `?category=`, `?topic=`** |
| `/fatwa/search` | Search — `noindex` |
| `/fatwa/categories` · `/fatwa/categories/{slug}` | Categories |
| `/fatwa/topics/{slug}` | Filtered view, canonical → `/topics/{slug}` |
| `/fatwa/{slug}` | **Canonical published Fatwa URL** |
| `/fatwa/how-it-works` | Process explanation |
| `/fatwa/ask` | **Authenticated** — redirects to sign-in with a validated return path |

`/fatwa/latest` and `/fatwa/popular` are **removed** as paths (§2.3).

**Delivered in Phase 20 (engineering — no real Fatwa authority is granted; DOMAIN_MODEL.md §12.1).**
Every route above. `/fatwa` canonicalises every `sort`, `category`, `topic` and `offset` variant to
itself; `category` takes a category slug and `topic` a canonical topic slug, and an unknown or
malformed value shows an empty, explained result — it never broadens the listing. `sort=latest`
orders by first publication; `sort=popular` by anonymous reads over the trailing 30 UTC days, counted
by a POST the ruling page sends after it renders (never a GET). `/fatwa/{slug}` is the one URL of a
ruling: its slug freezes at first publication, so no slug history or redirect is owed, and it can
never be a section word or `latest`/`popular`. Corrections stay on that URL with a visible history of
earlier published versions and their public correction reasons; a withdrawn ruling answers 404 and
its slug stays reserved. `/fatwa/ask` reads no session — it redirects to `/my/questions/ask`, whose
guard sends a signed-out visitor to sign-in with a validated return path. **Service states:** with no
operator activation the section pages (`/fatwa`, `/fatwa/search`, `/fatwa/categories` and the ask
flow) say plainly that the service is not available and nothing is captured, while a named ruling,
category or topic view answers 404; a fixture activation shows "Test fixture — not a genuine Fatwa"
on every page and is `noindex` with no sitemap entry; only an approved activation is indexable.
Structured data is `BreadcrumbList` only.

**Rebaseline R2 (OPEN_DECISIONS.md §1.4).** No route changes and no ruling is published. With no
activation `/fatwa` is a calm "coming" page rather than a bare refusal: what the service will hold,
how asking will work, and an **outbound link to Minhaj-ul-Quran's own fatwa website**
(`https://thefatwa.com/urdu/index.html`, the one address in `components/fatwa/official-site.ts` —
a plain link, never fetched, embedded or tracked). From R1 until 2026-11-08 the shell did not
promote `/fatwa` until the service was active and a ruling published (historical); since the owner
direction of 2026-11-08 the Fatwa domain is always in the header and links this page, which says
honestly what it holds (INFORMATION_ARCHITECTURE.md §2.2).

### 3.9 News, Events, Media, Global

| Route | Purpose |
|---|---|
| `/news` · `/news/{slug}` | News — `?sort=latest`. Phase 13: `/news` is the News and Events entry point, listing the latest NewsArticles; `latest` is a query canonical to `/news`, never a path |
| `/news/{press-releases\|statements\|media-coverage}` · `/{slug}` | Editorial types — delivered in Phase 13, each family with its own slug history. The three segments and `archive` are reserved: no NewsArticle slug can hold them |
| `/news/archive` | `?year, month` — every published News record by the UTC year and month of its publication (Phase 13) |
| `/newsletter` · `/newsletter/confirm` · `/newsletter/unsubscribe` | Subscription — delivered in Phase 21 (DOMAIN_MODEL.md §14.6). `/newsletter` submits an address and always answers the same, whatever its state; nothing is sent until the address confirms. `confirm` and `unsubscribe` are the emailed links (class D, SECURITY_BASELINE.md §7.4): the GET renders only whether the link is still usable and a button, and the POST consumes it — confirmation once, unsubscribe idempotently and without an account. Both are `noindex`, carry no canonical or alternate with the token, and are never sitemap entries |
| `/events` · `/events/{slug}` · `/events/{slug}/gallery` | Events — `?upcoming, past, country, city, centre`. Delivered in Phase 14: `/events` lists upcoming Events by default and `?when=past` the held ones; `?country=`, `?city=` and `?centre=` narrow to Events held at Centres physically there. Every query is canonical to `/events` and never a sitemap entry; there is no `/events/upcoming` or `/events/past`. `/events/{slug}/gallery` is a `noindex` navigational view over the Event's listed Galleries — each keeps its one canonical `/media/galleries/{slug}` — and exists only for an Event that associates a Gallery. A former Event slug, with or without `/gallery`, answers one 301 |
| `/media/photos` · `/media/galleries` · `/{slug}` · `/media/archive` · `/media/downloads` | Media — Phase 12 delivers photos, galleries, each Gallery at `/media/galleries/{slug}`, and the archive (`?year, month`). A Photo has no page of its own. `/media/downloads` has **no route** until a rights decision authorises downloads |
| `/global` · `/global/find-a-centre` | World network and centre finder — Phase 16. The finder's `?country, region, city` are queries canonical to it |
| `/global/countries` · `/{slug}` · `/{slug}/regions/{regionSlug}` · `/{slug}/cities/{citySlug}` | Geography — intermediate levels may be absent (DOMAIN_MODEL.md §17.1). Delivered in Phase 16; a Region or City address is scoped by its Country, and a former slug at either level answers one 301 |
| `/global/centres` · `/{slug}` · `/{slug}/{news\|events\|contact}` | Centres — `news` and the display-only `contact` delivered in Phase 16; `events` (Local Events, `?when=past` canonical to it) delivered in Phase 14 |
| `/global/pakistan` | Pakistan structure entry point — a view of the Pakistan Country, canonical to its Country page and never a sitemap entry (Phase 16) |

**Rebaseline R2.** `/news` and each family listing (`/news/press-releases`, `/statements`,
`/media-coverage`) take **`?lang=en|ur|ar`**, narrowing to records that have a published
translation in that content language; without it every record is listed with the interface
language's records first (each group still newest first). `/news/archive` also takes
**`?type=`** — one of the four News families — beside `?lang`, `?year` and `?month`, and counts its
periods over the same narrowing. A repeated or unknown value is simply ignored, never broadened
into an error; every variant stays canonical to its base listing and outside the sitemap. The
`/news` landing leads with the newest story and the next three beside it. From R2 until 2026-11-08
`/global/countries` listed every public Country at once (at most 300), grouped by world region
(derived from each Country's ISO 3166-1 code; an unplaced code is shown under "other", never
dropped), its `?offset` paging withdrawn (historical, superseded below).

**Owner direction 2026-11-08.** The `/news` landing again opens with links to Events and the News
archive, and its browse list again names Press releases, Statements, Media coverage and the
archive beside R2's Events, Collections and photograph rows. `/collections` cards again show their
type and their topics (each a link to `/topics/{slug}`), with the kinds a Collection may hold named
under the lede. `/global` always offers Find a Centre and lists the Finder, Countries, Centres and
Pakistan entries whether or not a Centre is published (as at Phase-30 exit), shows local news,
events and contacts, and closes with the directory's data notice. `/global/countries` is paged again
with **`?offset=`** (24 Countries a page, each page grouped by world region; past the end, an
honest empty page), canonical to the bare listing and never a sitemap entry. No route is added.

### 3.10 Legal and machine-readable

| Route | Purpose |
|---|---|
| `/legal/{privacy\|terms\|cookies\|accessibility}` | Compliance surfaces |
| `/robots.txt` · `/sitemap.xml` · `/sitemaps/{segment}-{locale}.xml` | Unprefixed |
| `/assets/{id}` | Unprefixed. Authorisation-checking asset serving, default deny (Phase 7) |
| `/assets/library/editions/{editionId}/{read\|download}/{assetId}` · `/assets/library/previews/{editionId}/{assetId}` | Unprefixed. Library's Edition bytes under Library's own allow/deny policy **and** Storage's technical decision; preview requires live `library.administer` (Phase 8) |
| `/assets/editorial/{article\|page\|news-article\|press-release}/{recordId}/{assetId}` · `/assets/editorial/previews/{family}/{recordId}/{assetId}` | Unprefixed. A published record's lead image under Editorial's policy and Storage's technical decision; the preview requires live `content.read` and an asset named on the record's current revision (Phase 30-R) |
| `/assets/people/portraits/{personId}/{assetId}` | Unprefixed. A published Person's portrait under People's policy (Phase 30-R) |
| `/assets/library/covers/editions/{editionId}/{assetId}` · `/assets/library/covers/issues/{issueId}/{assetId}` | Unprefixed. A published Edition's (of a published Work) or MagazineIssue's (of a published Magazine) cover (Phase 30-R) |
| `/assets/media/posters/{videoId}/{assetId}` | Unprefixed. A published Video's first-party poster — no provider request (Phase 30-R) |
| `/assets/{family path}/{assetId}/{width}w.webp` — beside each of the six public picture routes: editorial lead images, People portraits, Edition covers, MagazineIssue covers, Video posters and `/assets/media/photos/{photoId}/{assetId}` | Unprefixed. A WebP **derivative** of that picture, `{width}` ∈ 320 · 640 · 960 · 1440 (Rebaseline R2). The same two owners decide, about the SOURCE asset, exactly as the sibling picture route does; only then is the derivative looked up. `200`/`304` carry `public, max-age=31536000, immutable` (content-addressed: a new picture is a new asset and a new address); every refusal — a draft's, withdrawn, replaced or restricted picture, an unknown width, a malformed address — is the same `404`, `private, no-store`; a width not rendered yet answers `307` (`no-store`) to the sibling picture route's own path and queues the rendering. All `X-Robots-Tag: noindex, nofollow` (SECURITY_BASELINE.md §10.10) |
| `/rss` · `/rss/{feed}` | Feeds |

Derivatives are rendered on demand (a `307` queues the missing width) and, for pictures already
public, by the idempotent, resumable operator backfill `docker/staging/bin/derivatives-backfill.sh`
(`npm run staging:storage:derivatives`), run as the runtime principal against each picture's owning
policy — nothing restricted, drafted or withdrawn is decoded (ARCHITECTURE.md §4.2). Pages emit a
`srcset` of the widths a picture actually has, never wider than the original.

---

## 4. Authentication routes

| Route | Method | Purpose |
|---|---|---|
| `/{locale}/signin` | GET / POST | Sign in — `?returnTo` |
| `/{locale}/signup` | GET / POST | Register |
| **Sign out** | **POST action only** | **Never a GET route** (§2.4) |
| `/{locale}/forgot-password` · `/reset-password` | GET / POST | Recovery — **GET renders confirmation and token-status UI; the POST performs and consumes** |
| `/{locale}/verify-email` | GET / POST | Verification — **same split** |
| `/{locale}/account-setup` | GET / POST | **Account setup** — Identity-owned: verified email, account interface locale, timezone (DOMAIN_MODEL.md §4.2). **Phase 2** |

**Personalisation onboarding is a different step with a different owner.** Interests, goals,
learner level and preferred format belong to **Personalisation & Notifications** onboarding under
`/my/settings/interests` (§5.1); they are not yet collected, because no delivered surface uses a stored
preference (Phase 22's level and format are catalogue filters chosen per visit). Authentication never depends on it, and the
two are never merged into one route.

`returnTo` is validated against an allowlist of internal paths. **All are `noindex`.** Since
Rebaseline R1 an accepted destination is an unprefixed English path or a `/ur`/`/ar` path; a
legacy `/en/…` value is accepted and returned in its canonical unprefixed form, and the `/teacher`
and `/admin` roots are known destinations.

**Protocol classification** (SECURITY_BASELINE.md §7). These routes are not all one kind of
request, and are not treated as one:

| Surface | Model | Authenticity established by |
|---|---|---|
| Sign-in, sign-up, sign-out, account setup, and the POST half of recovery and verification | **A — browser mutation** (§7.1) | Server-side authorisation · Origin/Host validation · framework-appropriate CSRF controls · **no state-changing GET** |
| Provider redirects and `/api/auth/*` callbacks | **C — authentication callback** (§7.3) | `state` · PKCE · `nonce` · provider callback validation · **verified pre-registered redirect URI** · linking ownership checks — **not ordinary browser POST semantics** |
| The GET half of `/verify-email` and `/reset-password` | **D — emailed link** (§7.4) | A GET **renders** confirmation or token-status UI. It **must not silently perform a protected mutation** where the contract requires an explicit confirmation action. **The token is consumed at the confirming POST, not by rendering.** This is **the platform's chosen integration contract, subject to Phase 2 compatibility proof with Better Auth** — not a claim about Better Auth's own behaviour; if it cannot be met without unsafe divergence, **Phase 2 stops for an architecture decision**. **Expired, reused and invalid tokens remain unusable regardless** |

**No routes are implemented by this document.** Phase 2 delivered the email/password routes
above; Google sign-in and its callbacks remain Phase 2G's, separately gated and not delivered.

---

## 5. My Minhaj routes

All authenticated, all `noindex`, all **private cache** (ARCHITECTURE.md §8.3). At `/my`
(English) and `/ur/my` · `/ar/my` (§1.1).

`/my` · `/my/learning` (+ `/courses/{slug}`, `/paths/{slug}`) · `/my/classes` (+ `/{id}`) ·
`/my/teachers` · `/my/messages` (+ `/{conversationId}`) · `/my/saved` (+ `/bookmarks`,
`/notes`, `/collections`, `/collections/{id}`) · `/my/history/{reading|watch}` ·
`/my/progress` (+ `/quran`, `/courses`) · `/my/questions` (+ `/ask`, `/{id}`) ·
`/my/notifications` · `/my/settings/{section}`

**Ownership.** `/my` is a **Layer-4 authenticated experience and composition surface**
(DOMAIN_MODEL.md §3.3, §14.4). It is **not** a bounded context, and it does **not** semantically
own every operation reachable beneath it:

| Capability under `/my` | Semantic owner |
|---|---|
| `/my/settings` account and security | **Identity & Access** |
| roles and permissions | **Identity & Access** |
| `/my/learning`, `/my/progress` course rules | **Learning** |
| `/my/classes`, `/my/teachers` operations | **Learning** / the teacher-owning phase as documented |
| `/my/messages`, including **Support** | **Messaging** (DOMAIN_MODEL.md §15.5) |
| `/my/questions` | **Fatwa** |
| `/my/saved`, `/my/history`, `/my/notifications`, preferences | **Personalisation & Notifications** (DOMAIN_MODEL.md §14) |
| membership | **Membership** |
| donations | **Donations** |

> **Route placement transfers no semantic or domain ownership.** These routes *compose* the
> capabilities through their owning contexts' public interfaces. Personalisation &
> Notifications owns the aggregates of DOMAIN_MODEL.md §14.1 — and only those.

**Rebaseline R2 — My Minhaj's own frame and grouped navigation.** No `/my` route is added or
removed. The area's navigation (`apps/web/src/components/my/sections.ts`) lists its sections in ten
fixed groups — Home · Library (saved, notes, collections, history) · Quran (`/my/progress/quran`) ·
Learning (`/my/learning`, `/my/classes`, `/my/teachers`) · Messages · Questions · Membership ·
Giving (`/my/donations`) · Notifications · Settings.

**Every section, always (owner direction 2026-11-08).** The navigation lists every section above
for every account, and the `/my` home has a module for each — with an honest empty or "not
available yet" state rather than disappearing; each page says in words when its service is not
switched on. My Learning, My Classes, My Teachers and the Messages pages carry their neighbour
links again. A person Identity & Access says may enter `/teacher` (live `teaching.perform`) or
`/admin` (any permission that opens an administrative surface — the admin shell's own
`reachableSurfaces` filter) also sees a "Your work" group linking there, decided server-side by the
`/my` layout from the session's live permission evaluation (`apps/web/src/app/[locale]/my/staff.ts`,
rule in `staff-areas.ts`); no session or a failed read offers neither, and the target areas keep
their own gates. **This is presentation, never a control.** *Historical, superseded 2026-11-08:*
R2 offered a section only while the deployment had switched its capability on, from each owner's
session-free read (the former `my/capabilities.ts`), and the home's modules rendered only when there
was something to show.

### 5.1 Route, owner and delivery register

`/my` is **incremental**. It does not appear complete on the day authentication ships, and the
register below says exactly which part arrives with which owner — so a promised surface is
never mistaken for a delivered one.

**My Minhaj**

| Route | Semantic owner | Delivered by |
|---|---|---|
| `/my` — base account landing | Identity & Access | **Phase 2** |
| `/my/settings/profile` | Identity & Access | **Phase 2** |
| `/my/settings/security` — password, sessions, connected accounts, second factor | Identity & Access | **Phase 2** |
| `/my/settings/language` — **account** interface locale and timezone | Identity & Access | **Phase 2** |
| `/my/settings/interests` | Personalisation & Notifications | **Phase 21** |
| `/my/settings/notifications` | Personalisation & Notifications | **Phase 21** |
| `/my/settings/privacy` | Composed at Layer 4 over each owner | **Phase 21** |
| `/my/saved`, `/my/history`, `/my/notifications`, personalised home panels | Personalisation & Notifications | **Phase 21** |
| `/my/progress/quran` | Personalisation & Notifications | **Phase 21** |
| `/my/questions/*` | **Fatwa** | **Phase 20** |
| `/my/learning`, course progress | **Learning** | **Phase 22** |
| `/my/classes/*`, `/my/teachers` | **Learning** (teacher slice) | **Phase 23** |
| `/my/messages/*`, including **Support** | **Messaging** | **Phase 24** |
| `/my/membership` | **Membership** | **Phase 26** |
| `/my/donations` — user-linked donation history and a linked start | **Donations** | **Phase 27** |

**Delivered in Phase 21.** `/my/saved` (+ `/bookmarks`, `/notes`, `/collections`,
`/collections/{id}`), `/my/history/reading`, `/my/history/watch`, `/my/progress/quran`,
`/my/notifications`, `/my/settings/interests`, `/my/settings/notifications` and
`/my/settings/privacy`, plus the Personalisation panels of `/my`. Every one is private, `noindex`
and per request, and every read and write is keyed by the signed-in account in its own query — a
guessed collection id answers exactly like a missing one. There is no `/my/progress` landing and no
`/my/history` landing, because the register names none. `/my/questions/*` stays Fatwa's. `/my/settings/privacy` composes the history
switch, the Personalisation export and the Identity-owned closure (linked, not duplicated); the
newsletter is managed from its own links because it is not the account's.

**Delivered in Phase 22.** `/my/learning`, `/my/learning/courses/{slug}`,
`/my/learning/paths/{slug}` and `/my/progress/courses`, plus the Learning panel of `/my` — Learning's,
composed at Layer 4. Each is private, `noindex` and per request, and reads only the signed-in account's
own Enrolments, Progress and trial requests; a Course the account is not enrolled on answers like a
missing one. A lesson is completed only by the learner's explicit act. Path progress is derived from
the account's Course Enrolments — there is no path enrolment. `/my/settings/privacy` also offers the
Learning export.

**Delivered in Phase 23.** `/my/classes`, `/my/classes/{id}` and `/my/teachers` — Learning's,
composed at Layer 4. Each is private, `noindex` and per request, and reads only the signed-in
account's own classes: upcoming regular sessions through a current Enrolment, trial sessions through
the account's own confirmed Booking, past classes through participation and Attendance. A guessed
session id answers like a missing one. The meeting link appears only under the disclosure rule
(SECURITY_BASELINE.md §11) and never on a completed or cancelled class; a learner may cancel their
own confirmed future trial Booking and nothing else. `/my/teachers` lists teachers the account
genuinely has a class relationship with, by their public People profile — never every attribution
or every TeacherProfile. `/my/messages/*` stays Phase 24's.

**Delivered in Phase 24.** `/my/messages`, `/my/messages/{conversationId}` and `/my/messages/support` —
Messaging's, composed at Layer 4; the IA's `Messages → Support` is the `support` subroute (a static
segment, so it never collides with a conversation id). Each is private, `noindex` and per request.
The list and every thread re-decide access from the current relationship on each request; a person
whose relationship ended sees an ended state and none of the history, and a guessed id answers like a
missing one. A learner starts a conversation from My Teachers, only with a teacher who currently
teaches them a Course. Nothing here is realtime: new messages arrive on refresh or through the
"check for new messages" catch-up. `/my` gains an unread-messages panel, and
`/my/settings/privacy` the Messaging export.

**Delivered in Phase 26.** `/my/membership` — Membership's, composed at Layer 4. Private, `noindex`
and per request, it reads and writes only the signed-in account's own applications and Memberships;
a guessed id answers like a missing one. It lists the published types the account may apply for, its
open applications (withdrawable), its Memberships (closable by the member) and a bounded history. An
applicant needs no staff key. `/my` gains a Membership panel, and `/my/settings/privacy` the
Membership export. The public `/membership` lists published types for everyone, reads no session and
links to `/my/membership`; there is no per-type public route.

**Delivered in Phase 27.** `/my/donations` — Donations', composed at Layer 4. Private, `noindex`
and per request, it lists only the signed-in account's own LINKED donations (bounded, newest first:
campaign, exact amount and currency, state, refunded amount, instants, a TEST marker outside
production) and offers the linked start form; another account's donation resolves to nothing. A
donation is linked only when an active account starts it here — an anonymous donation never links
later. `/my` gains a Donations panel, and `/my/settings/privacy` the Donations export.

**Donor return and status (Phase 27)**, outside the cache-safe public tree because they read the
request: `/donate/return` is the provider's success and cancel URL — a constant page that ignores
any query string, mutates nothing and, when the browser holds the HttpOnly status cookie, redirects
to `/donate/status/{token}`; `/donate/status/{token}` shows one donation's provider-verified status
to the holder of its 32-byte opaque token (a malformed and an unknown token answer alike), with
"check again" and, while the checkout is open, "cancel" as Server Actions. Both are `noindex`,
`no-referrer`, `private, no-store`. There is no route by donation id.

> **Personalised home panels appear only for owners that actually exist.** The `/my` landing
> composes what has been delivered; it does not render an empty frame for a context that has
> not shipped.

**Public and operator surfaces whose ownership was previously unstated**

| Route | Semantic owner | Delivered by |
|---|---|---|
| `/contact` — submission | **Editorial** correspondence (DOMAIN_MODEL.md §7.5) | **Phase 6** |
| `/feedback` — submission | **Editorial** correspondence | **Phase 6** |
| Published contact *information* | **Editorial** — a `Page` | **Phase 6** |
| `/help`, `/help/{article}` | **Editorial** — `Page` records | **Phase 6** |
| `/newsletter` — subscribe and confirm | **Personalisation & Notifications** (DOMAIN_MODEL.md §14.5) | **Phase 21** |
| `/rss`, `/rss/{feed}` | The publishing content contexts, composed at Layer 4 | With the domains they syndicate |
| `/sitemap` — the human-readable one | Layer 4 composition | **Phase 4**, extended as domains ship |
| `/search` — unified search; `/search/limited` — the throttled state it redirects to | **Search** Layer-0 infrastructure, composed at Layer 4 over each owner's public projection | **Phase 17** |
| `/topics`, `/topics/{slug}` — the canonical taxonomy browser and topic hub | **Taxonomy** owns the Topic; Layer 4 composes the hub over owners that have shipped (Library books today; Search within the topic) | **Phase 17**, because Topic search results must be navigable into `/topics/{slug}`; each later domain adds its own section when it ships |
| `/membership` — public information | **Membership** | **Phase 26** |
| Public class and trial schedule | **Learning** | **Phase 22** catalogue; confirmed sessions **Phase 23** |
| **Volunteer** (footer) | **Editorial** — a `Page` describing how to volunteer | **Phase 6**. **No volunteer-management software is introduced** |

**Administrative surfaces**

| Surface | Semantic owner | Delivered by |
|---|---|---|
| `/admin/identity/{users,roles,permissions,assignments}` | Identity & Access | **Phase 2** |
| Identity security: second-factor state, bootstrap status | Identity & Access | **Phase 2** |
| `/admin/system/audit` | Identity & Access, over audit records | **Phase 2**, extended as domains add audited events |
| `/admin/editorial/correspondence` — contact and feedback triage | **Editorial** | **Phase 6** |
| `/admin/system/redirects` — native slug history **and** legacy mappings, distinguished | Each owning context; legacy rows from **Migration** | **Phase 6** onward; legacy rows **not yet delivered**. Phase 29 created the legacy mapping data and lists, disables and re-enables it at `/admin/migration/url-mapping` (§7); no `/admin/system/redirects` surface exists, and no legacy 301 is served until Phase 35 |
| `/admin/system/search` — configuration, rebuild, indexing lag and failures | Search infrastructure, operated at Layer 4 | **Phase 17** |
| `/admin/system/integrations` — provider configuration and status | Platform integrations | **Phase 2** for email; extended per provider |
| `/admin/communications/newsletter` | **Personalisation & Notifications** | **Phase 21** — delivered: subscription counts and a paginated list of masked addresses, states and consent dates under `newsletter.read`; suppress and reinstate (to `unsubscribed`, requiring fresh confirmation) under `newsletter.operate`. No campaign, sending or segmentation surface exists |
| `/admin/communications/delivery` — pending, failed, suppressed mail | The shared communication concern | **Phase 2** |
| `/admin/system/navigation` | Layer 4 shell | **Phase 4**, only to the extent it is genuinely promised. Read-only. Since Rebaseline R1 its Placement column (registry `placements`) is replaced by a **Promotion** column — always / waits for a named signal / promoted now / not promoted (reachable by address) — from the content-aware presentation policy (INFORMATION_ARCHITECTURE.md §2.2). Since Rebaseline R2 the rule is one of three kinds — **always**, a **signal** (promoted now / waiting for it) or a published **Page** binding (promoted now / waiting for its Page), matched by route key or by the route's address — or not promoted (historical). Since the owner direction of 2026-11-08 the navigation is unconditional and the column says, per route, whether the header or footer **always** links it or it is reachable by its address only (`shellLinkedKeys` in `apps/web/src/shell/menus.ts`) |

**Every route above carries:** a semantic owner · a delivery phase · availability rules
(§5.2) · defined empty, loading and error behaviour where applicable · and permissions where
applicable.

> **Layer-4 route placement transfers no domain ownership** (DOMAIN_MODEL.md §3.3, §14.4).
> Every row above composes its owner's public interface.

### 5.2 Availability of deferred or optional capability

A capability can be **in scope but not yet delivered** (everything in §5.1 with a later phase),
or **optional and legitimately unavailable** in a given deployment (a provider that has not been
configured). In both cases the visible behaviour must be honest.

**A deferred or unavailable capability must never appear as:**

- ✘ **dead navigation** — a menu entry or footer link to a route that does not work;
- ✘ **a dead call to action** — a button that leads nowhere or fails silently;
- ✘ **a secret or configuration runtime error** — an unconfigured provider must never surface a
  stack trace, an environment variable name, or a missing-credential message to a visitor;
- ✘ **a broken sitemap promise** — an undelivered route is **never** listed in a sitemap.

**Instead:** the entry point is either **absent until its phase delivers it**, or present with
an **explicit, accessible unavailable state** that explains the situation in the visitor's
locale. An optional capability that is switched off **fails closed and quietly**, and the
failure is **visible to operators** rather than to the public
(ARCHITECTURE.md §4.6.1, §8.5).

> **No generic feature-flag platform is introduced.** This is a rule about honest surfaces, not
> a runtime toggling product.

This rule governs **committed work that has not arrived yet**. Work that nobody has committed to
at all — Minhaj Guide, certificates, learning streaks, a narrator-management subsystem — is
governed by PRODUCT_SCOPE.md §4.4, and gets **no route and no navigation entry at all**.

---

## 6. Teacher routes

Require a current `teaching.perform` assignment. All `noindex`, private cache. At
`/teacher` (English) and `/ur/teacher` · `/ar/teacher` (§1.1).

`/teacher` · `/teacher/classes/today` (+ `/{id}`) · `/teacher/calendar` ·
`/teacher/students` (+ `/{id}`) · `/teacher/courses` (+ `/{id}`, `/{id}/students`,
`/{id}/sessions`, `/{id}/materials`) · `/teacher/messages` (+ `/{conversationId}`) ·
`/teacher/resources` · `/teacher/attendance` (+ `/{sessionId}`, `/reports`) ·
`/teacher/availability` · `/teacher/profile`

**Meeting URLs appear only on authenticated, private-cached pages** for authorised
participants (SECURITY_BASELINE.md §11).

**Delivered in Phase 23.** Every route above **except `/teacher/messages` and its conversation
view**, which stay Phase 24's and have no link. Every page requires an active session holding a
live `teaching.perform` assignment AND a current typed scope on the Course concerned, re-read per
request; a signed-in account without that authority gets the same 404 an administrative page gives,
and with no live-learning activation the area renders an honest unavailable state. `/teacher/profile`
is read-only — the public TeacherProfile is People's and is edited by People's own administration.
`/teacher/resources` and `/teacher/courses/{id}/materials` are truthful views over the Course's own
syllabus and lesson bodies; there is no upload.

**Delivered in Phase 24.** `/teacher/messages` and `/teacher/messages/{conversationId}` — Messaging's,
composed at Layer 4, now linked from the Teacher navigation. They list and open the teacher's own
teacher↔student conversations; each request re-reads the live `teaching.perform` assignment, the
current scope and the learner's Enrolment on that Course, so a revoked or replaced teacher sees the
conversation as ended and nothing of it. A teacher starts a conversation from a learner's Student
Detail, per Course they currently teach that learner on — there is no learner directory.

**Rebaseline R2.** No Teacher route is added. `/teacher/calendar` and `/teacher/availability` show a
**week** — Monday to Sunday (ISO 8601) in every interface language, each day a calendar day in the
teacher's own zone — chosen by **`?week=YYYY-MM-DD`** (any date of that week; a malformed or unreal
date, or one beyond 53 weeks back or 27 ahead, is this week, never repaired); `/teacher/availability`
pages its list independently with `?offset=`. Each class shows its stage — upcoming, live, ended,
completed or cancelled — and **the UI never offers attendance or "mark held" before a class has
started**, mirroring Learning's `not-started` refusal (DOMAIN_MODEL.md §13.5), which stays the
authority. `/teacher/students` lists the bounded page of learners the service returns (names from
Identity, progress from Learning, the listing audited) with a search by name and progress that
narrows that page in the browser only and reads nothing new; a class's "mark held" and "cancel"
open in a dialog (ARCHITECTURE.md §13). Every Teacher page names itself in the title template
("Calendar · Teacher area · One Minhaj") with fixed words — a class or learner page is "Class" or
"Student", so no learner's name reaches a tab or history; all stay `noindex`.

**Teacher home sections (owner direction 2026-11-08).** `/teacher` again lists every section of the
area — Today's classes, Calendar, Students, Messages, Courses, Resources, Attendance, Availability,
Profile — plus the attendance reports, both on the full home and on the "no course yet" home
(R2 had narrowed the list to four shortcuts — historical, superseded). A teaching-authority holder
reaches `/teacher` from My Minhaj's "Your work" group (§5).

---

## 7. Admin routes

Permission-checked **server-side per route and per action**. All `noindex`, private cache.
At `/admin` (English) and `/ur/admin` · `/ar/admin` (§1.1).

| Area | Routes |
|---|---|
| Dashboard | `/admin` |
| Editorial | `/admin/editorial/{articles\|pages\|news\|press-releases\|statements\|media-coverage\|events\|collections\|queue\|correspondence}` — **correspondence** covers private ContactInquiry and Feedback triage (DOMAIN_MODEL.md §7.5); `news`, `press-releases`, `statements` and `media-coverage` delivered in Phase 13, `events` in Phase 14, `collections` in Phase 15, and `queue` lists every workflow-governed aggregate |
| Quran | `/admin/quran/{surahs\|ayat\|translations\|tafsir\|transliterations\|word-by-word\|recitations\|tajweed}` — delivered in Phase 18 (`word-by-word` in Quran Part 7); `tajweed` holds TajweedRule guidance. Canonical text is read-only; the correction flow on an Ayah appears only to `quran.editCanonical` holders after a `quran-canonical-edit` step-up. No corpus import surface exists. Quran Part 5: `recitations` names each recitation's language (a required choice on its form) and its audio source — "Uploaded files" or "Streamed from cdn.mp3quran.net", the stream's provider folder shown read-only, never a field — and each segment's timing ("Timed: n of m ayat" or "Not timed"); a streamed recitation offers no upload and no new segment (its whole-Surah segments come only from the operator's import). Quran Part 6: `translations/{id}?surah=` shows each Ayah's translator's notes beneath its text — to `quran.administer` a marker field and a textarea per note and one empty slot to add one, saved with the text (same version and audit; a note that answers no mark is refused); read-only to `quran.read`. Quran Part 7: `word-by-word` lists every word-by-word work in any state and creates one (`quran.administer`); `word-by-word/{id}` holds its lifecycle, metadata and credited People, and with `?surah=` a gloss editor — each Arabic word of the stored text, read-only, beside a one-line gloss field, saved whole per changed Ayah under the work's version and audit, a position the Ayah does not have refused (`word-outside-ayah`); read-only to `quran.read`. Quran Part 9: `tajweed` also shows each tajweed colour overlay — its source, state, version, ayat coloured, marks, marks per rule and ayat whose canonical text has changed since (not shown publicly) — with publish / draft / archive to `quran.administer`; there is no span editor (spans arrive only from the operator's import) |
| Hadith | `/admin/hadith/{collections\|books\|chapters\|records\|commentary\|sciences}` — delivered in Phase 19; `sciences` holds HadithScience study material. Registered source systems, editions and activation are shown read-only (operator-only). Records are read-only by default; structure and record creation, correction, verification and citation mapping appear only to `hadith.editCanonical` holders after a `hadith-canonical-edit` step-up. Conflict evidence is shown with no resolve action. No corpus import surface exists |
| Fatwa | `/admin/fatwa/{questions\|assignment\|drafts\|review\|published\|categories}` — delivered in Phase 20. `questions` and `assignment` under `question.receive` (a question's private text only on its detail page, recorded as an audited access); `drafts/{questionId}` under `fatwa.answer` for the current assignee only; `review/{fatwaId}` and `published/{fatwaId}` under `fatwa.publish`, publication and withdrawal behind a `fatwa-publication` step-up and never offered to the revision's author; `categories` readable by any Fatwa key and maintained under `fatwa.publish`. No import, bulk or generation surface exists |
| Library | `/admin/library/{works\|editions\|translations\|research\|publications\|magazines\|encyclopedias\|sale-points}` — research papers at `research/papers`, and a Magazine's issues beneath it at `magazines/{id}/issues/{issueId}` (Phase 9). Quran Part 8: `works/{id}` holds the Work's **Quran passages** — listed in order, each moved one place or removed by a named button, one small form to add (Surah, from, to), each under the Work's version (`library.administer`) |
| Media | `/admin/media/{videos\|audio\|photos\|galleries\|playlists\|series\|assets}` — `videos`, `series` and `playlists` delivered in Phase 10; `audio` in Phase 11, with audio series at `audio/series`; `photos` and `galleries` in Phase 12. There is no generic `assets` file manager: a file is managed on the record it belongs to. Quran Part 8: `videos/{id}` holds the Video's **Quran passages**, as a Work's, each with an optional start ("12:34") |
| People | `/admin/people/{persons\|authors\|speakers\|scholars\|teachers}` |
| Identity | `/admin/identity/{users\|roles\|permissions\|assignments\|security}` — **security** covers second-factor state, bootstrap status and identity audit (SECURITY_BASELINE.md §8) |
| Taxonomy | `/admin/taxonomy/{topics\|mapping\|languages\|tags}` |
| Learning | `/admin/learning/{courses\|paths\|classes\|enrolments\|trials}` — `courses` (with each Course's modules and lessons), `paths`, `enrolments` and `trials` delivered in Phase 22 under `learning.read` / `learning.administer`. A published Course's syllabus is frozen until it returns to draft. `enrolments` and `trials` show counts per Course, never who; `trials` showed counts only in Phase 22. **Phase 23:** `classes` (sessions, a session's participants and
attendance, new regular sessions, reschedule, cancel, complete, teacher replacement, and the typed
teaching scopes) under `learning.classes.read` / `learning.classes.administer`; `trials` additionally
shows who asked and confirms a request into a Booking on a teacher's open window under the same keys —
`learning.read` alone keeps the count-only view. Identity reads are audited |
| Global | `/admin/global/{countries\|regions\|cities\|centres}` — delivered in Phase 16; a Centre's contacts and served Cities are managed on the Centre |
| Membership | `/admin/membership` · `/applications` · `/applications/{id}` — delivered in Phase 26 under `membership.read` (every page) and `membership.administer` (every action). `/admin/membership` holds the type catalogue in every state (create; a type's editor at `?type={id}` for display order, per-locale words, publish and archive) and the bounded member list with an operator's closure; `applications` is the bounded queue (status and type filters, oldest first); `applications/{id}` is one application with its start-of-review, approve and reject decisions, version-checked. Applicants and members appear by display name only; opening an application and every listing are audited accesses. No payment, fee or dues control exists |
| Donations | `/admin/donations` · `/{id}` · `/campaigns` · `/campaigns/{id}` — delivered in Phase 27 under `donations.read` (every page and the CSV export), `donations.administer` (campaign lifecycle and currency policy, an operator's provider re-check) and the externally gated `donations.refund` with a `donation-refund` step-up (refunds). `/admin/donations` is the bounded record list (state, campaign, environment, anonymous or linked, attention filters) with a CSV export at `/api/admin/donations/export`; `/{id}` one donation's exact money, state, redacted provider references, reconciliation state and refunds, naming a linked donor only by the display name Identity reports (listings and the export say linked or anonymous); `campaigns` the catalogue in every state. Listings, details and exports are audited accesses. No card, payer credential or raw provider event is ever shown |
| Messaging | `/admin/messaging/{support\|moderation\|reports}` — delivered in Phase 24. `support` (+ `/support/{conversationId}`) under `messaging.support`: the queue shows metadata only, opening a conversation's content is an audited access, and claiming, replying and resolving are versioned. `moderation` (open reports, oldest first) and `reports` (+ `/reports/{reportId}`) under `messaging.moderate`: identifiers and reasons in the lists, the bounded evidence one report authorises on its own page (audited), and the immutable dismiss / withhold / close decision. Both keys are externally gated and held by nobody; a Platform Administrator holds neither |
| Migration | `/admin/migration` · `/sources` · `/runs` · `/runs/{id}` · `/staging` · `/staging/{id}` · `/duplicates` · `/url-mapping` · `/errors` · `/manifests` · `/manifests/{id}` · `/reconciliation` — delivered in Phase 29 over **fixture sources only** under `migration.read` (every page), `migration.administer` (every preparing, reviewing or correcting act) and the externally gated `migration.publish` with a `migration-publication` step-up (publish, rollback, promotion approval — checked by the action, the service and the database). `/admin/migration` is the overview; `sources` registers fixture sources (no authority field) and edits name, state, language, politeness and notes; `runs` and `runs/{id}` show each run's provenance, reconciliation and items, and cancel an open run — runs are started and resumed by the command line, never here; `staging` is the review queue and `staging/{id}` one revision as escaped text, its links, assets and rights, and the raw snapshot's metadata with an audited escaped preview (`?preview=1`), download and disposal; `duplicates` merges, separates or reopens candidates (a cross-language pair offers no merge); `url-mapping` holds the legacy URL mappings, category-to-topic mappings and unresolved links; `errors` retries or dismisses errors (an access failure never offers a retry) and classifies missing records; `manifests` prepares manifests from a completed, balanced run and lists promotions; `manifests/{id}` publishes, rolls back, discards and starts a promotion, which the command line carries once approved; `reconciliation` lists completed runs with their verdict. `noindex, nofollow`, per request; every act on an existing row carries the version shown, and every act is audited. **Phase 30:** `sources` also lists the **authorised** sources — registered by the operator command, never here — with their content kind, written authorisation reference and date as escaped text, and activates or pauses them; `staging` shows each revision's content kind, marks the review-only Fatwa and Quran kinds, and offers a bounded bulk review of the revisions on one page (each decided and audited on its own); `staging/{id}` states plainly that review-only material is never published by migration; `manifests` never offers a review-only revision, and `manifests/{id}` shows each entry's target kind and stage (`public`, or `in-review` — delivered into Editorial's own review). **Phase 30-R:** `runs/{id}/rights` lists a run's still-restricted image acquisitions, each with its original address, measured box, public copy and recorded rights, and decides them `public-eligible` one by one or in a bounded bulk act (only `organisation-owned` or `licensed`, with stated evidence and rights holder; each acquisition decided and audited on its own); `manifests` offers only the approved revisions **no live manifest entry holds**, so a run larger than one page is manifested page after page |
| Communications | `/admin/communications/{newsletter\|delivery}` — subscriber and suppression state; pending, failed and suppressed outbound mail |
| System | `/admin/system/{navigation\|redirects\|search\|audit\|integrations\|settings}` — **redirects** distinguishes native slug history from legacy mappings; **search** covers configuration, rebuild, indexing lag and failures; **integrations** covers provider configuration and status |

**Rebaseline R2.** Additions and changes, each permission-checked as above:

- **Area roots.** `/admin/{communications|editorial|global|hadith|identity|library|media|people|quran|system|taxonomy}`
  — formerly a 404 for everyone — now redirect to the first surface of that area the reader's keys
  open, in the navigation's own order; holding none is the administrative 404. The destination
  re-checks its own permission. The Fatwa, Learning and Messaging roots keep their own rules.
- **Dashboard.** `/admin` is queue-first: per area the viewer can act in, how much work waits —
  each number from the owning context's own service (an existing bounded listing's total, or a
  count added for this: Membership's open applications, Donations' attention flags); counts name
  nobody and are not audited accesses, and a failed read says "unavailable" on its card only.
- **One shared pager** for every administrative listing (numbered where the total is known,
  previous/next otherwise); administrative navigation groups with no reachable surface are not
  shown; every page carries its own title; irreversible and privilege-changing forms (identity
  users, roles and assignments, learning courses, URL mappings, search rebuild, the bulk acts below)
  ask in a confirmation dialog, with a reason where the change wants one — presentation only, the
  action still re-checks everything (SECURITY_BASELINE.md §7.1).
- **`/admin/system/audit`** takes `?action=` (a **prefix** of action names — `role.` finds every
  role action), `?actor=` (an account identifier) and `?from=`/`?to=` (calendar days, inclusive,
  UTC); a value that does not fit its shape is dropped — the filter is not applied — and a reversed
  range is put the right way round.
- **Editorial queue.** `/admin/editorial/queue` offers, per kind, a bulk **approve and publish** of
  the selected in-review rows on the page (at most 25, each at the version shown), after an explicit
  confirmation, to an actor holding both `content.review` and `content.publish`; every record goes
  through the single-record workflow and is audited on its own, self-approval still refused
  (SECURITY_BASELINE.md §3.5).
- **Migration run-wide acts** (SECURITY_BASELINE.md §10.11; MIGRATION_STRATEGY.md §19):
  `/admin/migration/runs/{id}/approve` lists a completed, balanced run's approval candidates —
  pending, valid, free of personal data, of a publishable kind, with no open duplicate — with the
  counts it leaves out, and approves the confirmed set (its size and SHA-256 fingerprint) in slices
  of at most 150, each revision through the single review's checks and audit and re-checked for an
  open duplicate just before; `runs/{id}/rights?host=` does the same for a run's restricted pictures
  on one registered page or asset host, each shown through the administrative preview
  `/api/admin/migration/assets/{provenanceId}` (§8); `manifests?run=` drafts a manifest over the next
  100 approved revisions no live manifest holds. Each act is under `migration.administer`;
  publication still needs `migration.publish` and its step-up.
- **Quran.** While no corpus exists, `/admin/quran/surahs` shows a holder of `quran.editCanonical`
  the `quran-canonical-edit` step-up an operator's host-side corpus acceptance needs; nothing on the
  screen imports or accepts anything (DOMAIN_MODEL.md §8.4). The corpus status names the
  `reference` authority beside fixture and approved.

**Route-level authorisation is never sufficient.** Every mutation re-checks permission at the
action layer. **Privileged actions require step-up reauthentication** (SECURITY_BASELINE.md
§8). **Raw migration snapshots render inertly** — escaped text or sandboxed download, never
live HTML (SECURITY_BASELINE.md §10.3).

---

## 8. API and integration route categories

Categories, with the endpoints each delivered phase added. The full endpoint contract is each
owning phase's handlers and tests, not this table.

| Category | Base | Purpose |
|---|---|---|
| Auth | `/api/auth/*` | Delegated to the authentication library |
| Search | `/api/search/*` | Search, suggestions, typeahead |
| Content read | `/api/content/*` | Public read for progressive enhancement |
| Personal | `/api/my/*` | Authenticated personal actions. Phase 21: `target-state` (GET) and `bookmarks`, `notes`, `collection-items`, `history`, `quran-progress` (POST) serve the private island on public content pages after hydration, and `export` (GET) returns the person's Personalisation data as a JSON download. Phase 22: `learning/state` (GET) and `learning/enrolments`, `learning/trials` (POST) serve a Course page's private island, and `export/learning` (GET) returns the person's Learning data. Phase 26: `export/membership` (GET) returns the person's Membership applications and Memberships. Phase 27: `export/donations` (GET) returns the person's linked donations. Rebaseline R1: `account-state` (GET, same-origin only) answers only `{ signedIn: boolean }` for the shared header's account island, so the public HTML stays identical for everyone. Quran Part 1: `quran-position` (GET, same-origin only, no query) answers only `{ signedIn: false }` or `{ signedIn: true, position: { surah, ayah } | null }` for the session's own account, for the reader's "Continue where you stopped" card. Every response is private and `no-store`; every POST requires the configured origin, `Sec-Fetch-Site: same-origin` where sent and the `x-minhaj-intent: personal` header (SECURITY_BASELINE.md §7.1 rule 6) |
| Messaging REST | `/api/messaging/*` | Phase 24: `conversations/{id}/messages?after={sequence}` (GET) — durable catch-up after a sequence the reader holds, the source Phase 25 reconnection uses; `conversations/{id}/attachments` (POST) — one attachment's streamed raw body, JPEG, PNG or PDF up to 5 MiB, Class A with `x-minhaj-intent: messaging-attachment`; `attachments/{id}/discard` (POST) — release an unsent upload. Every response private and `no-store`; current access re-decided on every request |
| Teacher / Admin | `/api/teacher/*` · `/api/admin/*` | Role-gated operations |
| Migration | `/api/admin/migration/*` | Import control and status. Phase 29 delivers two private reads, GET only: `runs/{id}` — one run's state, discovery, reconciliation and item counts as JSON under `migration.read` (identifiers, states and numbers only); `snapshots/{id}` — one raw snapshot's bytes under `migration.administer`, an audited read sent as an inert attachment (`application/octet-stream`, `nosniff`, `sandbox; default-src 'none'`, `private, no-store`; SECURITY_BASELINE.md §10.5). A cross-site Fetch-Metadata request is refused first and every refusal is the same empty 404. Runs and promotions are started by the command line, mutations are Server Actions; nothing here changes state. Rebaseline R2 adds `assets/{provenanceId}` (GET) — the administrative preview of one acquisition's metadata-stripped **public copy** under a live `migration.administer`, never the acquired evidence bytes or any other asset, served inline with its verified image type, `nosniff`, a sandboxing policy and `private, no-store`; every refusal is the same empty 404 (SECURITY_BASELINE.md §10.11) |
| Media | `/api/media/*` | Asset serving and signed downloads |
| Messaging bytes | `/assets/messaging/attachments/{id}` · `/assets/messaging/support/{id}` · `/assets/messaging/evidence/{reportId}/{id}` | Phase 24: a participant's attachment, a support staff member's (audited) and a moderator's inside one report's evidence (audited). Images `inline`, PDFs `attachment`; `private, no-store`, `nosniff`, CORP same-origin; one 404 for every denial. No signed or public URL |
| Media upload | `/api/admin/media/audio/{id}/asset` · `/api/admin/media/photos/{id}/asset` | Phase 11: one track's audio file; Phase 12: one Photo's image. `POST` only, a streamed raw body — Class A with explicit anti-CSRF (SECURITY_BASELINE.md §7.1) |
| Quran upload | `/api/admin/quran/recitations/{id}/segments/{segmentId}/asset` | Phase 18: one recitation segment's audio file, by the same streamed Class-A pattern. Its bytes are served at `/assets/quran/recitations/…` and previewed at `/assets/quran/previews/recitations/…`; nothing is offered as a download |
| Quran recitation data | `/api/quran/recitations/{slug}/{surah}` | Quran Part 5: PUBLIC, GET only — one public recitation's playable segments for one Surah, each addressed by its asset identifiers or the allowlisted stream descriptor (never a URL), with per-Ayah timing where timed, and an aligned narration's passages (translation audio) (§3.3). No Identity, no query; malformed or not public now is a 404; `private, max-age=300`, `noindex` |
| Webhooks | `/api/webhooks/{provider}` | **Signature-verified, idempotent, replay-resistant**. Delivered: `resend` (Phase 2) and `stripe` (Phase 27 — the sandbox engineering adapter's Class-B callback: POST only, 64 KiB raw-byte cap, signature verified before parsing, durable scoped event dedup, provider truth re-read before any state change) |
| Health | `/api/health` · `/api/ready` | Unprefixed operational probes |

**Realtime** (delivered in Phase 25): `/socket.io/*`, reverse-proxied with WebSocket
upgrade. Not part of the Next.js route tree. It causes persistence **only** by invoking the
Messaging-owned services hosted in `packages/server-core`, and **never holds raw database
capability** — no client, delegate, transaction handle, raw-query facility or persistence
adapter, directly or through any intermediate package (ARCHITECTURE.md §3.1.1–§3.1.2). WebSocket transport only, the exact application `Origin`, the session cookie
re-resolved on every event, and no Next route, page, sitemap entry or public content behind it.

**Every endpoint carries endpoint-appropriate server-side validation and the controls
appropriate to its protocol class** (SECURITY_BASELINE.md §7). **Authorisation is re-checked
independently wherever an authenticated principal and a protected resource are involved.** The
**four protocol security classes** are not interchangeable:

- **Class A — browser-initiated mutations.** Server Actions and Route Handler mutations from the
  platform's own UI: server-side authorisation, Origin/Host validation, framework-appropriate
  browser CSRF protection, and **no state-changing GET** (§7.1).
- **Class B — `/api/webhooks/{provider}`**, a **signed machine callback**: signature
  verification, timestamp/window checks, replay prevention, idempotency and server-side payload
  validation (§7.2). It requires **no browser CSRF, no logged-in principal and no browser
  Origin/Host semantics** — **that is a distinct protocol security model, not a CSRF bypass**.
- **Class C — `/api/auth/*` callbacks**, secured by `state`, PKCE, `nonce`, provider callback
  validation and a verified pre-registered redirect URI (§7.3). These **establish**
  authentication, so **an already-authenticated principal is not required**, and the concrete
  endpoint behaviour is settled in Phase 2, not asserted here.
- **Class D — emailed verification and reset links** (§7.4), covered under §4.

---

## 9. SEO contract

A complete contract, absent from the prior revision.

### 9.1 Canonical URLs

1. **Every indexable page emits a self-referencing `rel="canonical"`** at its canonical URL.
2. **Filtered and sorted views canonicalise to their base resource.** `/fatwa?sort=popular`
   → `/fatwa`; `/quran/topics/{slug}` → `/topics/{slug}`.
3. **Aliases 301**, never canonical-only: `/authors/{slug}` and `/library/authors/{slug}` →
   `/people/{slug}`.
4. **Pagination** self-canonicalises per page — page 2 is not canonical to page 1, which
   would deindex its contents.
5. Canonical URLs are **absolute, localised per §1.1, and lowercase** — the English canonical
   is the unprefixed address, the Urdu and Arabic canonicals carry `/ur` and `/ar`, and a
   `/en/…` address is never canonical (it 301s). (Historical: until Rebaseline R1 every
   canonical was locale-prefixed, English included.)

### 9.2 Locale alternates

Every indexable page emits `hreflang` alternates for **each locale in which the content
genuinely exists**:

```
<link rel="alternate" hreflang="en"        href="https://…/…">      ← unprefixed (§1.1)
<link rel="alternate" hreflang="ur"        href="https://…/ur/…">
<link rel="alternate" hreflang="ar"        href="https://…/ar/…">
<link rel="alternate" hreflang="x-default" href="https://…/…">   ← resolved per §9.2.1
```

Every alternate, canonical and `x-default` URL is built by `localizedPath` (§1.1); the shape of
the alternate, canonical and `x-default` logic is unchanged by Rebaseline R1 — only the English
address lost its prefix (and the Fatwa, Hadith, Quran and Global `x-default` paths, which had
hand-built the prefix, were moved onto the helper).

- **Every `hreflang` URL must itself be a valid canonical version of the content in that
  language.** A URL that merely falls back to another language is not a language version and
  is never listed.
- **Alternates are reciprocal** — every listed alternate links back.
- **Untranslated content is never listed as an alternate.** Announcing a `ur` alternate that
  serves English content is a false signal; the alternate is simply omitted.
- **Translations are never fabricated to fill an alternate.** A missing language stays missing.

#### 9.2.1 `x-default` resolution

`x-default` is **conditional**, not unconditionally English. Much of the corpus is
Urdu-original or Arabic-original, and a great deal of it will never have an English version —
pointing `x-default` at an English URL that does not exist, or that only falls back, would
advertise a page that is not a canonical English version.

Resolved in order:

| Condition | `x-default` target |
|---|---|
| **A canonical English version exists** | The **English** canonical URL — the unprefixed address of §1.1 |
| **No English version, but one or more other languages exist** | The **canonical URL of the most appropriate existing language** — normally the content's **original language**, and where that is ambiguous, the locale-selection URL below |
| **Several equally appropriate language versions, with no clear original** | A **defined locale-selection/discovery URL** for that resource, which lists the genuine language versions |
| **No language version exists** | **No `x-default` is emitted** — and the page is not indexable (§9.3) |

**Rules:**
- **`x-default` never points at a non-canonical fallback URL.**
- **`x-default` never points at a URL that is not itself a listed, valid `hreflang` target**,
  with the sole exception of a locale-selection/discovery URL, which is a legitimate
  language-neutral entry point rather than a language version.
- Omitting `x-default` is correct and harmless when no suitable target exists. **Emitting a
  wrong one is not.**

### 9.3 Untranslated content behaviour

| Situation | Behaviour |
|---|---|
| Content exists in this locale | Render; list in `hreflang` |
| Content missing in this locale | Render the available language with a **visible language notice**; UI chrome stays in the requested locale; **omit from `hreflang`**; canonical points to the **existing-language URL**, not the fallback URL |
| Content missing everywhere | 404 with search and nearest-section links |

This prevents three near-identical pages competing as though each were a translation.

### 9.4 Sitemaps

A **sitemap index** at `/sitemap.xml` referencing partitioned child sitemaps:

```
/sitemaps/{segment}-{locale}.xml
   segments: pages · topics · people · quran · hadith · books · research
             publications · videos · audio · galleries · fatwa · news
             events · collections · centres · courses · learning-paths
```

- **Partitioned by content type and locale** — Quran ayah URLs alone are numerous, and mixing
  them with news defeats diagnosis.
- Each child sitemap stays within specification limits; large segments split numerically.
- **`lastmod` reflects genuine content modification**, never build or deploy time. A
  `lastmod` that changes on every deploy trains crawlers to ignore it.
- **Only canonical, indexable URLs appear.** Never filtered views, `noindex` pages,
  authenticated routes or redirect sources.
- Regenerated on publication, not on a fixed schedule.

### 9.5 Robots and indexing rules

| Surface | Directive |
|---|---|
| Public canonical content | Indexable |
| Search results (`/search`, `/*/search`) | **`noindex, follow`** |
| Filtered and sorted views | Indexable but **canonical to base**; excluded from sitemaps |
| Authentication routes | **`noindex, nofollow`** |
| `/my/*`, `/teacher/*`, `/admin/*` | **`noindex, nofollow`** + private cache + `Disallow` |
| API routes | **`Disallow`** |
| Staging environment | **Entire site `noindex` + `Disallow`** — at the edge as well as in the build: `X-Robots-Tag: noindex, nofollow, noarchive` on every response (401s and 404s included) and a robots file served by NGINX that disallows `/` and names no sitemap, behind an environment access gate (SECURITY_BASELINE.md §21, ARCHITECTURE.md §10.6) |
| **Pre-adoption / presentation origin** | **Entire site `noindex` + `Disallow`**, no submitted sitemaps, and **no canonical URLs pointing at the official origin** — until the approved launch transition (PRODUCT_SCOPE.md, *Product status and acceptance*) |
| **Deferred or unavailable capability** | **Never listed in a sitemap** and never linked as dead navigation (§5.2) |
| **Religious corpus not approved** — a fixture corpus, or (since Rebaseline R2) a Quran **reference** preview | **`noindex`**, no canonical or alternates, **an empty sitemap segment** — even if the deployment were indexable; a reference corpus is shown at all only on a deployment that admits it, which configuration refuses beside public indexing (§3.3; SECURITY_BASELINE.md §5.1) |
| Image derivatives (`…/{assetId}/{width}w.webp`, Rebaseline R2) | `X-Robots-Tag: noindex, nofollow` on every answer; never sitemap entries (§3.10) |
| Unpublished, staged or draft content | **Never publicly reachable at all** |

> **Why the pre-adoption row exists.** While the platform runs on a developer-controlled origin
> and has not been officially adopted, its SEO posture must not compete with or impersonate the
> official organisation site, and it must claim no endorsement. **This is an environment and
> launch-state control, not a reduced product** — the application is the same one (its readiness
> is reported in PRODUCT_SCOPE.md's six dimensions, never as a bare "complete"). Official
> indexing and canonical production SEO are switched on **only** at the launch transition
> (DELIVERY_PLAN.md, Phase 35).

`robots.txt` references the sitemap index and disallows admin, authenticated and API paths.

### 9.6 Structured data

Emitted as JSON-LD, **only where the data genuinely exists and is accurate**. Over-claiming
structured data invites manual action penalties.

| Type | Applied to |
|---|---|
| `Organization` | Home and organisational pages — official name, logo, contact, social profiles |
| `Person` | `/people/{slug}` |
| `Book` | Library works and editions — with genuine ISBN, author and language only |
| `Article` | Articles and research |
| `NewsArticle` | News, press releases, statements — never media coverage, whose article is a third party's (Phase 13) |
| `Event` | Events — with genuine date and location. Phase 14: only when the Event is held at a public physical Centre with a City or an address, one `Event` per occurrence; otherwise none is claimed |
| `VideoObject` | Video pages — title, description, thumbnail, upload date, embed URL |
| `BreadcrumbList` | Every page with a hierarchical path |

**Deliberately not claimed:** `Course` structured data without genuine pricing and provider
completeness · `FAQPage` on Fatwa (a scholarly ruling is not an FAQ entry, and misrepresenting
it would be both an SEO and a religious misstatement) · `Review` or `Rating` of any kind ·
`Product` for donations · any `ItemList`, `CollectionPage` or `CreativeWork` for an editorial
Collection (Phase 15): a Collection page carries `BreadcrumbList` only, and each member keeps
its own owner's structured data on its own canonical page.

Quran and Hadith pages use `Article`/`BreadcrumbList` with accurate citation metadata. **No
structured-data type is invented for religious text**, and none is used that implies
endorsement or rating.

### 9.7 Redirects and legacy preservation

- **Legacy URL → canonical new URL via 301**, driven by `LegacyMapping` data
  (DOMAIN_MODEL.md §16.1) — never hardcoded. Phase 29 writes that data at publication (one active
  mapping per legacy URL, to a locale-free canonical path such as `/watch/videos/{slug}`); no legacy
  301 is served before the Phase-35 cutover. Phase 30 completes and reviews the mapping data and
  proves each legacy URL's resolution — single-hop, to its intended canonical target — in staging
  or a controlled resolver harness; Phase 32 may acceptance-test the redirect contract with
  controlled fixtures; Phase 35 alone serves 301s on the legacy domains, with the DNS and
  legacy-host cutover, live verification and rollback.
- **Chains collapse to a single hop**; a redirect never points to another redirect.
- **Slug changes automatically create a 301** from the previous slug; slugs are never reused.
  **This native slug history is owned by the resource's own context and delivered in the phase
  that makes the slug editable** (DOMAIN_MODEL.md §19.7) — it is **not** a Migration
  responsibility, and it works whether or not any legacy migration ever runs.
- Locale is preserved where the legacy URL indicated one.
- **Unmapped legacy URLs return a helpful 404** with search and nearest-section links — and
  are **logged and reviewed**, since they reveal missed content.
- **Redirect targets resolve only from the internal mapping table**, never from user input
  (SECURITY_BASELINE.md §9).

### 9.8 Acceptance

**SEO acceptance is tested before launch, not assumed** (DELIVERY_PLAN.md): canonical
correctness across locales · reciprocal `hreflang` with **conditionally resolved `x-default`
(§9.2.1), never unconditionally English** · **every `hreflang` target is a genuine canonical
language version** · untranslated
content excluded from alternates · sitemap partitioning, `lastmod` accuracy and exclusion of
non-canonical URLs · `noindex` on all private and search surfaces · structured-data
validation with no over-claiming · legacy 301 correctness with no chains.

---

## 10. Routing conventions

1. **Plural collection, singular detail:** `/library/books` and `/library/books/{slug}`.
2. **Slugs, not numeric IDs** — except genuine canonical numeric references (surah, ayah,
   Hadith number).
3. **Arbitrary, combinable filters are query parameters, never path segments.** Filters
   combine; paths do not. **A named navigational view curated by the information architecture
   may be a path** — the distinction is set out in §2.3.
4. **Derived sort and flag views are query parameters** (§2.3).
5. **Lowercase, hyphenated paths.**
6. **Non-locale routes** are limited to `robots.txt`, sitemaps, `/api/*`, `/rss/*`, health
   probes, `/assets/{id}`, `favicon.ico` and the app icon `icon.png` (excluded from the locale
   proxy's matcher since Rebaseline R1 — before it, the icon was being locale-routed). Each is
   machine-readable and outside locale routing BY CONTRACT (now that English pages are also
   unprefixed, "unprefixed" alone no longer distinguishes them); none
   renders a page. **`/assets/{id}` is stored bytes, not a document**: an asset has no
   interface locale, and giving one object three localised URLs would give the same bytes
   three cache entries and three canonical addresses. It is the default-deny serving route
   delivered in Phase 7, and it returns a file or a 404, never markup. **The whole `/assets/*`
   namespace is excluded from locale routing** (Phase 8), and a consuming context serves its own
   bytes beneath it on routes it owns — Library at `/assets/library/*`, Media at
   `/assets/media/*` (Phase 11), and since Phase 30-R Editorial at `/assets/editorial/*` and
   People at `/assets/people/*` — supplying its business policy there rather than weakening
   `/assets/{id}`'s default deny.
7. **No state-changing GET.** Every browser-initiated mutation is a POST/action with
   Origin/Host validation and framework-appropriate CSRF controls. Signed machine callbacks and
   authentication callbacks establish authenticity by their own protocol instead
   (SECURITY_BASELINE.md §7.2–§7.3); an emailed verification or reset link may **render** on GET
   but **consumes its token only at the confirming POST** (§7.4).
8. **URLs are permanent.** Every change produces a 301 — citation stability is a product
   requirement for a religious knowledge platform.
