# Information Architecture — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit
**Document type:** Planning only.

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

### 1.4 Quran and Hadith are peers, never nested

Neither is a subsection of Library, and neither is a subsection of the other. Each is a
top-level domain with its own reading experience, its own structural navigation, its own
search, and its own integrity rules.

### 1.5 Depth over breadth in navigation

Twelve primary items is already a large navigation. Breadth is controlled by pushing
detail into well-designed mega menus rather than by adding top-level items. Any future
request for a new primary item is answered first by asking which mega menu it belongs in.

---

## 2. Primary navigation

### 2.1 Utility navigation (thin bar above primary)

| Item | Behaviour |
|---|---|
| Language switcher | English / اردو / العربية — preserves current route |
| Find a Centre | Direct link into the Global centre finder |
| Membership | Membership information and joining |
| Contact / Help | Contact routes and help centre |

The language switcher is placed in utility navigation deliberately: it is a
persistent, site-wide concern and must be reachable from every page without
entering a menu.

### 2.2 Primary navigation

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
| 12 | Donate | Prominent call to action |

**Note on "Watch".** The label is *Watch*, but the domain covers both video and audio.
Audio lectures and Quran recitation live here, and the mega menu carries an explicit
"Listen" grouping so audio is not lost behind a video-shaped label.

**Note on "My Minhaj".** This is an account entry point, not a content section. Signed
out it presents sign-in and the value of an account; signed in it becomes the gateway to
the authenticated area.

**Note on "Media".** Photos and galleries are reachable through News & Events (where
event galleries naturally belong) and through Collections (for the historical archive).
Since Phase 13 the News & Events entry point, `/news`, links the photograph surfaces; since
Phase 14 it links Events too, and each Event links its own photographs (its gallery view), so
Event galleries are reached through their Event rather than a listing of their own. The
newsletter appears only when its own phase delivers it. Since Phase 14 each Centre page lists
its Local Events beside its Local News.
Media is therefore a content domain but **not** a primary navigation item — adding a
thirteenth item for it would violate 1.5 while duplicating existing entry points.

---

## 3. Mega-menu grouping

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
| Surah Index | Transliteration | Quran Books | Quran Teachers |
| Juz / Para Index | Tafsir | Quran Videos | — |
| Search Quran | Tajweed | Quran Articles | — |
| Recitation / Audio | — | Quran Research | — |

Signed-in additions surfaced in-context (not in the menu): bookmarks, notes, reading
progress, continue reading.

### 3.3 Hadith

| Browse | Study | Explore | Learn |
|---|---|---|---|
| Introduction | Hadith Sciences | Hadith by Topic | Hadith Courses |
| Collections | Commentary | Hadith Books | Hadith Scholars |
| Books | — | Hadith Videos | — |
| Chapters | — | Hadith Articles | — |
| Browse All | — | Hadith Research | — |
| Search Hadith | — | — | — |

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

The footer is the comprehensive index that the mega menus deliberately are not.

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

---

## 5. Authenticated hierarchy — My Minhaj

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
│   └── Student Detail        Enrolment, attendance, progress, notes
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
│   │   └── Recitations
│   ├── Hadith
│   │   ├── Collections, Books & Chapters
│   │   ├── Hadith Records
│   │   └── Commentary
│   └── Fatwa
│       ├── Incoming Questions
│       ├── Assignment
│       ├── Drafting
│       ├── Scholar Review
│       └── Published Fatawa
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
├── Membership
├── Donations                 Configuration and records
├── Messaging
│   ├── Support Queue
│   └── Moderation
├── Migration & Provenance
│   ├── Sources              Authorisation and licensing evidence
│   ├── Import Runs
│   ├── Staging Review
│   ├── Deduplication Queue
│   ├── URL Mapping
│   ├── Unresolved Links     Links with no mapping, for review
│   ├── Publish Manifests    Reversible publication records
│   ├── Reconciliation       Counts must balance
│   └── Import Errors        Raw snapshots render inertly
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
| Language-filtered browse | Any listing constrained by content language |

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
