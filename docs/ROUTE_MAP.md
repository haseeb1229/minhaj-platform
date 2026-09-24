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
It is not built-in framework behaviour. It is delivered **once**, in the Localisation Foundation
phase (DELIVERY_PLAN.md, Phase 3A), **before any phase is required to deliver en/ur/ar routes** —
including the authentication surfaces of §4. No later phase re-implements it.

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

**Switching the locale switches the interface, and always preserves the current route and its
parameters.** The locale segment changes; the resource does not.

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
| `/watch/series` · `/{slug}` · `/watch/programs` · `/{slug}` · `/watch/playlists` · `/{slug}` | Groupings — a programme is a Series of kind `program`; each Series is canonical under exactly one of the two families, and the other answers one 301 (Phase 10) |
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
| `/assets/{id}` | Unprefixed. Authorisation-checking asset serving, default deny (Phase 7) |
| `/assets/library/editions/{editionId}/{read\|download}/{assetId}` · `/assets/library/previews/{editionId}/{assetId}` | Unprefixed. Library's Edition bytes under Library's own allow/deny policy **and** Storage's technical decision; preview requires live `library.administer` (Phase 8) |
| `/rss` · `/rss/{feed}` | Feeds |

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
learner level and preferred format are collected by **Personalisation & Notifications** in
**Phase 21**, under `/my/settings/interests` (§5.1). Authentication never depends on it, and the
two are never merged into one route.

`returnTo` is validated against an allowlist of internal paths. **All are `noindex`.**

**Protocol classification** (SECURITY_BASELINE.md §7). These routes are not all one kind of
request, and are not treated as one:

| Surface | Model | Authenticity established by |
|---|---|---|
| Sign-in, sign-up, sign-out, account setup, and the POST half of recovery and verification | **A — browser mutation** (§7.1) | Server-side authorisation · Origin/Host validation · framework-appropriate CSRF controls · **no state-changing GET** |
| Provider redirects and `/api/auth/*` callbacks | **C — authentication callback** (§7.3) | `state` · PKCE · `nonce` · provider callback validation · **verified pre-registered redirect URI** · linking ownership checks — **not ordinary browser POST semantics** |
| The GET half of `/verify-email` and `/reset-password` | **D — emailed link** (§7.4) | A GET **renders** confirmation or token-status UI. It **must not silently perform a protected mutation** where the contract requires an explicit confirmation action. **The token is consumed at the confirming POST, not by rendering.** This is **the platform's chosen integration contract, subject to Phase 2 compatibility proof with Better Auth** — not a claim about Better Auth's own behaviour; if it cannot be met without unsafe divergence, **Phase 2 stops for an architecture decision**. **Expired, reused and invalid tokens remain unusable regardless** |

**No routes are implemented by this document**, and none of the above authorises implementation
of Phase 2 or Phase 2G work.

---

## 5. My Minhaj routes

All authenticated, all `noindex`, all **private cache** (ARCHITECTURE.md §8.3). Prefixed
`/{locale}/my`.

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
| `/my/donations` — **only** where user-linked donation history is genuinely in scope | **Donations** | **Phase 27** |

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
| `/admin/system/redirects` — native slug history **and** legacy mappings, distinguished | Each owning context; legacy rows from **Migration** | **Phase 6** onward; legacy rows **Phase 29** |
| `/admin/system/search` — configuration, rebuild, indexing lag and failures | Search infrastructure, operated at Layer 4 | **Phase 17** |
| `/admin/system/integrations` — provider configuration and status | Platform integrations | **Phase 2** for email; extended per provider |
| `/admin/communications/newsletter` | **Personalisation & Notifications** | **Phase 21** |
| `/admin/communications/delivery` — pending, failed, suppressed mail | The shared communication concern | **Phase 2** |
| `/admin/system/navigation` | Layer 4 shell | **Phase 4**, only to the extent it is genuinely promised |

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
| Editorial | `/admin/editorial/{articles\|pages\|news\|press-releases\|statements\|media-coverage\|events\|collections\|queue\|correspondence}` \u2014 **correspondence** covers private ContactInquiry and Feedback triage (DOMAIN_MODEL.md \u00a77.5) |
| Quran | `/admin/quran/{surahs\|ayat\|translations\|tafsir\|transliterations\|recitations}` |
| Hadith | `/admin/hadith/{collections\|books\|chapters\|records\|commentary}` |
| Fatwa | `/admin/fatwa/{questions\|assignment\|drafts\|review\|published}` |
| Library | `/admin/library/{works\|editions\|translations\|research\|publications\|magazines\|encyclopedias\|sale-points}` — research papers at `research/papers`, and a Magazine's issues beneath it at `magazines/{id}/issues/{issueId}` (Phase 9) |
| Media | `/admin/media/{videos\|audio\|photos\|galleries\|playlists\|series\|assets}` — `videos`, `series` and `playlists` delivered in Phase 10 |
| People | `/admin/people/{persons\|authors\|speakers\|scholars\|teachers}` |
| Identity | `/admin/identity/{users\|roles\|permissions\|assignments\|security}` \u2014 **security** covers second-factor state, bootstrap status and identity audit (SECURITY_BASELINE.md \u00a78) |
| Taxonomy | `/admin/taxonomy/{topics\|mapping\|languages\|tags}` |
| Learning | `/admin/learning/{courses\|paths\|classes\|enrolments\|trials}` |
| Global | `/admin/global/{countries\|regions\|cities\|centres}` |
| Membership | `/admin/membership` · `/applications` |
| Donations | `/admin/donations` · `/campaigns` |
| Messaging | `/admin/messaging/{support\|moderation\|reports}` |
| Migration | `/admin/migration/{sources\|runs\|runs/{id}\|staging\|duplicates\|url-mapping\|errors\|manifests\|reconciliation}` |
| Communications | `/admin/communications/{newsletter\|delivery}` \u2014 subscriber and suppression state; pending, failed and suppressed outbound mail |
| System | `/admin/system/{navigation\|redirects\|search\|audit\|integrations\|settings}` \u2014 **redirects** distinguishes native slug history from legacy mappings; **search** covers configuration, rebuild, indexing lag and failures; **integrations** covers provider configuration and status |

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
upgrade. Not part of the Next.js route tree. It causes persistence **only** by invoking the
Messaging-owned services hosted in `packages/server-core`, and **never holds raw database
capability** — no client, delegate, transaction handle, raw-query facility or persistence
adapter, directly or through any intermediate package (ARCHITECTURE.md §3.1.1–§3.1.2).

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
| **Pre-adoption / presentation origin** | **Entire site `noindex` + `Disallow`**, no submitted sitemaps, and **no canonical URLs pointing at the official origin** — until the approved launch transition (PRODUCT_SCOPE.md, *Product status and acceptance*) |
| **Deferred or unavailable capability** | **Never listed in a sitemap** and never linked as dead navigation (§5.2) |
| Unpublished, staged or draft content | **Never publicly reachable at all** |

> **Why the pre-adoption row exists.** While the platform runs on a developer-controlled origin
> and has not been officially adopted, its SEO posture must not compete with or impersonate the
> official organisation site, and it must claim no endorsement. **This is an environment and
> launch-state control, not a reduced product** — the application is complete. Official
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
   probes and `/assets/{id}`. Each is machine-readable and unprefixed BY CONTRACT; none
   renders a page. **`/assets/{id}` is stored bytes, not a document**: an asset has no
   interface locale, and giving one object three localised URLs would give the same bytes
   three cache entries and three canonical addresses. It is the default-deny serving route
   delivered in Phase 7, and it returns a file or a 404, never markup. **The whole `/assets/*`
   namespace is excluded from locale routing** (Phase 8), and a consuming context serves its own
   bytes beneath it on routes it owns — Library at `/assets/library/*` — supplying its business
   policy there rather than weakening `/assets/{id}`'s default deny.
7. **No state-changing GET.** Every browser-initiated mutation is a POST/action with
   Origin/Host validation and framework-appropriate CSRF controls. Signed machine callbacks and
   authentication callbacks establish authenticity by their own protocol instead
   (SECURITY_BASELINE.md §7.2–§7.3); an emailed verification or reset link may **render** on GET
   but **consumes its token only at the confirming POST** (§7.4).
8. **URLs are permanent.** Every change produces a 301 — citation stability is a product
   requirement for a religious knowledge platform.
