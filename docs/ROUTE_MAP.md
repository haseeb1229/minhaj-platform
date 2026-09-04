# Route Map & SEO Contract — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit
**Document type:** Proposed routing surface and SEO policy. **No routes are implemented in this phase.**

---

## 1. Locale routing

### 1.1 Strategy

All application routes are nested under an explicit locale segment.

```
/{locale}/...        locale ∈ { en, ur, ar }
```

The locale is **always present**. There is no implicit unprefixed variant, because ambiguity
between `/quran` and `/en/quran` produces duplicate URLs, split search authority, and
unstable canonical links for a corpus meant to be cited for decades.

`/` performs a **307** redirect to a resolved locale — stored preference, then
`Accept-Language`, then `en`. A 307 rather than a 301 because the target varies by visitor
and must not be cached as permanent.

**This policy is implemented by the application's routing layer together with next-intl.**
It is not built-in framework behaviour.

### 1.2 Locale properties

| Locale | Language | Direction |
|---|---|---|
| `en` | English | LTR — default resolution target |
| `ur` | Urdu | **RTL** |
| `ar` | Arabic | **RTL** |

RTL is first-class from day one: logical properties (`margin-inline-start`, never
`margin-left`), and Quranic Arabic rendering correctly in all three locales including within
an otherwise LTR page.

### 1.3 Locale switching

Switching preserves the current route and parameters where the content exists in that
locale. Where it does not, the visitor reaches the nearest valid ancestor with a clear
notice — never a 404, never a silent bounce to the home page.

### 1.4 Slugs

Stable and permanent. Display titles may be edited freely; changing a slug creates a **301**
from the old slug. Slugs are never reused.

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

**One contributor profile route** replaces the prior two. A Person may hold author, speaker,
scholar and teacher profiles (DOMAIN_MODEL.md §5.2); presenting them at separate indexable
URLs would fragment one human being's search authority across several pages.

### 2.2 Domain topic views

Domain-specific topic paths — `/quran/topics/{slug}`, `/hadith/topics/{slug}`,
`/watch/topics/{slug}`, `/fatwa/topics/{slug}` — exist for UX. They are **filtered views**,
not independent SEO entities.

Each such page **carries `rel="canonical"` pointing to `/topics/{slug}`**. They are legitimate
navigation, but they are not separate resources and must never compete in the index.

### 2.3 Derived views are query parameters, not paths

`Latest`, `Popular` and `Featured` are flags and queries (INFORMATION_ARCHITECTURE.md §1.1).
The prior revision contradicted its own rule with `/fatwa/latest` and `/fatwa/popular`.

**Corrected:** `/fatwa?sort=latest` and `/fatwa?sort=popular` — filtered views of one
resource collection, canonical to `/fatwa`, **not indexable resource hierarchies**. The same
applies across all domains.

### 2.4 Sign-out is not a GET route

**Sign-out is a state-changing POST/action with CSRF protection.** A GET route that mutates
session state can be triggered by any image tag or prefetch. `/signout` is removed as a
navigable route.

---

## 3. Public routes

All prefixed with `/{locale}`.

### 3.1 Root

| Route | Purpose |
|---|---|
| `/` | Home |
| `/search` | Unified search — `?q, type, topic, language, from, to, page` · **`noindex`** |
| `/donate` | Donation entry point |
| `/sitemap` | Human-readable sitemap |
| `/topics` · `/topics/{slug}` | **Canonical taxonomy browser and topic hub** |
| `/people/{slug}` | **Canonical contributor profile** |
| `/collections` · `/collections/{slug}` | Editorial collections |
| `/membership` · `/contact` · `/help` · `/help/{article}` · `/feedback` | Utility destinations |

`/topics/{slug}` is among the most important routes on the platform — the realisation of the
unified content graph, presenting works, videos, articles, research, Fatawa, courses, audio
and contributors for one topic. It sits at root level because it serves every context.

### 3.2 Explore

| Route | Purpose |
|---|---|
| `/explore` | Section landing |
| `/explore/about` · `/explore/about/{page}` | introduction · vision · mission · values · objectives · history · timeline · global-impact |
| `/explore/leadership` | Leadership |
| `/explore/shaykh-ul-islam` · `/{page}` | biography · early-life · education · academic-work · achievements · works · isnad · views-of-dignitaries |
| `/explore/shaykh-ul-islam/{books\|articles\|lectures\|collections}` | Filtered listings, canonical to their domain collections |
| `/explore/organization` · `/{page}` | governance · departments · forums · wings · institutions · annual-reports · un-recognition · awards |
| `/explore/our-work` · `/{area}` | education · research · welfare · women · youth · students · interfaith · human-rights · peace |
| `/explore/community` | Community |
| `/explore/digital-resources` · `/{item}` | mobile-apps · newsletter · rss · social-media |

### 3.3 Quran

| Route | Purpose |
|---|---|
| `/quran` | Landing |
| `/quran/read` | Reader entry — resumes progress when signed in *(uncached island)* |
| `/quran/surah` · `/quran/surah/{surahNumber}` | Surah index and view — `?translation, tafsir, reciter, transliteration` |
| `/quran/surah/{surahNumber}/{ayahNumber}` | **Canonical ayah citation URL** |
| `/quran/juz` · `/quran/juz/{juzNumber}` | Juz index and view |
| `/quran/search` | Quran search — `noindex` |
| `/quran/translations` · `/{slug}` | Translation works |
| `/quran/tafsir` · `/{slug}` | Tafsir works |
| `/quran/transliteration` · `/quran/tajweed` · `/quran/tajweed/{rule}` | Study aids |
| `/quran/recitations` · `/quran/recitations/{reciter}` | **Recitations — owned by Quran** (DOMAIN_MODEL.md §8.1) |
| `/quran/topics/{slug}` | Filtered view, canonical → `/topics/{slug}` |
| `/quran/{books\|videos\|articles\|research\|courses\|teachers}` | Related material, canonical to their domain collections |

Translation, tafsir and reciter selections are **query parameters, not path segments**, so a
citation remains valid regardless of reading preferences.

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

### 3.5 Learn

| Route | Purpose |
|---|---|
| `/learn` | Landing |
| `/learn/courses` · `/learn/courses/{slug}` | Catalogue — `?topic, level, language, format, teacher` |
| `/learn/paths` · `/learn/paths/{slug}` | Learning paths |
| `/learn/live` · `/learn/trial` · `/learn/training` · `/learn/resources` | Learning surfaces |
| `/learn/teachers` | Teacher directory — `?subject, language, availability` |
| `/learn/teachers/{slug}` | **301 → `/people/{slug}`** |

### 3.6 Library

| Route | Purpose |
|---|---|
| `/library` · `/library/resources` | Landing and all resources — `?type, topic, language, contributor, from, to` |
| `/library/books` · `/library/books/{slug}` | **Works**, with editions and translations presented on the work page |
| `/library/authors` | Contributor listing — **details 301 → `/people/{slug}`** |
| `/library/topics` · `/library/languages` · `/library/collections` | Filtered browse |
| `/library/articles` · `/library/research` · `/library/research-papers` · `/library/publications` · `/library/encyclopedias` (+ `/{slug}`) | Written works |
| `/library/magazines` · `/{slug}` · `/{slug}/issues/{issueSlug}` | Periodicals |
| `/library/downloads` · `/library/sale-points` | Access |

### 3.7 Watch / Listen

| Route | Purpose |
|---|---|
| `/watch` | Landing — `?sort=featured\|latest` |
| `/watch/videos` · `/watch/videos/{slug}` | Videos — `?topic, speaker, series, language` |
| `/watch/{lectures\|events\|highlights\|interviews\|documentaries}` | Filtered views |
| `/watch/series` · `/{slug}` · `/watch/programs` · `/{slug}` · `/watch/playlists` · `/{slug}` | Groupings |
| `/watch/speakers` | Speaker listing — **details 301 → `/people/{slug}`** |
| `/watch/topics/{slug}` | Filtered view, canonical → `/topics/{slug}` |
| `/listen` · `/listen/lectures` · `/{slug}` · `/listen/series` · `/{slug}` | Audio — a **sibling** of `/watch`, not a child |
| `/listen/recitations` | **Catalogue projection of Quran-owned recitations**, canonical → `/quran/recitations` |

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

### 3.9 News, Events, Media, Global

| Route | Purpose |
|---|---|
| `/news` · `/news/{slug}` | News — `?sort=latest` |
| `/news/{press-releases\|statements\|media-coverage}` · `/{slug}` | Editorial types |
| `/news/archive` | `?year, month` |
| `/newsletter` | Subscription |
| `/events` · `/events/{slug}` · `/events/{slug}/gallery` | Events — `?upcoming, past, country, city, centre` |
| `/media/photos` · `/media/galleries` · `/{slug}` · `/media/archive` · `/media/downloads` | Media |
| `/global` · `/global/find-a-centre` | World network and centre finder |
| `/global/countries` · `/{slug}` · `/{slug}/regions/{regionSlug}` · `/{slug}/cities/{citySlug}` | Geography — intermediate levels may be absent (DOMAIN_MODEL.md §17.1) |
| `/global/centres` · `/{slug}` · `/{slug}/{news\|events\|contact}` | Centres |
| `/global/pakistan` | Pakistan structure entry point |

### 3.10 Legal and machine-readable

| Route | Purpose |
|---|---|
| `/legal/{privacy\|terms\|cookies\|accessibility}` | Compliance surfaces |
| `/robots.txt` · `/sitemap.xml` · `/sitemaps/{segment}-{locale}.xml` | Unprefixed |
| `/rss` · `/rss/{feed}` | Feeds |

---

## 4. Authentication routes

| Route | Method | Purpose |
|---|---|---|
| `/{locale}/signin` | GET / POST | Sign in — `?returnTo` |
| `/{locale}/signup` | GET / POST | Register |
| **Sign out** | **POST action only** | **Never a GET route** (§2.4) |
| `/{locale}/forgot-password` · `/reset-password` | GET / POST | Recovery |
| `/{locale}/verify-email` | GET / POST | Verification |
| `/{locale}/onboarding` | GET / POST | Conditional onboarding |

`returnTo` is validated against an allowlist of internal paths. **All are `noindex`.**

---

## 5. My Minhaj routes

All authenticated, all `noindex`, all **private cache** (ARCHITECTURE.md §8.3). Prefixed
`/{locale}/my`.

`/my` · `/my/learning` (+ `/courses/{slug}`, `/paths/{slug}`) · `/my/classes` (+ `/{id}`) ·
`/my/teachers` · `/my/messages` (+ `/{conversationId}`) · `/my/saved` (+ `/bookmarks`,
`/notes`, `/collections`, `/collections/{id}`) · `/my/history/{reading|watch}` ·
`/my/progress` (+ `/quran`, `/courses`) · `/my/questions` (+ `/ask`, `/{id}`) ·
`/my/notifications` · `/my/settings/{section}`

Owned by the Personalisation & Notifications context (DOMAIN_MODEL.md §14).

---

## 6. Teacher routes

Require a current `teaching.perform` assignment. All `noindex`, private cache. Prefixed
`/{locale}/teacher`.

`/teacher` · `/teacher/classes/today` (+ `/{id}`) · `/teacher/calendar` ·
`/teacher/students` (+ `/{id}`) · `/teacher/courses` (+ `/{id}`, `/{id}/students`,
`/{id}/sessions`, `/{id}/materials`) · `/teacher/messages` (+ `/{conversationId}`) ·
`/teacher/resources` · `/teacher/attendance` (+ `/{sessionId}`, `/reports`) ·
`/teacher/availability` · `/teacher/profile`

**Meeting URLs appear only on authenticated, private-cached pages** for authorised
participants (SECURITY_BASELINE.md §11).

---

## 7. Admin routes

Permission-checked **server-side per route and per action**. All `noindex`, private cache.
Prefixed `/{locale}/admin`.

| Area | Routes |
|---|---|
| Dashboard | `/admin` |
| Editorial | `/admin/editorial/{articles\|pages\|news\|press-releases\|statements\|media-coverage\|events\|collections\|queue}` |
| Quran | `/admin/quran/{surahs\|ayat\|translations\|tafsir\|transliterations\|recitations}` |
| Hadith | `/admin/hadith/{collections\|books\|chapters\|records\|commentary}` |
| Fatwa | `/admin/fatwa/{questions\|assignment\|drafts\|review\|published}` |
| Library | `/admin/library/{works\|editions\|translations\|research\|publications\|magazines\|encyclopedias\|sale-points}` |
| Media | `/admin/media/{videos\|audio\|photos\|galleries\|playlists\|series\|assets}` |
| People | `/admin/people/{persons\|authors\|speakers\|scholars\|teachers}` |
| Identity | `/admin/identity/{users\|roles\|permissions\|assignments}` |
| Taxonomy | `/admin/taxonomy/{topics\|mapping\|languages\|tags}` |
| Learning | `/admin/learning/{courses\|paths\|classes\|enrolments\|trials}` |
| Global | `/admin/global/{countries\|regions\|cities\|centres}` |
| Membership | `/admin/membership` · `/applications` |
| Donations | `/admin/donations` · `/campaigns` |
| Messaging | `/admin/messaging/{support\|moderation\|reports}` |
| Migration | `/admin/migration/{sources\|runs\|runs/{id}\|staging\|duplicates\|url-mapping\|errors\|manifests\|reconciliation}` |
| System | `/admin/system/{navigation\|redirects\|search\|audit\|integrations\|settings}` |

**Route-level authorisation is never sufficient.** Every mutation re-checks permission at the
action layer. **Privileged actions require step-up reauthentication** (SECURITY_BASELINE.md
§8). **Raw migration snapshots render inertly** — escaped text or sandboxed download, never
live HTML (SECURITY_BASELINE.md §10.3).

---

## 8. API and integration route categories

Categories only; no endpoint contracts in this phase.

| Category | Base | Purpose |
|---|---|---|
| Auth | `/api/auth/*` | Delegated to the authentication library |
| Search | `/api/search/*` | Search, suggestions, typeahead |
| Content read | `/api/content/*` | Public read for progressive enhancement |
| Personal | `/api/my/*` | Authenticated personal actions |
| Messaging REST | `/api/messaging/*` | History and read state via Messaging-owned services |
| Teacher / Admin | `/api/teacher/*` · `/api/admin/*` | Role-gated operations |
| Migration | `/api/admin/migration/*` | Import control and status |
| Media | `/api/media/*` | Asset serving and signed downloads |
| Webhooks | `/api/webhooks/{provider}` | **Signature-verified, idempotent, replay-resistant** |
| Health | `/api/health` · `/api/ready` | Unprefixed operational probes |

**Realtime** (Messaging phase onward): `/socket.io/*`, reverse-proxied with WebSocket
upgrade. Not part of the Next.js route tree, and it reaches data only through the
Messaging-owned services hosted in `packages/server-core` (ARCHITECTURE.md §3.1).

**All mutations — Server Actions and Route Handlers alike — carry CSRF protection, validate
input with Zod server-side, and re-check permissions independently.**

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
5. Canonical URLs are **absolute, locale-prefixed, and lowercase**.

### 9.2 Locale alternates

Every indexable page emits `hreflang` alternates for **each locale in which the content
genuinely exists**:

```
<link rel="alternate" hreflang="en"        href="https://…/en/…">
<link rel="alternate" hreflang="ur"        href="https://…/ur/…">
<link rel="alternate" hreflang="ar"        href="https://…/ar/…">
<link rel="alternate" hreflang="x-default" href="https://…/…">   ← resolved per §9.2.1
```

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
| **A canonical English version exists** | The **English** canonical URL — matching the default resolution of §1.1 |
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
             events · collections · centres · courses
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
| Staging environment | **Entire site `noindex` + `Disallow`** |
| Unpublished, staged or draft content | **Never publicly reachable at all** |

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
| `NewsArticle` | News, press releases, statements |
| `Event` | Events — with genuine date and location |
| `VideoObject` | Video pages — title, description, thumbnail, upload date, embed URL |
| `BreadcrumbList` | Every page with a hierarchical path |

**Deliberately not claimed:** `Course` structured data without genuine pricing and provider
completeness · `FAQPage` on Fatwa (a scholarly ruling is not an FAQ entry, and misrepresenting
it would be both an SEO and a religious misstatement) · `Review` or `Rating` of any kind ·
`Product` for donations.

Quran and Hadith pages use `Article`/`BreadcrumbList` with accurate citation metadata. **No
structured-data type is invented for religious text**, and none is used that implies
endorsement or rating.

### 9.7 Redirects and legacy preservation

- **Legacy URL → canonical new URL via 301**, driven by `LegacyMapping` data
  (DOMAIN_MODEL.md §16.1) — never hardcoded.
- **Chains collapse to a single hop**; a redirect never points to another redirect.
- **Slug changes automatically create a 301** from the previous slug; slugs are never reused.
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
3. **Filters are query parameters, never path segments.** Filters combine; paths do not.
4. **Derived views are query parameters** (§2.3).
5. **Lowercase, hyphenated paths.**
6. **Non-locale routes** are limited to `robots.txt`, sitemaps, `/api/*`, `/rss/*` and health
   probes.
7. **No state-changing GET.** Every mutation is a POST/action with CSRF protection.
8. **URLs are permanent.** Every change produces a 301 — citation stability is a product
   requirement for a religious knowledge platform.
