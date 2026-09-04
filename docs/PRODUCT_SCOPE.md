# Product Scope — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit
**Owner:** Minhaj-ul-Quran International
**Document type:** Planning only. No implementation is authorised by this document.

---

## 1. Product vision

Minhaj-ul-Quran International's digital presence is currently fragmented across a number
of independently built and independently operated public websites: the main Minhaj.org
site, a books site, Minhaj.TV, TheFatwa, Irfan-ul-Quran, magazine and publication sites,
and public eLearning/course sites, among others.

Each of these was built at a different time, on a different stack, with a different content
model and a different visual language. The consequence for a visitor is that a single
intellectual journey — reading a Quranic verse, then a tafsir of it, then a lecture about
it, then a Fatwa touching on it — requires crossing between unrelated websites, each with
its own navigation, its own search, and no shared notion of a topic.

**One Minhaj** is the consolidation of that ecosystem into a single, unified, multilingual
digital platform served from Minhaj.org.

The defining goal is not a visual refresh. It is **the unification of the content graph**:
one canonical topic taxonomy through which Quran, Hadith, books, research, publications,
videos, audio, Fatwa, articles, news, events, courses and scholars are all addressable and
cross-linkable. A visitor arriving at a topic should find every kind of Minhaj material on
that topic in one place, in their language, without leaving the site.

### Guiding product principles

1. **The public site is the product.** The authenticated experience is an enhancement
   layered on top of a site that is already complete without it.
2. **Quran and Hadith are first-class domains**, not categories inside a generic library.
   They carry stricter integrity, review and provenance requirements than editorial content.
3. **One taxonomy, many content types.** Topics are the connective tissue of the platform.
4. **Consolidation, not redirection.** Core user-facing content lives on Minhaj.org.
   Legacy sites are superseded, not merely linked.
5. **Locale-aware from day one.** English, Urdu and Arabic are architectural requirements,
   not a later translation project.
6. **Religious integrity is a system property.** Canonical religious content is protected
   by workflow, permission and audit — not by editorial goodwill alone.

---

## 2. What V1 is

V1 delivers a unified public platform plus the foundations of a personalised authenticated
experience.

### 2.1 Public platform (no account required)

The following must be fully usable by an anonymous visitor:

| Area | V1 public capability |
|---|---|
| Explore | Organisational information, leadership, Shaykh-ul-Islam, structure, work, community, digital resources, membership information, contact, help |
| Quran | Read, browse by Surah and Juz, search, translation, transliteration, tafsir, tajweed guidance, recitation audio, Quran topics, and linked books/videos/articles/research |
| Hadith | Browse collections, books and chapters, search, Hadith by topic, Hadith sciences, commentary, and linked material |
| Learn | Canonical topics, course catalogue, learning paths, teacher directory, training and resources (browsing; enrolment is authenticated) |
| Library | All resources, works and editions, contributors, topics, languages, collections, articles, research, research papers, publications, encyclopedias, magazines and journals, downloads, printed-book/sale-point information |
| Watch / Listen | Video and audio catalogue with embedded third-party players, series, programs, speakers, playlists, recitations |
| Fatwa | Search, categories, topics, browse all (with latest/popular as query-based views), how-it-works (asking a question is authenticated) |
| News & Events | Latest, news, events, press releases, statements, media coverage, photo galleries, collections, newsletter, archive |
| Collections | Curated historical and campaign archives |
| Media | Photos, galleries, event galleries, historical archive, media downloads |
| Global | World network, centre finder, countries, regions, cities, centres, Pakistan city structure, localised news/events/contacts |
| Scholars | Contributor profiles — biography, qualifications, expertise, languages and linked works |
| Search | Unified cross-domain search |
| Donate | Donation entry point |

### 2.2 Authenticated experience ("My Minhaj")

Optional. Provides personalisation and continuity: home, my learning, my classes,
teachers, messages, saved items, reading and watch history, progress, my questions,
notifications, settings.

Authentication is via email/password and Google OAuth. **These have separate external
prerequisites and are separately gated**: email/password requires an email provider, Google
sign-in requires Google OAuth application credentials, and neither blocks the other. Those
credentials are **not** required for the manual Google Meet URL flow (§2.5).

The internal Minhaj user record remains authoritative for roles, preferences, learning state,
messages and all application domain data. **Google authentication must never create a new
Minhaj email address** — it is an identity provider, not a mailbox provider. **A user account
is application identity and is not automatically a public contributor profile.**

Onboarding is conditional and personalised, collecting interests and goals, language, and
— only where relevant to what the visitor has expressed interest in — learner level and
preferred learning format.

### 2.3 Teacher experience

The same identity system, gated by an **auditable role assignment granting the teaching
permission** — a teacher profile alone grants nothing: overview, today's classes, calendar,
students, courses, messages, resources, attendance, availability, profile.

### 2.4 Admin / CMS

The editorial and administrative surface for all content domains, with permission-based
access control, domain-specific review workflows, and audit logging.

### 2.5 Live classes

Google Meet only. The system stores `meetingProvider` and `meetingUrl`; a teacher or
administrator enters the Meet URL manually, so **the application holds no Google API
credentials for this flow and never calls a Google API**. Automated Google Calendar/Meet API
provisioning is deferred behind an integration abstraction and **would carry its own
credential requirements** if later approved. Class metadata and history are
in scope for a later phase; class recording is not.

### 2.6 Messaging

A first-party persistent messaging system — distinct from Google Meet — with SQL Server
persistence. The messaging domain owns all conversation and authorisation rules; a small
separate realtime process is introduced later purely as a transport and presence adapter,
and messaging works without it.

### 2.7 Legacy migration

An importer framework operating on **authorised public content ingestion** and any source,
export or API access subsequently supplied by Minhaj. Legacy source and provenance data is
owned by a dedicated **Migration & Provenance** boundary, so every domain — including Quran
and Hadith — carries provenance for 301 redirects and traceability. Migration publishes into
target domains **through their public interfaces**, so every domain rule, including religious
approval, applies to migrated content exactly as to hand-authored content.

---

## 3. Public vs authenticated distinction

This distinction is a hard architectural boundary, not a UI preference.

### 3.1 The rule

> **Nothing that is public knowledge may be placed behind authentication.**

Minhaj-ul-Quran's mission is the dissemination of religious knowledge. A visitor who will
never create an account must still receive the full scholarly value of the platform.
Authentication exists to remember *the person*, never to unlock *the knowledge*.

### 3.2 What authentication legitimately gates

Authentication is required only where the feature is inherently about a specific person:

- Personal state: bookmarks, notes, reading progress, watch history, saved items
- Learning enrolment, class participation, attendance and progress
- Messaging between students, teachers and support
- Asking a Fatwa question and tracking one's own submitted questions
- Notifications and personal settings
- Any teacher, editorial or administrative capability

### 3.3 What authentication must never gate

- Reading the Quran, its translations, transliteration, tafsir, or listening to recitation
- Browsing, reading or searching Hadith
- Reading books, articles, research, publications or magazines
- Watching lectures or listening to audio
- Reading published Fatawa
- News, events, galleries, scholar profiles, centre and organisational information
- Site-wide search across any of the above

### 3.4 Consequence for implementation

Public routes are anonymously cacheable and rendered as Server Components without a session
dependency.

**The anonymous public render tree must never read session-derived state** — no private
preferences, saved state, meeting URLs, private Fatwa questions, messages or notification
state (ARCHITECTURE.md §8). Personalisation renders in explicitly uncached authenticated
boundaries composed alongside the cached public tree.

Personalisation is therefore additive: a signed-in visitor sees the same cached page plus
their own uncached islands. A public page must never fail, blank out, or degrade because no
session exists.

---

## 4. Explicit non-goals for V1

These are deliberate exclusions. Each may be revisited in a later written architecture
decision, but none may be introduced during V1 feature work.

### 4.1 Excluded product capabilities

| Excluded | Rationale |
|---|---|
| RAG over Minhaj content | Requires a validated, curated corpus that will not exist until migration and editorial QA complete. Premature RAG over unverified religious content is a correctness and credibility risk. |
| AI agents with tool access | No authorisation boundary model exists yet. Out of scope. |
| AI-issued or AI-drafted Fatwa | Absolutely prohibited. A Fatwa is issued only by an authorised scholar. |
| Class recording | Storage, consent, retention and privacy implications are unresolved. |
| Custom video hosting | Bandwidth and cost are unjustifiable; provider embeds are sufficient. |
| Social features (stories, statuses, calling) | The platform is not a social network. |
| Automated Google Meet/Calendar provisioning | Deferred behind an integration abstraction; manual URL entry is sufficient for V1. |

A small, **deterministic** site-navigation and FAQ assistant called **Minhaj Guide** may be
introduced much later. It performs navigation and search assistance over existing site
structure. It does not generate religious rulings, interpret scripture, or produce
free-form theological text.

### 4.2 Excluded technologies

Azure Communication Services · Jitsi · custom WebRTC · Redis (initially) · Kubernetes ·
microservices · Redux or another global state library by default · Turborepo (unless a
demonstrated need arises) · Vercel-specific platform assumptions · any canary, beta, RC,
preview or experimental dependency.

### 4.3 Excluded practices

- Scraping any source without authorisation
- Bypassing authentication, anti-bot protection or access restrictions
- Inferring or collecting private user/student data from public pages
- Inventing religious content, chains of authority, or organisational facts
- Assuming access to a legacy database. **ParaTech did not build the existing Minhaj systems,
  and no legacy database dump or export is currently available or assumed. Minhaj may later
  provide exports, API access, source access or other authorised migration sources** — that
  possibility is not foreclosed, merely not assumed

---

## 5. Scale posture

This is a production platform for an international organisation with a global audience and
a large, multilingual content corpus spanning decades. It is explicitly **not** a landing
page or brochure site. Architectural decisions assume:

- Content volume in the tens to hundreds of thousands of records after migration
- A global, predominantly mobile, frequently low-bandwidth audience
- Three locales with mixed LTR and RTL text, including within a single page
- Long content lifetime, where permanent URLs and citation stability matter
- Religious content whose accuracy carries reputational and doctrinal weight

---

## 6. Success criteria for V1

1. An anonymous visitor can complete a full research journey — verse to tafsir to lecture
   to related Fatwa — without an account and without leaving Minhaj.org.
2. Every content type is reachable through one canonical topic taxonomy.
3. The platform serves English, Urdu and Arabic with correct RTL rendering.
4. Legacy URLs from migrated sources resolve via 301 to their canonical new location.
5. No religious content is publishable without passing its domain's review workflow.
6. The public site renders correctly and completely with no session present, with **no
   session-derived state in the anonymous cached render tree**.
7. The platform meets **WCAG 2.2 AA**, including the Quran reader, long-form readers and
   media surfaces.
