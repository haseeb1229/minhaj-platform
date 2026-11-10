# Information Architecture — One Minhaj Platform

**Status:** Living canonical baseline for the current accepted repository. Updated in the same
task as any accepted change that directly affects it (DELIVERY_PLAN.md §5.1).
**Origin:** Phase 0A Architecture Freeze, revised after independent architecture audit, and
revised continuously through the delivered phases.
**Document type:** Target information architecture. The structure below is the intended IA;
"Since Phase N" and "Delivered in Phase N" notes record what each accepted phase delivered.

---

## 1. Structural principles

Five rules govern the entire IA. They resolve most of the duplication present in the
legacy ecosystem.

### 1.1 Flags and queries are not sections

"Featured", "Popular", "Latest", "Trending" and "Recommended" are **derived views over
existing content**, expressed as flags or query parameters. They are never separate
content systems, separate database tables, or separate editorial workflows.

A "Featured Book" is a Work with `isFeatured = true`. It is not a FeaturedBook entity.
This single rule eliminates a large class of duplication that fragmented legacy sites.

**Consequence for routing:** these are **query parameters, not paths**. `/fatwa?sort=latest`,
never `/fatwa/latest`. A derived view is never an independently indexable resource hierarchy
(ROUTE_MAP.md §2.3).

### 1.2 One canonical topic taxonomy

A single taxonomy of topics connects every content type. A topic page for *Seerah*
surfaces books, videos, articles, research, Fatawa, courses, audio and scholars — because
all of them reference the same topic records, not per-domain category lists.

Domain-specific *structural* classifications remain separate from this taxonomy:
Surah and Juz are Quran structure; Hadith collection, book and chapter are Hadith
structure; Fatwa categories are a Fatwa-domain classification. These structural axes
coexist with — and additionally map onto — canonical topics.

**`/topics/{slug}` is the one canonical topic route.** Domain topic views such as
`/quran/topics/{slug}` exist for UX as filtered views carrying a canonical link to it — never
as competing indexable entities. Topic assignment uses **typed relationships with
database-enforced referential integrity**, never polymorphic references
(DOMAIN_MODEL.md §6.2).

### 1.3 Curated Collections replace navigation sprawl

Historical tours, letters, campaigns, major conferences, the terrorism-Fatwa material,
Al-Hidayah material and similar legacy archives are modelled as **Collections**: curated,
ordered, described sets that may contain items of mixed type.

They do not occupy permanent primary navigation. A Collection can be promoted, featured
or linked from anywhere, but the navigation bar does not grow each time the organisation
runs a campaign.

Collection membership also uses **typed relationships**, not polymorphic references — a
Collection must never hold dangling pointers to deleted content.

**Phase 30-RD (pre-adoption review build).** Three of the source's own editor-curated archives —
Al-Hidayah, Mawlid Conferences and Itikaf during Ramadhan — are migrated as Collections at
`/collections/{slug}`, in the source's order, each member linking to its own canonical address;
they still occupy no primary navigation item (MIGRATION_STRATEGY.md §17).

**Since Rebaseline R1** the Collections *index* (`/collections`) is one content-aware primary
destination, promoted while any Collection is published (§2.2). That is consistent with this rule:
it is a single fixed entry, and no individual Collection or campaign ever becomes a navigation
item.

### 1.4 Quran and Hadith are peers, never nested

Neither is a subsection of Library, and neither is a subsection of the other. Each is a
top-level domain with its own reading experience, its own structural navigation, its own
search, and its own integrity rules.

### 1.5 Depth over breadth in navigation

**Since 2026-11-08 (owner direction — OPEN_DECISIONS.md §8).** The nine primary domains (§2.2) are
always in the bar and breadth is carried by their **mega menus** (§3) and the footer index (§4),
shown to every visitor whatever has been published. A new destination is answered first by asking
which domain's menu it belongs in; a new top-level domain needs an owner decision.

*(Historical, superseded 2026-11-08 by owner direction: from Rebaseline R2 until then this rule
read as follows — the owner judged that hiding destinations without published content made the
navigation harder to use.)* **Since Rebaseline R2 (2026-11-06, owner decision — OPEN_DECISIONS.md
§8).** Breadth is
controlled by **six fixed groups** — Quran · Knowledge · Watch & Listen · Learn · News & Events ·
About MQI — each listing only the destinations that hold real content or an open service, in a
fixed order, with a group that has nothing present left out whole (§2.2). Nothing is capped and
nothing absent is advertised. A new destination is answered first by asking which group it belongs
in; a new top-level group needs an owner decision.

*(Historical, superseded by Rebaseline R2: from R1 until R2 this rule read "Breadth is controlled by
promoting only the destinations that hold real content and by keeping the bar short (at most six
items, the rest under "More" — §2.2), not by adding top-level items. Detail lives on each section's
own landing page, not in menus. Any future request for a new primary item is answered first by
asking which existing destination it belongs under." The owner judged six ranked items too thin for
the breadth of the organisation.)*

*(Historical, superseded by Rebaseline R1, 2026-11-06: until R1 this rule read "Twelve primary
items is already a large navigation. Breadth is controlled by pushing detail into well-designed
mega menus rather than by adding top-level items", and new items were answered by asking which
mega menu they belonged in.)*

---

## 2. Primary navigation

### 2.1 Utility strip

**Since 2026-11-08 (owner direction, OPEN_DECISIONS.md §8) the utility strip carries the utility
navigation again, unconditionally**, on laptops and wider (≥ 1024 px). At its inline start: **Find a
Centre** (`/global/find-a-centre`), **Membership** (`/membership`) and **Contact & Help**
(`/help`) — always, as before Rebaseline R1. At its inline end: the language switcher (English /
اردو / العربية, plain links preserving route and query, ROUTE_MAP.md §1.3), the account entry (Sign
in / My Minhaj — the private island of §2.2) and **Donate, always** — `/donate` itself says honestly
when online giving is not available. Below 1024 px there is no strip: the main row carries the
wordmark, a search button, an account icon and Menu, and the utility links, Donate and the language
switcher move into the Menu sheet. The links are `HEADER_UTILITY` in `apps/web/src/shell/menus.ts`.

*Historical, superseded 2026-11-08 by owner direction.* From Rebaseline R2 until then the strip read
as follows.

**Since Rebaseline R2 (2026-11-06) a thin utility strip returns, on laptops and wider (≥ 1024 px).**
At its inline start: About MQI (`/explore`, always), Contact & Help (Help while a help article is
published; Contact while its Page is published) and Find a Centre (while a Centre is published) —
the presence rule of §2.2. At its inline end: the language switcher (English / اردو / العربية,
plain links preserving route and query, ROUTE_MAP.md §1.3), the account entry (Sign in / My
Minhaj — the private island of §2.2) and **Donate, only while giving is open**. The account and
Donate sit in the strip rather than the main row because the six group labels, the wordmark and
Search would not otherwise fit one line at 1024 px in all three languages. Below 1024 px there is
no strip: the main row carries the wordmark, a search button, an account icon and Menu, and the
language switcher moves into the Menu sheet.

*Historical, superseded by Rebaseline R2.* From R1 until R2 the section read as follows.

**Since Rebaseline R1 (2026-11-06) there is no utility bar.** Above the primary row sits only a
slim language strip: English / اردو / العربية, plain links that preserve the current route and
query (ROUTE_MAP.md §1.3). The language switcher stays outside every menu deliberately: it is a
persistent, site-wide concern and must be reachable from every page without entering a menu.
Find a Centre, Membership and Contact / Help are no longer header items; Find a Centre and Help
are footer links under the presence rule of §2.2 (§4), and every one of them stays reachable by
its address, by search and from content.

*Historical, superseded by Rebaseline R1.* Until R1 a thin utility bar above the primary row
carried:

| Item | Behaviour |
|---|---|
| Language switcher | English / اردو / العربية — preserves current route |
| Find a Centre | Direct link into the Global centre finder |
| Membership | Membership information and joining — `/membership`, delivered in Phase 26 |
| Contact / Help | Contact routes and help centre |

### 2.2 Primary navigation

**Since 2026-11-08 (owner direction, OPEN_DECISIONS.md §8) the primary navigation is the nine
domains again — always visible, each with its full mega menu.** The owner judged the R1/R2
content-aware navigation, which hid every destination without published content, a regression in
usability and restored the navigation of Phase 30 (commit `0382218`), keeping R2's visual
components and their keyboard behaviour.

| # | Domain (display order) | Opens |
|---|---|---|
| 1 | Explore | its mega menu (§3.1) — About, Shaykh-ul-Islam, Organization, Our Work, Connect |
| 2 | Quran | §3.2 — Read, Study, Explore, Learn |
| 3 | Hadith | §3.3 — Browse, Study, Explore, Learn |
| 4 | Learn | §3.4 — Learning, Topics, Live, People |
| 5 | Library | §3.5 — Browse, Written works, Periodicals, Access |
| 6 | Watch | §3.6 — Watch, Series and programmes, By topic, Listen |
| 7 | Fatwa | §3.7 — Find, Browse, Ask, Understand |
| 8 | News & Events | §3.8 — News, Events, Media, Archive |
| 9 | Global | §3.9 — Find, Structure |

- **Unconditional.** Every domain and every link of its menu is shown to every visitor at all
  times, whatever the platform has published (`apps/web/src/shell/menus.ts`, resolved through the
  route registry `apps/web/src/shell/registry.ts`, so a link cannot name a route that does not
  exist). A destination with nothing published — a Quran landing with only a fixture corpus, a
  reserved Explore page, an unpublished legal document — answers with its own honest unavailable,
  empty or publication-status state, never a 404. No presence signal gates the header or footer —
  with ONE exception, by the owner's later decision (2026-11-09, OPEN_DECISIONS.md §1.2 item 3): the
  Quran's **Transliteration** and **Word by word** are built but hidden until a lawful source is
  recorded, so their links appear only while a work of each is public (`ROUTE_SIGNALS` in
  `apps/web/src/shell/presence.ts`) and their routes are 404s until then.
- **From 1280 px up** each domain is a disclosure button opening a **mega panel**: the domain's
  one-line purpose and a link to its landing ("{domain} overview"), its labelled columns of links,
  and — for **Watch**, **Library** and **News & Events**, where the corpus has one — a featured
  recent record with its real first-party picture (the newest video with a poster, the newest book
  with a cover, the newest news story with a lead image; never a stock image, and a failed read
  simply has no card). Keyboard: Enter/Space toggles a domain, ArrowDown opens it and moves into
  it, the arrow keys (mirrored in Urdu and Arabic), Home and End move between domain buttons,
  Escape closes; `aria-expanded`/`aria-controls` throughout; one panel at a time.
- **Why 1280 px, not 1024 px.** Measured in a real browser in the shipped faces (2026-11-08), the
  nine domain buttons (14 px labels) with the wordmark and an icon-only Search button fit one row
  at 1280 px in English, Urdu and Arabic, but not at 1024 px in English (they wrap to a second
  row). Below 1280 px the Menu sheet carries the same links. Search is therefore an icon link
  named "Search" (its visible label and Ctrl K hint were dropped to make the room).
- **Search** is a link to `/search` that, with JavaScript, opens a search palette instead (also Ctrl+K, ⌘K on a Mac): a real GET form
  to `/search?q=`, with the nine domains' landings as quick links beneath it, narrowed as the
  visitor types. Without JavaScript the link opens the search page itself.
- **Below 1280 px** the Menu button opens a modal sheet (focus kept inside, page inert, Escape
  closes): a search form, **one accordion per domain holding its landing and every link of its
  menu**, Donate, the utility links and the language switcher.
- **My Minhaj** is the account island in the strip (an icon in the main row below 1024 px);
  **Donate** is always shown (§2.1). Nothing in the header reads who is looking (ARCHITECTURE.md
  §8.1).
- **The presence snapshot remains** (`apps/web/src/shell/presence.ts` over
  `apps/web/src/composition/presence.ts`), for page-level offers only: the search page's
  result-type facets and "browse instead" links, the Quran text's licence attribution in the
  footer (§4) and the administration dashboard's status. It no longer reads published Pages. The administration navigation view (`/admin/system/navigation`) shows, per route,
  whether the header or footer always links it.

*Historical, superseded 2026-11-08 by owner direction.* From Rebaseline R2 until then the primary
navigation read as follows.

**Since Rebaseline R2 (2026-11-06; owner decision, OPEN_DECISIONS.md §8) the primary navigation is
six content-aware groups — grouped, not ranked.** R1's content-awareness stands: the route registry
(`apps/web/src/shell/registry.ts`) records which routes exist, the presentation policy
(`apps/web/src/shell/presence.ts`, `navigationGroups`) decides which are promoted, from the same
per-request, fail-closed evidence snapshot (`apps/web/src/composition/presence.ts`) read from each
owning context's public reads. What changed is the shape: R1's ranked bar of at most six items
(`PRIMARY_LIMIT`) and "More" are withdrawn.

| Group (display order) | Destinations, each in this order and each only while its signal holds |
|---|---|
| **Quran** | Quran landing · Surah index · Juz index · Translations · Quran search — all under `quran`: a readable corpus is active (an **approved** corpus, or — only on a deployment that admits it — a **reference** preview; never a fixture) |
| **Knowledge** | Library (`library`) · Books (`books`: a published work) · Magazines (`magazines`) · Research (`research`) · Encyclopedias (`encyclopedias`) · Articles (`articles`) · Hadith (`hadith`: an approved collection is active) **or**, without one, the same `/hadith` address as **Hadith works** (`hadithWorks`: a public Library work under the `hadith` Topic) · Fatwa (`fatwa`: an approved service with a published ruling) |
| **Watch & Listen** | Watch (`watch`) · Series (`series`) · Playlists (`playlists`) · Listen (`listen`) |
| **Learn** | Learn (`learn`: a published course) · Paths (`paths`) · Live classes (`live`) · Teachers (`teachers`) — the last two only on an **approved** live-learning activation, never a fixture one |
| **News & Events** | News (`news`) · Press releases (`press`) · Events (`events`) · Collections (`collections`) |
| **About MQI** | About → `/explore` (always) · Introduction · The founder (his biography) · Departments · Forums · History — each only while its Page is published · Leadership (`people`) · Global presence (`presence`) · Find a Centre (`centres`) |

- **Each group's first item is its landing**; a group with no present destination is omitted
  whole. **Each address appears once**: two items naming one destination under different
  evidence (Hadith with its collection, "Hadith works" without one) keep only the first present.
  Quran and Hadith stay separate destinations — Hadith sits with the reference services in
  Knowledge, never inside the Quran group (§1.4).
- **From a laptop up (≥ 1024 px)** each group is a disclosure button that opens a **mega panel**:
  the group's one-line purpose, its destinations in two or three columns each with a one-line
  description, and — where the corpus has one — a featured recent record with its real
  first-party picture (the newest video with a poster for Watch & Listen, the newest book with a
  cover for Knowledge, the newest news story with a lead image for News & Events; never a stock
  image, and a failed read simply has no card). Keyboard: Enter/Space toggles a group, ArrowDown
  opens it and moves into it, the arrow keys (mirrored in Urdu and Arabic), Home and End move
  between group buttons, Escape closes; `aria-expanded`/`aria-controls` throughout.
- **Search** is a button that opens a search palette (also Ctrl+K, ⌘K on a Mac): a real GET form
  to `/search?q=`, with the platform's present areas as quick links beneath it, narrowed as the
  visitor types — navigation, never a guessed result. Without JavaScript the form still submits.
- **Below 1024 px** the Menu button opens a modal sheet (focus kept inside, page inert, Escape
  closes): a search form, one accordion per group, Donate while giving is open, the utility links
  and the language switcher.
- **New signals since R2:** `quranReference` (the active corpus is a reference preview — it needs
  attribution, §4), `hadithWorks`, `books`, `magazines`, `research`, `encyclopedias`, `articles`,
  `series`, `playlists`, `paths`, `live`, `teachers`, `press` and `membership` (a published
  membership type). The fail-closed snapshot rules, Donate's rule and "nothing is hidden — every
  route stays reachable by its address" are unchanged from R1 (below).

*Historical, superseded by Rebaseline R2.* From R1 until R2 the primary navigation was the ranked
bar below.

**Since Rebaseline R1 (2026-11-06; owner direction "real content before empty capability") the
primary navigation is content-aware.** The route registry (`apps/web/src/shell/registry.ts`)
still records which routes exist; a separate presentation policy (`apps/web/src/shell/presence.ts`)
decides which of them the shell *promotes*, from public evidence read per request by
`apps/web/src/composition/presence.ts` from each owning context's own public reads.

| Display order | Destination | Promoted only while |
|---|---|---|
| 1 | Quran | an **approved** Quran corpus is active (never a fixture) |
| 2 | Hadith | an **approved** Hadith corpus is active (never a fixture) |
| 3 | Library | a published work, periodical or article exists |
| 4 | Watch | a published video exists |
| 5 | Learn | a published course exists |
| 6 | Fatwa | an approved Fatwa service is active **and** a ruling is published |
| 7 | News | published news exists |
| 8 | Collections | a published Collection exists |
| 9 | About (→ `/explore`) | always |

- **At most six destinations sit in the bar**; when more qualify, the bar keeps them by rank —
  About, Quran, Hadith, Library, Watch, News, Learn, Fatwa, Collections — and the rest open under
  **"More"**, both in display order.
- The same row carries a real search form (GET to `/search`) and the account entry — a private
  island that asks `/api/my/account-state` after the page loads and shows "Sign in" or
  "My Minhaj"; the public HTML is identical for every visitor.
- **Donate is promoted only while giving is open**: a provider configured, giving activated and
  a campaign published.
- **Nothing is hidden.** Every route stays reachable by its address, by search and from content,
  and still renders its honest unavailable or reserved state; only promotion is conditional.
- **Fail closed.** The evidence snapshot is read per request (React `cache`) and memoised
  in-process for 30 seconds; an unknown signal (a failed read, no database at build time) is
  treated as absent, so only About is promoted. The snapshot is deliberately not logged
  (ARCHITECTURE.md §8).
- On staging (2026-11-06, the evidence then present) the bar reads: **Library · Watch · News · Collections · About**.

**IA before and after Rebaseline R1.**

| | Before R1 (Phase 4 → Phase 30-RV) | Since R1 |
|---|---|---|
| Header | Utility bar + fixed twelve-item bar; a mega menu per domain since the Phase-30 presentation pass | Language strip + one row of at most six content-aware destinations, "More", search, account island, Donate only while giving is open |
| Menus | A mega menu per §3 domain, reserved pages included | None; each section's landing page carries its structure |
| Footer | Six columns (~70 links) + utility bar, reserved pages linked | Three groups under the same presence rule; legal links only for published legal pages (§4) |
| `/explore` | Every reserved Explore page listed | Only published (or owner-delivered) pages listed |
| Pre-adoption statement | Header marker + footer utility bar | Footer only, beside the official mark |

*Historical, superseded by Rebaseline R1 — and restored 2026-11-08 (above).* From Phase 4 until R1
the primary navigation was the fixed twelve-item bar below, each content item opening a mega menu
(§3):

| # | Item | Menu type |
|---|---|---|
| 1 | Explore | Mega menu |
| 2 | Quran | Mega menu |
| 3 | Hadith | Mega menu |
| 4 | Learn | Mega menu |
| 5 | Library | Mega menu |
| 6 | Watch | Mega menu |
| 7 | Fatwa | Mega menu |
| 8 | News & Events | Mega menu |
| 9 | Global | Mega menu |
| 10 | Search | Overlay / dedicated page |
| 11 | My Minhaj | Account entry point |
| 12 | Donate | Prominent call to action — `/donate`, delivered in Phase 27; says honestly when online giving is not available |

**Note on "Watch".** The label is *Watch*, but the domain covers both video and audio.
Audio lectures and Quran recitation live here. Until Rebaseline R1 the Watch mega menu carried
an explicit "Listen" grouping so audio was not lost behind a video-shaped label (historical);
from R1 until R2, Listen was a footer destination only, promoted while published audio exists
(historical); from R2 until 2026-11-08 the group was named **Watch & Listen** and Listen was one
of its destinations under the same signal (historical); since 2026-11-08 the Watch mega menu again
carries its **Listen** column — Listen, Audio lectures, Audio series — always (§3.6).

**Note on "My Minhaj".** This is an account entry point, not a content section. Signed
out it presents sign-in and the value of an account; signed in it becomes the gateway to
the authenticated area. Since Rebaseline R1 it is the header's account island (§2.2) rather
than a numbered bar item; since R2 that island sits in the utility strip on laptops and as an
icon in the main row below 1024 px (§2.1), unchanged by the 2026-11-08 restoration.

**Note on "Media".** Photos and galleries are reachable through News & Events (where
event galleries naturally belong) and through Collections (for the historical archive).
Since Phase 13 the News & Events entry point, `/news`, links the photograph surfaces; since
Phase 14 it links Events too, and each Event links its own photographs (its gallery view), so
Event galleries are reached through their Event rather than a listing of their own. The
newsletter appears only when its own phase delivers it — since Phase 21 it is delivered at
`/newsletter` (double opt-in) and linked from Explore's Connect column, the Digital Resources group
and the footer. Since Phase 14 each Centre page lists
its Local Events beside its Local News. Since Phase 15 `/news` also links Collections (§3.8,
the Archive column), a topic hub lists the Collections on its topic, and each Collection links
its members at their owners' own addresses — a Video at `/watch/videos/{slug}`, a book at
`/library/books/{slug}`. Until Rebaseline R1 Collections occupied no primary navigation item
(§1.3); since R1 the Collections index is one content-aware destination (§2.2), and Library's
`/library/collections` filtered view is not yet offered (ROUTE_MAP.md §3.6). Since R1 the
Explore Connect column and the footer newsletter link described above are historical (no menus;
the footer's three groups carry no newsletter link) — `/newsletter` stays reachable by its
address and is listed in the `/explore` index as an owner-delivered Digital Resources item.
Media is a content domain but **not** a primary navigation item — adding an item for it would
violate 1.5 while duplicating existing entry points.

---

## 3. Mega-menu grouping

> **Since 2026-11-08 (owner direction, OPEN_DECISIONS.md §8) these ARE the header's mega menus
> again**, rendered unconditionally from `apps/web/src/shell/menus.ts` (restored from Phase 30,
> commit `0382218`) — in the desktop panels and, one accordion per domain, in the Menu sheet.
> Entries with no static route stay omitted rather than linked dead, as at Phase-30 exit; reserved
> pages (the Explore pages, Volunteer) are linked and answer honestly that nothing is published yet.
> The two notes that follow are historical.
>
> **Historical, superseded 2026-11-08 by owner direction.** **Since Rebaseline R2 (2026-11-06) the
> header again opens panels, but not these.** Its six
> grouped panels (§2.2) are built from the presentation policy's present destinations only —
> never from the column structures below and never linking a reserved page. The groupings below
> stay the record of each section's intended structure; the R1 note that follows is historical.
>
> **Historical, superseded by Rebaseline R1 (2026-11-06).** The shell renders **no mega menus**
> since R1 (`apps/web/src/shell/menus.ts` and `components/shell/menu-panel.tsx` were removed with
> the registry's `placements`). The column groupings below remain the record of each section's
> intended structure and of what each phase delivered; they are no longer a navigation
> surface, and their entries are reached from each section's own landing page, by address and by
> search. Every "Since Phase N" note below stays true of the routes themselves.

Each mega menu is organised into labelled columns. A menu presents structure and
entry points; it is not an exhaustive index of the section.

### 3.1 Explore

| About | Shaykh-ul-Islam | Organization | Our Work | Connect |
|---|---|---|---|---|
| Introduction | Biography | Governance | Education | Community |
| Vision | Early Life | Departments | Research | Membership |
| Mission | Education | Forums | Welfare | Contact |
| Values | Academic Work | Wings | Women | Help / FAQ |
| Objectives | Achievements | Institutions | Youth | Suggestions / Feedback |
| History | Works | Annual Reports | Students | Mobile Apps |
| Timeline | Chains of Authority (Isnad) | UN Recognition | Interfaith | Newsletter |
| Global Impact | Views of Dignitaries | Awards & Achievements | Human Rights | RSS |
| Leadership | Books · Articles · Lectures · Collections | | Peace & Counter-extremism | Social Media |

*Mobile Apps, Newsletter, RSS and Social Media together constitute the **Digital
Resources** group; they are surfaced under Connect in the menu and grouped under a
Digital Resources heading on the Explore landing page.*

### 3.2 Quran

| Read | Study | Explore | Learn |
|---|---|---|---|
| Read Quran | Translation | Quran Topics | Quran Courses |
| Surah Index | Transliteration † | Quran Books | Quran Teachers |
| Juz / Para Index | Word by word † | Quran Videos | — |
| Search Quran | Tafsir | Quran Articles | — |
| Recitation / Audio | Tajweed | Quran Research | — |

† Hidden until a work of it is published (Quran Part 7; §2.2).

Signed-in additions surfaced in-context (not in the menu): bookmarks, notes, reading
progress, continue reading. Since Phase 21 these appear on an Ayah's own page as a private control
that loads after the page, so the page itself is the same for every visitor; signed out it offers
sign-in and returns to the Ayah.

Since Phase 18 the Quran item is delivered (engineering only — no authoritative corpus is supplied,
OPEN_DECISIONS.md §1.1). Read, Study and Search entries, Recitations and Quran Topics are available,
as are Quran Books, Quran Videos and Quran Research (each the owner's own listing for the `quran`
topic). Since Phase 22 Quran Courses is offered too — Learning's public Course listing for the
`quran` topic. Quran Articles and Quran Teachers are not yet offered and are not linked
(ROUTE_MAP.md §3.3). While no corpus is active the section says so plainly instead of showing
empty structure, and Listen's Quran Recitations appear only once a corpus is active. The
signed-in additions remain Phase 21's. Since Rebaseline R2 a deployment that admits it may show a
**reference** preview (the Tanzil Uthmani text with Irfan-ul-Quran, labelled as not reviewed for
this platform, never indexed — OPEN_DECISIONS.md §1.1; ROUTE_MAP.md §3.3); the landing then leads
with the Surah index, a quick jump (`/quran/read?q=`) and the device's "continue reading".

**Quran Part 1 — Read Quran (owner direction 2026-11-09; ROUTE_MAP.md §3.3).** The menu's first
entry, "Read Quran", is now a start page: "Continue where you stopped" (the signed-in person's own
reading position, loaded privately after the page, else the last place read on this device), the
quick jump, a few well-loved places to begin (offered only where the corpus holds them), and the
Surah, Juz and mushaf-page indexes. Reading itself has three modes over the same text —
Translation, Reading (the Arabic alone, flowing; tapping an Ayah shows its translation) and Mushaf
page (grouped by the source's pages, with `/quran/page/{n}` to read page by page) — and a settings
sheet (mode, which translations and how they sit, text sizes, line spacing), all remembered in the
browser. The Surah page now reads in windows of 40 ayat that load as the reader goes, and saving or
noting an Ayah opens the signed-in controls in place rather than leaving the Surah. The menu itself
is unchanged; the later Quran items (the indexes, search, recitations, tafsir, tajweed, related
views) are separate parts of the same programme.

### 3.3 Hadith

| Browse | Study | Explore | Learn |
|---|---|---|---|
| Introduction | Hadith Sciences | Hadith by Topic | Hadith Courses |
| Collections | Commentary | Hadith Books | Hadith Scholars |
| Books | — | Hadith Videos | — |
| Chapters | — | Hadith Articles | — |
| Browse All | — | Hadith Research | — |
| Search Hadith | — | — | — |

Since Phase 19 the Hadith item is delivered (engineering only — no authoritative corpus is
supplied, OPEN_DECISIONS.md §1.3). Introduction, Collections (with their books and chapters),
Browse All, Search Hadith, Hadith Sciences, Commentary and Hadith by Topic are available, as are
Hadith Books, Hadith Videos and Hadith Research (each the owner's own listing for the `hadith`
topic). Since Phase 22 Hadith Courses is offered too — Learning's public Course listing for the
`hadith` topic. Hadith Articles and Hadith Scholars are not yet offered and are not linked
(ROUTE_MAP.md §3.4); Books and Chapters are reached through a collection, not as separate menu
entries. While no collection is activated the section says so plainly instead of showing empty
structure. The signed-in additions remain Phase 21's. Since Rebaseline R2, while no collection is
activated, the landing presents MQI's own hadith works from the Library (the owner declined
external hadith corpora — OPEN_DECISIONS.md §1.3) and the shell names it "Hadith works" (§2.2).

### 3.4 Learn

| Learning | Topics | Live | People |
|---|---|---|---|
| All Courses | Quran · Hadith · Seerah | Live Learning | Teachers |
| Learning Paths | Faith / Aqeedah · Fiqh · Worship | Trial Classes | Find a Teacher |
| Training | Spirituality · Ahl al-Bayt · Sahabah | Class Schedule | — |
| Resources | Islamic History · Ethics · Family & Society | — | — |
| — | Education · Peace · Interfaith | — | — |
| — | Human Rights · Economics & Finance | — | — |
| — | Islam & Science · Contemporary Issues | — | — |
| — | **All Topics** | — | — |

The topic list shown in the menu is a curated subset. **All Topics** leads to the
complete canonical taxonomy browser, which is shared platform-wide.

Since Phase 22 the Learn item is delivered as a primary link to the `/learn` landing, which leads to
All Courses, Learning Paths and Trial Classes (which explains that a trial class is a request on a
live Course, recorded and not yet scheduled) and to the catalogue filtered by Topic. At Phase-22 exit
the shell had no per-domain mega menu (historical); from the Phase-30 flagship presentation pass
until Rebaseline R1 every §3 domain had one, built in `apps/web/src/shell/menus.ts` from delivered
registry routes only, with the curated topic subset represented by All Topics (historical,
superseded by Rebaseline R1, which removed the menus). Since Phase 23 Live Learning (`/learn/live`, the class schedule) and Find a
Teacher (`/learn/teachers`) are delivered as activation-aware pages, linked from the landing; they say
honestly when live learning is not switched on. Training and Resources have no owner contract and are
not linked.

### 3.5 Library

| Browse | Written Works | Periodicals | Access |
|---|---|---|---|
| All Resources | Articles | Magazines & Journals | Downloads |
| Books | Research | Encyclopedias | Printed Books & Sale Points |
| Authors | Research Papers | — | — |
| Topics | Publications | — | — |
| Languages | — | — | — |
| Collections | — | — | — |

### 3.6 Watch

| Watch | Series & Programs | By Topic | Listen |
|---|---|---|---|
| Featured | Series | Quran | Audio Lectures |
| Latest | TV Programs | Hadith | Quran Recitations |
| Lectures / Speeches | Interviews | Seerah | Playlists |
| Events | Documentaries | Spirituality | — |
| Highlights | — | All Topics | — |
| — | — | Speakers | — |

### 3.7 Fatwa

| Find | Browse | Ask | Understand |
|---|---|---|---|
| Search Fatwa | Categories | Ask a Question *(sign-in required)* | How It Works |
| Latest *(`?sort=latest`)* | Topics | My Questions *(sign-in required)* | — |
| Popular *(`?sort=popular`)* | Browse All | — | — |

Authentication-gated items are shown to anonymous visitors with a clear indicator; they
lead to sign-in with a validated return path, never to a dead end.

**Latest and Popular are query-based views of `/fatwa`**, not separate paths (§1.1).

Since Phase 20 every Fatwa item is delivered (engineering only — no ruling is published and nobody
holds a Fatwa permission, OPEN_DECISIONS.md §1.4). Popular means most read in the last 30 days,
counted anonymously; Topics are reached from a ruling, a category or the topic hub rather than as a
separate menu list. Ask a Question leads to sign-in and then to the Fatwa-owned My Questions; while
the service is not activated the section says so plainly and accepts no question.

### 3.8 News & Events

| News | Events | Media | Archive |
|---|---|---|---|
| Latest | Events | Photo Galleries | Archive |
| News | Event Galleries | Media Coverage | Collections |
| Press Releases | — | Media Downloads | Newsletter |
| Statements | — | — | — |

### 3.9 Global

| Network | Find | Structure | Local |
|---|---|---|---|
| World Network | Find a Centre | Countries | Local News |
| — | Centres | Regions | Local Events |
| — | — | Cities | Local Contacts |
| — | — | Pakistan City Structure | — |

---

## 4. Footer hierarchy

**Since 2026-11-08 (owner direction, OPEN_DECISIONS.md §8) the footer is the comprehensive index
again**: the six columns below (Column 1–6 — About Minhaj-ul-Quran, Knowledge, Library and Media,
Learn and Participate, Our Work, Global and Contact; ~75 links), rendered unconditionally from
`FOOTER_COLUMNS` in `apps/web/src/shell/menus.ts` with delivered or reserved registry routes only,
as at Phase-30 exit (below). R2's additions are kept: the **official channels** beside the wordmark,
the **Quran text's attribution** only while the `quranReference` signal holds, and the **one
pre-adoption statement** beside the organisation's unmodified mark. The closing row links the four
**legal documents always** — an unpublished one answers "Not yet published" at its address — and
the human **Sitemap**. The language switcher stays in the header only.

*Historical, superseded 2026-11-08 by owner direction.* From Rebaseline R2 until then the footer
read as follows.

**Since Rebaseline R2 (2026-11-06) the footer is six curated columns, not a sitemap**, drawn from
the same presentation policy as the header (`footerGroups` in `apps/web/src/shell/presence.ts`):
a route link appears only while its area has its evidence, a Page link only while that Page is
published, each address once, and an emptied column is dropped whole. News has a column of its
own and Learn shares one with the other ways to take part, so every header group is reachable
from the footer.

| Column | Links (each under its signal, §2.2) |
|---|---|
| **Quran & Knowledge** | Quran · Surah index · Hadith (or Hadith works) · Fatwa · Topics (always) |
| **Library** | Library · Books · Magazines · Research · Encyclopedias · Articles |
| **Watch & Listen** | Watch · Series · Playlists · Listen |
| **News & Events** | News · Press releases · Events · Collections |
| **About MQI** | About → `/explore` (always) · Introduction · The founder · Leadership · Departments · Global presence · Find a Centre |
| **Learn & take part** | Learn · Paths · Live classes · Teachers · My Minhaj (always) · Membership (`membership`) · Donate (only while giving is open) · Help · Contact |

Beneath the columns, in order:

- **Official channels** — the organisation's own YouTube, Facebook and X accounts and its
  publisher pages on the App Store and Google Play ("Minhaj Publications"), each address exactly
  the one minhaj.org's own footer links (`apps/web/src/shell/official-channels.ts`, captured
  2026-11-06), labelled by platform name; outbound links only — nothing fetched, embedded or
  tracked.
- **The Quran text's attribution**, only while the `quranReference` signal holds: "Quran text: the
  Uthmani text of the Tanzil Project (tanzil.net), used unmodified under the CC BY 3.0 licence"
  (OPEN_DECISIONS.md §1.1).
- **The one pre-adoption statement** beside the organisation's unmodified official mark, and the
  **legal links only for published legal Pages** — both unchanged from R1.

*Historical, superseded by Rebaseline R2.* From R1 until R2 the footer read as follows.

**Since Rebaseline R1 (2026-11-06) the footer is three deliberate groups, not a sitemap**, drawn
from the same presentation policy as the header (§2.2, `apps/web/src/shell/presence.ts`): a route
link appears only while its area has its evidence, a Page link only while that Page is published,
and a group left empty is dropped whole.

| Group | Links (each under its signal) |
|---|---|
| **Discover** | Quran · Hadith · Library · Watch · Listen (published audio) · Fatwa · News · Events (a published Event) · Collections · Topics (always) |
| **The organisation** | About → `/explore` (always) · Introduction (only while its Page is published) · Leadership (published contributor profiles) · Global presence (a published country of presence) · Find a Centre (a published Centre) |
| **Take part** | Learn · Donate (only while giving is open) · My Minhaj (always) · Help (a published help article) |

Beneath the groups: the **legal links only for published legal Pages** (privacy, terms, cookies,
accessibility, in that order), and the **one pre-adoption statement**, beside the organisation's
official mark used unmodified as a secondary organisational mark (OPEN_DECISIONS.md §6.4). The
header carries no pre-adoption marker. The full route list remains in the human-readable sitemap
(`/sitemap`); no reserved Explore page is linked.

*Historical, superseded by Rebaseline R1 — and restored 2026-11-08 (above).* From Phase 4 until
R1 the footer was the comprehensive index below — six columns (~70 links) plus a utility bar — "the
comprehensive index that the mega menus deliberately are not".

### Column 1 — About Minhaj-ul-Quran
Introduction · Vision · Mission · Values · Objectives · History · Timeline ·
Global Impact · Leadership · Shaykh-ul-Islam · Governance · Departments · Forums ·
Wings · Institutions · Annual Reports · UN Recognition · Awards

### Column 2 — Knowledge
Read Quran · Surah Index · Juz Index · Tafsir · Tajweed · Recitation ·
Hadith Collections · Hadith by Topic · Hadith Sciences · Fatwa · Ask a Question ·
Topics · Scholars

### Column 3 — Library & Media
All Resources · Books · Authors · Research · Research Papers · Publications ·
Encyclopedias · Magazines & Journals · Articles · Downloads · Printed Books & Sale Points ·
Videos · Audio · Playlists · Photo Galleries · Collections

### Column 4 — Learn & Participate
All Courses · Learning Paths · Live Learning · Trial Classes · Training · Teachers ·
Resources · Membership · Volunteer · Donate

### Column 5 — Our Work
Education · Research · Welfare · Women · Youth · Students · Interfaith ·
Human Rights · Peace & Counter-extremism · Community

### Column 6 — Global & Contact
World Network · Find a Centre · Countries · Regions · Cities · Pakistan Structure ·
Contact · Help / FAQ · Suggestions & Feedback · Newsletter · RSS · Mobile Apps ·
Social Media

### Footer utility bar
Language switcher · Copyright · Privacy Policy · Terms of Use · Cookie Policy ·
Accessibility Statement · Sitemap

*Privacy Policy, Terms of Use, Cookie Policy and Accessibility Statement are required
legal and compliance surfaces implied by operating an authenticated, multi-jurisdiction
platform. They are noted here as IA slots; their content is an organisational
responsibility, not an engineering one.*

**Delivered in Phase 30 (flagship presentation pass) — historical, superseded by Rebaseline R1.**
At Phase-30 exit the footer rendered all six columns from
`apps/web/src/shell/menus.ts` with **delivered or reserved registry routes only**: reserved pages
(the Explore pages, Volunteer) were linked because they existed and said honestly that nothing was
published yet; entries with no static route (Scholars, Hadith by Topic, Training, Resources, Regions,
Cities) were omitted rather than linked dead. The utility bar carried the legal links, the sitemap and
the pre-adoption statement; the language switcher stays in the header only — a second one would
duplicate a landmark and its pinned link names — and no copyright owner, contact detail or social
profile is shown, since none is evidenced (OPEN_DECISIONS.md §6.1, §6.4).

**Phase 30-R (review completeness, OPEN_DECISIONS.md §3.7).** At Phase-30-R exit the header and
footer carried the organisation's **current official logo** as provisional pre-adoption brand
evidence (the footer's on a light chip), and the utility bar a short "pre-adoption review build"
marker — one quiet global statement, never a banner on every page (historical, superseded by
Rebaseline R1: the product is now identified by the "One Minhaj" wordmark, the official mark
appears unmodified in the footer only, and the pre-adoption statement is the footer's alone —
OPEN_DECISIONS.md §6.4). Explore items whose catalogued source page has been
migrated and published now carry that **published Page** at their own reserved address (About —
Introduction and Global Impact; Shaykh-ul-Islam — Biography; Organization — Forums and UN
Recognition; Our Work — Peace & Counter-extremism; Digital Resources — Mobile Apps and Social
Media): the same canonical route, no second content system, words and date from the source,
pre-adoption review content subject to Minhaj's acceptance. Every other Explore item stays an
honest reserved page. Leadership lists the published leadership profiles (People) and links the
Shaykh-ul-Islam biography. Global lists the **countries of the organisation's stated presence**
even where no Centre is listed, and says so on each country rather than inventing an address.

---

## 5. Authenticated hierarchy — My Minhaj

**One product frame (since Rebaseline R1, 2026-11-06).** My Minhaj (§5), Teacher (§6), Admin (§7)
— through their shared `WorkspaceShell` — and the identity pages (sign-in, sign-up, recovery,
verification, account setup; their own `(identity)` layout) all carry the same **ProductBar**: the
"One Minhaj" wordmark linking home, the area's name, a "Back to One Minhaj" link and the language
switcher. Private pages are titled "<page> · <Area> · One Minhaj" by their area layouts; identity
pages by their own heading ("Sign in · One Minhaj"); `noindex` is explicit at each surface. Only
the frame changed in R1 — the hierarchies and workflows below are as delivered by their phases
(their redesign is later rebaseline work, not R1).

**Since Rebaseline R2 (2026-11-06; the R2 scope covers every private surface — OPEN_DECISIONS.md
§8).** My Minhaj has its own frame inside the ProductBar and its navigation is grouped: Home ·
Library (Saved, Notes, Collections, History) · Quran (reading progress) · Learning (My Learning,
My Classes, Teachers) · Messages · Questions · Membership · Giving · Notifications · Settings.

**Every section, always (owner direction 2026-11-08).** Every section above is listed for every
account (`apps/web/src/components/my/sections.ts`), whether or not the deployment has switched its
service on: each page says in words when its service is not available yet (live classes not
activated, messaging not activated, Fatwa intake closed, giving closed). The Home overview has a
module for every section — the next class (with its Google Meet "Join" when the teacher has set a
meeting address) and the way to My Teachers, Learning (My Learning, Course progress, Browse
courses), Saved (with Bookmarks, Notes, Collections), the Quran reading position, History,
Messages (with Support and My Teachers), Notifications (with their settings), Questions,
Membership, Donations and the account with its five settings links — each showing an honest empty
state rather than disappearing; "Make My Minhaj yours" still leads for a new account and
"Continue" while there is something to pick up. My Learning, My Classes, My Teachers and the
Messages pages again carry their neighbour links at their foot (those the page's tabs already
offer are not repeated). A person who holds teaching or administrative authority also sees a
**"Your work"** group linking the Teacher area and/or the administration; that is decided on the
server from Identity & Access's live evaluation of the session's permissions — `teaching.perform`,
or any permission that opens an administrative surface, the administration shell's own filter —
never from a profile (`apps/web/src/app/[locale]/my/staff-areas.ts`). The link is a convenience;
`/teacher` and `/admin` keep their own gates. *Historical, superseded 2026-11-08 by owner
direction:* under R2 a section was offered only while the deployment had switched its capability
on, from each owner's session-free read (the former `my/capabilities.ts`), and the Home overview's
modules rendered only when there was something to show.

The tree below is unchanged as a statement of what exists; Certificates and Learning Streaks stay
absent (ROUTE_MAP.md §5).

```
My Minhaj
├── Home                      Personalised overview: continue reading/watching,
│                             upcoming classes, unread messages, notifications
├── My Learning
│   ├── Enrolled Courses
│   ├── Learning Paths
│   └── Certificates                        (later phase)
├── My Classes
│   ├── Upcoming
│   ├── Past
│   └── Class Detail          Meeting link, materials, attendance record
├── Teachers
│   ├── My Teachers
│   └── Find a Teacher
├── Messages
│   ├── Conversations
│   └── Support
├── Saved
│   ├── Bookmarks             Quran ayat, Hadith, articles, videos, books
│   ├── Notes                 Personal annotations
│   └── Collections           Personal lists (distinct from editorial Collections)
├── History
│   ├── Reading History
│   └── Watch History
├── Progress
│   ├── Quran Reading Progress
│   ├── Course Progress
│   └── Learning Streaks                    (later phase)
├── My Questions
│   ├── Submitted
│   └── Answered
├── Membership                Applications, their status, and Memberships
├── Notifications
└── Settings
    ├── Profile
    ├── Account & Security    Password, connected Google account, sessions
    ├── Language & Locale
    ├── Interests & Goals     Editable onboarding answers
    ├── Notification Preferences
    └── Privacy
```

**Ownership.** This hierarchy is a **Layer-4 authenticated experience and composition
surface** (DOMAIN_MODEL.md §3.3, §14.4). It is **not** a bounded context, and it does **not**
make one context the semantic owner of every operation beneath `/my`:

| Area of the hierarchy | Semantic owner |
|---|---|
| Settings → Account & Security | **Identity & Access** |
| **Settings → Language & Locale** — the **account** interface locale and timezone | **Identity & Access** (DOMAIN_MODEL.md §4.2) |
| **Account setup state** | **Identity & Access** |
| Roles and permissions behind any surface here | **Identity & Access** |
| My Learning, Progress → Course Progress | **Learning** |
| My Classes, Teachers | **Learning** / the teacher-owning phase as documented |
| Messages, **including Messages → Support** | **Messaging** (DOMAIN_MODEL.md §15.5) |
| My Questions | **Fatwa** |
| Saved, History, Notifications, Notification Preferences, **Interests & Goals**, **personalisation onboarding**, **newsletter subscription** | **Personalisation & Notifications** (DOMAIN_MODEL.md §14) |
| Membership surfaces reached from here | **Membership** |
| Donation surfaces reached from here | **Donations** |

> **Language & Locale sits with Identity, not Personalisation.** Authentication surfaces,
> security mail and session handling need an account locale and timezone **before any
> personalisation context exists**, and Phase 2 must not depend on Phase 21
> (DOMAIN_MODEL.md §4.2). **Interests & Goals remain Personalisation's**, because they are
> personalisation input rather than account configuration.
>
> **Messages → Support is a Messaging conversation type**, not a ticketing product and not the
> public `/contact` form — those are Editorial-owned correspondence records
> (DOMAIN_MODEL.md §7.5).

> **Route placement transfers no semantic or domain ownership.** My Minhaj *composes* these
> capabilities through their owning contexts' public interfaces.

**Personalisation & Notifications** owns the aggregates of DOMAIN_MODEL.md §14.1 and defines
their privacy, deletion and retention rules. It stores **typed references** to content;
canonical content remains owned by its original domain, and personalisation is **never read in
the anonymous cached public render tree**.

Since Phase 21 Saved (Bookmarks, Notes, Collections), History (Reading, Watch), Progress → Quran
Reading Progress, Notifications, Settings → Interests & Goals, Notification Preferences and Privacy
are delivered, and the Home overview shows the panels whose owners exist — continue reading, recent
saved items, the Quran position, unread notifications and an optional onboarding prompt. Since
Phase 22 My Learning (Enrolled Courses, Learning Paths and the person's trial-class requests) and
Progress → Course Progress are delivered by Learning, with a Learning panel on the Home overview.
Since Phase 23 My Classes (Upcoming, Past, Class Detail with the meeting link under the disclosure
rule and the person's attendance record) and Teachers → My Teachers and Find a Teacher are delivered
by Learning. Since Phase 24 Messages → Conversations and Messages → Support are delivered by
Messaging (non-realtime; DOMAIN_MODEL.md §15.6) — a support conversation, never a ticket or CRM record
— with an unread-messages panel on the Home overview. Since Phase 26 Membership is delivered by
Membership — the person's own applications with their status, withdrawal of an open one, their
Memberships with self-closure, and the published types they may apply for — with a Membership panel
on the Home overview. Since Phase 27 Donations are delivered by Donations — the person's own linked
donations with their provider-verified status and refunds, and a linked start — with a Donations
panel on the Home overview. Certificates and Learning Streaks stay with no phase at all and are absent
rather than empty. Bookmarks cover exactly Quran ayat, Hadith, articles,
videos and books; history is off until the person turns it on; notifications are in-app only.

**Naming note.** *Saved → Collections* are private, user-owned lists. Editorial
Collections (section 1.3) are public, curated and permissioned. These are distinct
concepts and are kept distinct in the domain model; the shared word is disambiguated by
context in the UI ("My Collections" vs "Collections").

---

## 6. Teacher hierarchy

```
Teacher
├── Overview                  Today at a glance, pending items, quick actions
├── Today's Classes
├── Calendar                  Schedule across courses
├── Students
│   ├── All Students
│   └── Student Detail        Enrolment, attendance, progress (no free-form notes — see below)
├── Courses
│   ├── My Courses
│   └── Course Detail         Enrolled students, sessions, materials
├── Messages
├── Resources                 Teaching materials owned or shared
├── Attendance
│   ├── Mark Attendance
│   └── Attendance Reports
├── Availability              Teaching hours and bookable slots
└── Profile                   Public teacher profile and capabilities
```

The Teacher area is a **permission-gated area of the same application and the same
identity**, not a separate product. A teacher is also a user and retains their My Minhaj area.

**A TeacherProfile grants nothing.** Access requires a **current, auditable role assignment**
granting the teaching permission; revoking that assignment removes access immediately,
including in messaging (DOMAIN_MODEL.md §4.5).

**Delivered in Phase 23:** every item above except Messages, which Phase 24 delivered. Access additionally requires a current typed Course teaching scope and live-learning
activation (DOMAIN_MODEL.md §13.5). **Student Detail carries no free-form notes:** an earlier
revision of this tree listed "notes", but no accepted Learning aggregate, retention rule or
safeguarding contract defines teacher notes about a learner (OPEN_DECISIONS.md §2.1, §2.2 open), so
none is stored; a future owning decision would add it as its own contract. Resources is a truthful
view over the Courses' own syllabus and lesson bodies — nothing is uploaded or shared. Profile is
read-only here; the public TeacherProfile is People's.

**Since Rebaseline R2.** The tree is unchanged; the surfaces are redesigned. Overview leads with
today and what is upcoming; Calendar and Availability show a Monday-to-Sunday week in the teacher's
own zone, moved by `?week=` (ROUTE_MAP.md §6); each class shows its stage (upcoming, live, ended,
completed, cancelled) and **attendance and "mark held" are never offered before a class has
started** — the UI mirrors Learning's `not-started` refusal (DOMAIN_MODEL.md §13.5); Students can
be narrowed by name and progress within the page shown; every page is titled by its own fixed name.
Not built (recorded, not promised): a learner's last activity, a server-side student search,
per-Course past classes, a CSV export, materials upload and recurring availability.

---

## 7. Admin hierarchy

```
Admin
├── Dashboard
├── Content
│   ├── Articles
│   ├── Books
│   ├── Research & Papers
│   ├── Publications
│   ├── Magazines & Journals
│   ├── Encyclopedias
│   ├── News
│   ├── Press Releases & Statements
│   ├── Events
│   ├── Pages                 Organisational/static content
│   ├── Editorial Queue       Cross-domain review workload
│   └── Correspondence        Private inbound, permission-controlled
│       ├── Contact Inquiries  Triage, assignment, resolution, spam disposition
│       └── Feedback           Distinct record and workflow
├── Religious Content         Elevated permissions and stricter workflow
│   ├── Quran
│   │   ├── Text & Structure
│   │   ├── Translations
│   │   ├── Transliterations
│   │   ├── Tafsir
│   │   ├── Recitations
│   │   └── Tajweed
│   ├── Hadith
│   │   ├── Collections, Books & Chapters
│   │   ├── Hadith Records
│   │   ├── Commentary
│   │   └── Sciences
│   └── Fatwa
│       ├── Incoming Questions
│       ├── Assignment
│       ├── Drafting
│       ├── Scholar Review
│       ├── Published Fatawa
│       └── Categories
├── Media
│   ├── Videos                Provider metadata
│   ├── Audio
│   ├── Photos & Galleries
│   ├── Playlists & Series
│   └── Asset Library
├── Taxonomy
│   ├── Topics                Canonical taxonomy management
│   ├── Topic Mapping         Cross-domain topic assignment
│   ├── Languages
│   └── Tags
├── Collections               Curated editorial collections
├── Learning
│   ├── Courses
│   ├── Learning Paths
│   ├── Classes & Sessions
│   ├── Enrolments
│   └── Trial Class Requests
├── Identity & Access         Accounts and authorisation — Identity-owned
│   ├── Users                 Account status and lifecycle
│   ├── Roles
│   ├── Permissions
│   ├── Role Assignments      Auditable grants and revocations
│   └── Security              Second-factor state, bootstrap status, identity audit
├── People                    Public contributor identity — People & Contributors
│   ├── Persons
│   ├── Teachers              Approval creates an auditable RoleAssignment
│   ├── Scholars              Profiles; capability labels are derived projections
│   ├── Speakers
│   └── Authors
├── Global
│   ├── Countries, Regions & Cities
│   ├── Centres
│   └── Centre Contacts
├── Membership                Delivered in Phase 26 — membership.read / membership.administer
│   ├── Types                 Every state; words per locale, publish and archive; members
│   └── Applications          Queue and detail: review, approve, reject — no payment control
├── Donations                 Delivered in Phase 27 — donations.read / donations.administer / donations.refund
│   ├── Records               Filters, detail, reconcile, CSV export; refunds need the gated key + step-up
│   └── Campaigns             Every state; words per locale, currency policy, publish and archive
├── Messaging                 Delivered in Phase 24 — messaging.support / messaging.moderate
│   ├── Support Queue         Metadata only; opening a conversation is an audited access
│   └── Moderation            Open reports, Reports, and one report's bounded evidence
├── Migration & Provenance    Delivered in Phase 29, fixture sources only — migration.read / migration.administer / migration.publish
│   ├── Overview             Fixtures only, no live source; runs and promotions are command-line operations
│   ├── Sources              Fixture registration and politeness; no authority field
│   ├── Import Runs          Provenance, reconciliation verdict, items; cancel an open run
│   ├── Staging Review       Queue and one revision as escaped text; raw snapshot preview and download, audited
│   ├── Deduplication Queue  Merge, keep apart or reopen; a cross-language pair is never merged
│   ├── URL Mapping          Legacy URL mappings, category-to-topic mappings, unresolved links
│   ├── Import Errors        Retry or dismiss errors; classify missing records — absence deletes nothing
│   ├── Publish Manifests    Prepare, publish and roll back (gated key + step-up); promotions
│   └── Reconciliation       Completed runs and whether their counts balance
├── Communications
│   ├── Newsletter            Subscribers, confirmation state, suppression
│   └── Delivery Status       Pending, failed and suppressed outbound mail
└── System
    ├── Navigation & Menus
    ├── Redirects & Slug History  Native redirects and legacy mappings, distinguished
    ├── Search Operations         Configuration, rebuild, indexing lag and failures
    ├── Audit Log
    ├── Integrations              Provider configuration and status diagnostics
    └── Settings

**Two corrections are recorded in this tree.**

**Accounts and authorisation are Identity-owned, not People-owned.** A previous revision placed
Users and *Roles & Permissions* under **People**, which conflicts with the domain model and with
the route map: **Identity & Access** owns User, Role, Permission and RoleAssignment
(DOMAIN_MODEL.md §4), while **People & Contributors** owns the public Person and its profiles
(§5). They are separate branches because they are separate contexts — and because **a profile
grants nothing**, while a RoleAssignment grants everything (ROUTE_MAP.md §7).

**Operator surfaces exist for the things operators must actually see.** Search rebuild and
indexing lag, outbound delivery failures, provider status, and the distinction between native
slug redirects and legacy mappings are all operational realities of this architecture
(ARCHITECTURE.md §8.5, §4.6.1; DOMAIN_MODEL.md §19.7). A surface that is promised here is
delivered by the phase that owns the capability, under the availability rule of
ROUTE_MAP.md §5.2.
```

**Since Rebaseline R2.** The tree is unchanged; its presentation is queue-first. The Dashboard
shows, per area the viewer can act in, how much work waits (counts from each owning context's own
service, never names); each area's root address opens the first surface of that area the viewer's
keys reach instead of a 404; a navigation group with no reachable surface is not shown; every
listing uses one shared pager; irreversible and privilege-changing forms confirm in a dialog, with
a reason where the change wants one. The Editorial Queue offers a second administrator's bulk
approve-and-publish of selected rows (at most 25, each audited as two single acts), and Migration
offers run-wide acts — approve a run's confirmed candidates, clear its pictures by registered host
after seeing each, draft a manifest of the next 100 — each a person's audited decision per item
(ROUTE_MAP.md §7; MIGRATION_STRATEGY.md §19). The Audit Log filters by action prefix, actor and
date range.

### 7.1 Why Religious Content is a separate admin branch

Quran, Hadith and Fatwa are separated from general Content at the top level of the admin
IA because they differ in kind, not merely in subject:

- They require **elevated, explicitly granted permissions** (`quran.editCanonical`,
  `hadith.editCanonical`, `fatwa.publish`) rather than general editorial rights, plus
  **step-up reauthentication**.
- They require **domain-specific review workflows** — a Fatwa requires authorised scholar
  approval; canonical Quran and Hadith text requires verification against an authoritative source.
- They require **full edit auditability**, including who changed what and on whose authority.
- They must **never be edited through an arbitrary WYSIWYG editor**. Canonical religious
  text uses purpose-built structured editors with validation, not free-form rich text.

Placing them inside a generic "Content" tree would invite exactly the permission and
workflow flattening the architecture must prevent.

---

## 8. Cross-cutting IA surfaces

These are reachable from many places and belong to no single section:

| Surface | Description |
|---|---|
| Topic page | The canonical hub for a topic, aggregating every content type |
| **Contributor profile** | **One canonical surface at `/people/{slug}`** presenting a Person's author, speaker, scholar and teacher facets as applicable — not several competing indexable pages |
| Search results | Unified, filterable by content type, topic, language and date |
| Collection page | A curated set, possibly of mixed content types |
| Centre page | A location with its own news, events and contacts |
| Series / Playlist | Ordered media grouping |
| Language-filtered browse | Any listing constrained by content language. Since Rebaseline R2 a content card whose content language differs from the interface locale carries a language badge, and News listings take `?lang=` while leading with the interface language's records by default (ROUTE_MAP.md §3.9) |

---

## 9. Duplication resolved in this IA

| Legacy duplication | Resolution |
|---|---|
| "Featured" / "Popular" / "Latest" as separate sections | Flags and queries over existing content (1.1) |
| Per-site, per-domain category systems | One canonical topic taxonomy plus domain structural axes (1.2) |
| Campaign and historical archives as permanent nav items | Curated Collections (1.3) |
| Quran nested under a general library | Independent first-class domain (1.4) |
| Books appearing separately under Quran, Hadith, Library and Shaykh-ul-Islam | One Book entity, surfaced through topic, author and collection relationships |
| Videos appearing under Watch, Quran, Hadith and Events | One Video entity, surfaced through topic and series relationships |
| Articles duplicated across sections | One Article entity with topic relationships |
| "Media" as both a nav section and a content domain | Content domain, surfaced via News & Events and Collections (section 2.2) |
| Personal saved lists vs editorial collections sharing a name | Two distinct concepts, disambiguated in UI labelling (section 5) |
| **Two indexable author routes** (`/authors/{slug}` and `/library/authors/{slug}`) | **One canonical `/people/{slug}`; aliases 301** |
| **Domain topic pages competing with the canonical topic hub** | **Filtered views carrying a canonical link to `/topics/{slug}`** |
| **`/fatwa/latest` and `/fatwa/popular` as paths** | **Query-based views of `/fatwa`** — restoring consistency with §1.1 |
| **Author owned by the Library domain** | **People & Contributors owns all contributor identity; Speaker is explicitly owned** |
| **Quran recitations authorable in two places** | **Quran owns the Recitation work; Media presents catalogue projections only** |
| **Legacy provenance inside editorial content** | **Migration & Provenance owns it, so Quran and Hadith carry provenance without depending on Editorial** |
| **Bookmarks, notes, history and notifications with no owner** | **Personalisation & Notifications context** |
| **Polymorphic `targetType + targetId` references** | **Typed relationships with database-enforced integrity** |
| **Contact and feedback submissions with no owner** | **A limited private correspondence area in Editorial** — not a CRM, not a Fatwa Question (DOMAIN_MODEL.md §7.5) |
| **Newsletter promised in four places, owned nowhere** | **Personalisation & Notifications**, with double opt-in and independent of User (DOMAIN_MODEL.md §14.5) |
| **`Messages → Support` with no defined meaning** | **A Messaging conversation type**, reusing the existing model (DOMAIN_MODEL.md §15.5) |
| **Accounts and roles administered under "People"** | **Identity & Access administers accounts and grants; People administers public contributor identity** (§7) |
| **Account locale owned by Personalisation** | **Account locale and timezone are Identity's**, so Phase 2 needs no personalisation context (§5) |
