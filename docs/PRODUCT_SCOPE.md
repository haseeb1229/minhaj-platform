# Product Scope — One Minhaj Platform

**Status:** Living canonical baseline for the current accepted repository. Updated in the same
task as any accepted change that directly affects it (DELIVERY_PLAN.md §5.1).
**Origin:** Phase 0A Architecture Freeze, revised after independent architecture audit, again at
the pre-Phase-2 product-completeness review, and continuously through the delivered phases.
**Intended organisation:** Minhaj-ul-Quran International (possible adoption; not officially
commissioned or adopted — *Current implementation status* below)
**Target product:** One Minhaj
**Document type:** Product scope and acceptance baseline. It authorises no implementation by
itself; phases are authorised and delivered through DELIVERY_PLAN.md.

---

## Product status and acceptance

### Current implementation status

One Minhaj is an **independently developed implementation intended for possible adoption by
Minhaj-ul-Quran International**. It is **not currently officially commissioned, sponsored,
adopted or deployed** by that organisation, and nothing in this baseline should be read as
claiming that it is.

That status describes *who has accepted the work*, not *what the work is*. The product itself
remains a **complete production-target platform**:

> **This is not a demo, a prototype, a mock system or a reduced architecture.**

Where official material is not yet available — the authoritative corpus, organisational
accounts, official infrastructure, the official domain — the gap is **environment and content
state**, never a smaller product. Representative development content is data, not
architecture. **There is no DemoMode**, and no second, lesser version of the system exists.

### Three acceptance dimensions, never conflated

| Dimension | What it accepts | Who accepts it |
|---|---|---|
| **1. Software / engineering acceptance** | That an implementation meets its phase deliverables, security exit criteria and tests | Engineering, through the review workflow (DELIVERY_PLAN.md §6) |
| **2. Authoritative content / corpus acceptance** | That published religious and organisational content is authentic, approved and correctly attributed | Minhaj religious and organisational authority (OPEN_DECISIONS.md §1, §6) |
| **3. Deployment / launch acceptance** | That the platform is adopted, provisioned on official infrastructure and launched on the official origin | Minhaj-ul-Quran International (OPEN_DECISIONS.md §4, §7) |

**No dimension implies another.** Software acceptance of the Quran phase is not corpus
acceptance; corpus acceptance is not launch approval; launch approval is not a claim that
every later phase has shipped. The corresponding **gate types** — implementation, activation,
content acceptance and launch — are defined in DELIVERY_PLAN.md §3.1.

### Pre-adoption deployment

A publicly reachable **developer-controlled pre-adoption / presentation origin** — currently
`minhajulquran.haseebliaqat.me` — may run the platform before adoption. It is the **same
application**, built and configured the same way.

While the platform has not been officially adopted and launched:

- the pre-adoption deployment is **kept non-indexable** — `noindex` plus the corresponding
  crawler controls (ROUTE_MAP.md §9.5);
- it **emits no SEO posture that competes with or impersonates the official organisation
  site** — no official-origin canonical URLs, no submitted sitemaps, and no structured data
  asserting the organisation's identity as though published by it;
- it **claims no official endorsement, commissioning or adoption**;
- the application itself is **not reduced in any way**.

This is an **environment and launch-state safeguard**, not a mode of the software. Official
indexing and canonical production SEO are enabled only at the approved official-origin launch
transition (DELIVERY_PLAN.md, Phase 35).

**Staging is a separate environment** (Phase 28): `minhaj.haseebliaqat.me`, behind an
environment access gate, used for testing, demonstration, acceptance and — from Phase 30 —
migration dry-runs (ARCHITECTURE.md §10.6). It runs the **same complete application**, is
equally non-indexable, and is no more an official or reduced build than the presentation origin.

**The pre-adoption review corpus (Phase 30, Stage 1A).** Before the build is shown to Minhaj, staging
carries a **bounded, representative corpus of real public content**, migrated from the authorised
legacy sources through the very pipeline, provenance, review and domain publishers the full
migration uses (MIGRATION_STRATEGY.md §10.1.0). It is **data, never a reduced product**: no DemoMode,
no sample-data feature, no second import path, and nothing fabricated to fill a page — a surface a
source cannot fill shows an honest unavailable or limited state. It is **not** the full corpus
(that is Stage 1B, after Minhaj's review), **not** officially accepted content, and religious
material in it is staged for review, never published by migration. All three acceptance
dimensions above remain separate.

Commercial questions — source ownership, licensing, portfolio rights, retention of a clone,
future reuse — are **outside technical architecture** and are deliberately not recorded in
this baseline.

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
| Library | All resources, works and editions, contributors, topics, languages, collections, articles, research, research papers, publications, encyclopedias, magazines and journals, **readable long-form access to available editions**, **rights-aware downloads**, printed-book/sale-point information |
| Watch / Listen | Video catalogue with embedded third-party players; non-Quran audio played from the platform's own storage; series, programs, speakers, playlists; Quran recitations (Quran-owned) |
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

**Two distinct onboarding steps exist, and they are never merged.**

- **Account setup** belongs to **Identity & Access** and arrives with authentication. It
  establishes the account, its verified email address, its interface locale and timezone, and
  its account-setup state.
- **Personalisation onboarding** belongs to **Personalisation & Notifications** and arrives
  with that context. It is conditional, collecting interests and goals and — only where
  relevant to what the visitor has expressed interest in — learner level and preferred
  learning format.

**Authentication therefore depends on neither the topic taxonomy nor personalisation**
(DOMAIN_MODEL.md §4.2, §14.1).

### 2.3 Teacher experience

The same identity system, gated by an **auditable role assignment granting the teaching
permission** — a teacher profile alone grants nothing: overview, today's classes, calendar,
students, courses, messages, resources, attendance, availability, profile.

### 2.4 Admin / CMS

The editorial and administrative surface for all content domains, with permission-based
access control, domain-specific review workflows, and audit logging.

**High-consequence privileged capabilities additionally require an enrolled second factor
before they may be exercised**, and step-up reauthentication where the operation warrants it
(SECURITY_BASELINE.md §8). Ordinary users are not required to enrol a second factor.

### 2.5 Live classes

Google Meet only. The system stores `meetingProvider` and `meetingUrl`; a teacher or
administrator enters the Meet URL manually, so **the application holds no Google API
credentials for this flow and never calls a Google API**. Automated Google Calendar/Meet API
provisioning is deferred behind an integration abstraction and **would carry its own
credential requirements** if later approved. Class metadata and history are
delivered by Phase 23 (DOMAIN_MODEL.md §13.5); class recording is not in scope.

### 2.6 Messaging

A first-party persistent messaging system — distinct from Google Meet — with SQL Server
persistence. The messaging domain owns all conversation and authorisation rules; a small
separate realtime process (delivered in Phase 25) is purely a transport and presence adapter,
and messaging works without it.

### 2.7 Legacy migration

An importer framework operating on **authorised public content ingestion** and any source,
export or API access subsequently supplied by Minhaj. Legacy source and provenance data is
owned by a dedicated **Migration & Provenance** boundary, so every domain — including Quran
and Hadith — carries provenance for 301 redirects and traceability. Migration publishes into
target domains **through their public interfaces**, so every domain rule, including religious
approval, applies to migrated content exactly as to hand-authored content. Legacy-domain 301s
are served only from the Phase-35 cutover; before it, Phase 30 proves mapping resolution in
staging or a controlled harness (ROUTE_MAP.md §9.7).

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

> **Minhaj Guide is unscheduled and is not a V1 promise.** It has no phase, no route, no
> navigation entry and no reserved bounded context (DOMAIN_MODEL.md §1.1), and it is not
> referenced from any delivered surface until a phase genuinely owns it (§4.4).

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

### 4.4 Unscheduled — mentioned somewhere, promised nowhere

Some capabilities appear in this baseline as *conceptual* future possibilities. They are
recorded so the model does not have to be rewritten later — **they are not V1 commitments**,
and no phase owns them:

| Unscheduled item | Where it is mentioned | Status |
|---|---|---|
| **Minhaj Guide** assistant | §4.1; TECH_STACK.md §14 | No phase, no route, no context |
| **Certificates** | INFORMATION_ARCHITECTURE.md §5 | Marked *later phase*; no schema, no route |
| **Learning streaks** | INFORMATION_ARCHITECTURE.md §5 | Marked *later phase*; no schema, no route |
| **Narrator** records and chains | DOMAIN_MODEL.md §9 | Sourced Hadith data where included; **no standalone narrator-management subsystem is introduced** |

**Rules:**

- An unscheduled item **never acquires a navigation entry, a call to action, a reserved
  indexable route or a sitemap entry** before the phase that delivers it.
- A conceptual mention in the domain model is **not** authority to build an administration
  subsystem for it.
- Anything that becomes genuinely scheduled gains an owning phase, deliverables, tests and
  exit criteria like any other work — it is not smuggled in as a sub-feature.

This rule and the availability rule for **deferred but in-scope** capability
(ROUTE_MAP.md §5.2) are different things: the first concerns work nobody has committed to,
the second concerns committed work that has not arrived yet.

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

### 5.1 A substantial corpus, stated honestly

**No claim of unlimited scale is made anywhere in this baseline.** The posture is a
*substantial multilingual corpus*, and it is met by discipline rather than by assertion —
the standing data-scale requirements of ARCHITECTURE.md §13.9 apply to every phase: bounded
queries and page sizes, deterministic ordering with tie-breakers, relevant indexes, no
whole-corpus filtering in the client, bounded administrative bulk actions, keyset scans
where appropriate, batched migration and backfill, and bounded memory use.

**Volume behaviour is proven where the volume exists**, against representative mixed-script
data with long text and sparse translation coverage. A foundation phase that has not been
exercised at corpus scale is **not described as having been load-proven**; large-corpus
validation belongs to Phases 31 and 34.

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
7. **The software meets WCAG 2.2 AA** across its delivered surfaces, including the Quran
   reader, long-form readers and media surfaces.
8. **Content conformance is accepted separately from software conformance.** Where an
   authoritative source supplies no caption, transcript, alternative text or accessible
   alternative, the platform presents what genuinely exists and records the gap. It never
   fabricates an alternative, and **no unqualified whole-product conformance claim is made
   while required source alternatives are missing** (SECURITY_BASELINE.md §16.3).
9. The pre-adoption deployment remains **non-indexable and makes no claim of official
   adoption** until the approved launch transition (*Product status and acceptance*).
