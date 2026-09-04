# Delivery Plan — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit
**Document type:** Planning only.

---

## 1. Principles

1. **No arbitrary deadline.** No 20-day target, no fixed end date. Phases complete when their
   exit criteria are met. A religious knowledge platform published on schedule with incorrect
   Quranic text is a failure, not a success.
2. **Small bounded vertical slices.** A slice delivers its own schema, its own domain logic,
   its own routes and its own tests — end to end.
3. **Domain schema arrives with its owning slice.** No phase pre-creates tables for owners
   that do not yet exist.
4. **Unrelated domains are never combined.**
5. **Security controls are exit criteria of EVERY feature phase.** The later hardening phase
   is final assurance — **not the first time security is implemented**.
6. **Each phase has entry criteria, bounded deliverables, required tests and exit criteria.**
7. **Nothing is scaffolded before the domain it serves exists.**
8. **Commits only when explicitly requested after review** (§5).

---

## 2. Phase map

| # | Phase | Depends on |
|---|---|---|
| 0A | Architecture Freeze | — |
| 0B | Repository & Tooling Foundation | 0A |
| 1 | Database Foundation *(local Developer edition)* | 0B |
| 2 | Identity & Access: base authentication | 1 |
| 2G | Google OAuth *(separately gated)* | 2 |
| 3 | Taxonomy & Localisation Foundation | 1 |
| 4 | Public Shell & Organisational Content | 3 |
| 5 | People & Contributors | 2, 3 |
| 6 | Editorial Core: articles, pages, workflow | 4, 5 |
| 7 | Storage Foundation | 1 |
| 8 | Library: works, editions, translations | 5, 6, 7 |
| 9 | Research & Publications | 8 |
| 10 | Media: Video | 5, 6 |
| 11 | Media: Audio | 10 |
| 12 | Media: Galleries | 7, 10 |
| 13 | News | 6 |
| 14 | Events | 6, 13 |
| 15 | Collections | 6, 8, 10, 13 |
| 16 | Global Network | 6 |
| 17 | Search Foundation | 6, 8 |
| 18 | Quran | 3, 5, 7 |
| 19 | Hadith | 3, 5 |
| 20 | Fatwa | 2, 5 |
| 21 | Personalisation & Notifications | 2, 18, 19 |
| 22 | Learning: courses & paths | 5, 6 |
| 23 | Teacher Experience & Live Classes | 22, **safeguarding decision** *(manual Meet flow — no Google API credential required)* |
| 24 | Messaging: domain & shared server services | 2, 22, 23, **safeguarding decision** |
| 25 | Messaging: realtime runtime | 24 |
| 26 | Membership | 2, 5, 16 |
| 27 | Donations *(separate; may be deferred)* | 2 |
| 28 | Staging Foundation | 1, 7 |
| 29 | Migration & Provenance Framework *(fixtures only)* | 1, 3, 28 |
| 30 | Source Adapters & Initial Migration | 29, all target domains, **written source authorisation** |
| 31 | Search Completeness Validation | 17, all searchable domains |
| 32 | SEO & Accessibility Acceptance | all public domains |
| 33 | Security Hardening & Final Assurance | all |
| 34 | Performance & Operations | 32, 33 |
| 35 | Launch: Delta Migration & Cutover | 30, 31, 32, 33, 34 |

Phases 8–16 are largely parallelisable. 18 and 19 are independent of each other. **27 never
blocks 26.**

---

## 3. Standing requirements — every phase

Exit criteria for **all** feature phases, not a later sweep:

| Requirement | Standard |
|---|---|
| **Permission enforcement** | Server-side, with **negative tests proving denial** |
| **Capability semantics** | Projections never bypass permission checks; **a profile alone grants nothing** |
| **Input validation** | Zod at every trust boundary; server-side authoritative |
| **CSRF** | Origin/Host validation; **no state-changing GET** |
| **Cache boundary** | **Cache-leakage tests**: no session-derived data in shared cache entries |
| **Public access** | Public routes render fully with **no session** |
| **Referential integrity** | Typed relationships; **no polymorphic `targetType + targetId`** |
| **Localisation** | Works in en/ur/ar; **RTL verified** |
| **Accessibility** | **WCAG 2.2 AA** for delivered surfaces |
| **Audit** | Domain audit records where required |
| **Logging** | Structured; no secrets, tokens or personal content |
| **Context boundaries** | Dependency rules respected; **violations fail the build; no ESLint exceptions** |
| **Search projection** | Every searchable domain adds its projection, filters and tests (from Phase 17 onward) |
| **SEO** | Canonical, `hreflang` and structured data correct for delivered routes |
| **Testing** | Unit, integration, and E2E for critical paths |
| **No AI attribution** | No agent branding, co-author trailers or generated-by notices anywhere |

---

## 4. Phase definitions

### Phase 0A — Architecture Freeze
**Entry:** Project initiated.
**Deliverables:** Ten `/docs` documents; independent audit; adjudicated correction pass.
**Tests:** Documentation review; internal consistency; contradictions resolved.
**Exit:** Documents reviewed and accepted. No code, no dependencies, no Git, no commit.

---

### Phase 0B — Repository & Tooling Foundation
**Entry:** 0A accepted.

**Deliverables**
- npm workspace monorepo (ARCHITECTURE.md §5)
- `apps/web` — Next.js 16.3.3, App Router, TypeScript strict
- `packages/config`, `packages/contracts`, **`packages/server-core`** (structure only — a
  server-only host for context-owned services; it owns no rules)
- **ESLint bounded-context rules transcribed from DOMAIN_MODEL.md §3.1**
- Tailwind 4 with RTL-safe conventions; physical-direction utilities lint-blocked
- Vitest configured; Docker Compose for local development
- CI: type check → lint → **boundary rules** → test → build
- `.env.example`; Zod environment validation
- **Compatibility verification of the locked stack** (TECH_STACK.md §16.3)

**NOT in this phase:** `apps/realtime` · Socket.IO · Motion · React Hook Form · Tiptap ·
Playwright browsers · any domain schema.

**Tests:** App starts; CI passes; **a deliberate boundary violation fails the build**;
**a deliberate same-level import outside the allowlist fails the build**; **importing
`packages/server-core` into a client bundle fails the build**; **boundary rules require no
exceptions**; strict mode clean.
**Exit:** CI green. Boundary enforcement demonstrated. Locked stack verified to install and
build together, or a discrepancy reported for architecture decision.

---

### Phase 1 — Database Foundation
**Entry:** 0B complete. **A local SQL Server 2022 Developer edition instance.**

> **This phase is NOT blocked by unprovisioned staging or production infrastructure.** Local
> development SQL is engineering-controlled; staging and production instances, DBA ownership,
> licensing, network access and HA/DR are separate external decisions gating Phases 28 and 34
> (OPEN_DECISIONS.md §4.1).

**Deliverables:** `packages/database` with Prisma 7.10.0 + `@prisma/adapter-mssql` 7.10.0 ·
migration workflow and conventions · **audit log table with restricted mutation permissions**
· least-privilege application account (no UPDATE/DELETE on audit) · seed mechanics · backup
and **tested restore** procedure.

**Explicitly NOT:** business schema for later owners. **Domain tables arrive with their
owning slice.**

**Tests:** Migrations apply and roll back on a clean database; **the application account
cannot UPDATE or DELETE audit rows**; a restore is performed successfully.
**Exit:** Database tooling proven. Restore proven. No premature business schema.

---

### Phase 2 — Identity & Access: base authentication
**Entry:** Phase 1 complete. **Email provider available** (OPEN_DECISIONS.md §5.1).
**Google OAuth application credentials are NOT required for this phase** — within the current
V1 delivery plan they are required for Google sign-in (Phase 2G).

**Deliverables:** Identity & Access context with internal sub-layering (ARCHITECTURE.md §6.2)
· User, Account, Session, Verification · **email/password** with verification and reset ·
session management with revocation · **Permission, Role, RoleAssignment — the single
enforcement path** · **capability projections as derived read-only views** · `can()` helpers
for Server Actions and Route Handlers · **step-up reauthentication mechanism** · sign-in,
sign-up, reset, onboarding routes · **sign-out as a POST action** · CSRF protections · rate
limiting via the **RateLimiter abstraction** · authentication and permission audit logging.

**Tests:** Sign-in, verification, reset · session expiry, rotation, revocation ·
**negative permission tests prove denial** · **horizontal privilege escalation fails** ·
**capability projections cannot bypass permission checks** · open redirect attempts rejected ·
**no state-changing GET exists** · CSRF protection verified · rate limiting effective · no
user enumeration.
**Exit:** Base authentication and the single authorisation path working, with security tests
passing. **Google is not required for this phase.**

---

### Phase 2G — Google OAuth
**Entry:** Phase 2 complete. **Google OAuth application credentials available**
(OPEN_DECISIONS.md §5.2).
**Deliverables:** Google provider; account linking.
**Tests:** **Google sign-in never creates a Minhaj email address** · **linking requires
verified email ownership** · OAuth state/CSRF protection · linking abuse attempts fail.
**Exit:** Google sign-in working. Separately gated so an unresolved credential never blocks
Phase 2 — **nor Phase 23, whose manual Meet flow requires no Google API credential**. A future
explicitly approved Google API integration would carry its own credential requirements.

---

### Phase 3 — Taxonomy & Localisation Foundation
**Entry:** Phase 1 complete.

**Deliverables:** Topic aggregate — hierarchical, locale-aware, stable slugs · **typed topic
assignment strategy with database-enforced integrity** (DOMAIN_MODEL.md §6.2) · Language
reference data, **distinct from interface locale** · Tag · next-intl with `/{locale}` routing
and resolution · **RTL foundation** with logical properties · route-preserving locale
switching · canonical topic seed data · admin taxonomy management.

**Tests:** Hierarchy and locale fallback · **deleting a target cannot orphan a topic
assignment** · **RTL verified for Urdu and Arabic** · mixed-direction content renders
correctly · locale switch preserves route · **a physical-direction utility in layout code
fails lint**.
**Exit:** Taxonomy usable by every later context with **enforceable integrity**. RTL proven.

---

### Phase 4 — Public Shell & Organisational Content
**Entry:** Phase 3 complete.

**Deliverables:** Root layout · header with utility and primary navigation · mega-menu
framework · footer · Page aggregate for organisational content · Explore routes · home shell ·
404 and error pages · **anonymous cached public tree with the session boundary enforced** ·
security headers and base CSP · **`hreflang`, canonical and `x-default` emission** ·
sitemap index skeleton · `robots.txt`.

**Tests:** Navigation in three locales · **full keyboard navigation and visible focus** ·
screen reader landmarks · **WCAG 2.2 AA for delivered surfaces** · **pages render with no
session** · **cache-leakage test: no session state in the public tree** · security headers
verified · canonical and `hreflang` correct.
**Exit:** Public shell navigable, accessible and correctly cached in three locales, signed out.

---

### Phase 5 — People & Contributors
**Entry:** Phases 2 and 3 complete.
**Delivered before any content domain that references contributors.**

**Deliverables:** Person aggregate with optional User link · **AuthorProfile, SpeakerProfile,
ScholarProfile, TeacherProfile as distinct aggregates** · contribution roles · **canonical
`/people/{slug}` profile route** · directories · admin management · **capability projections
derived from RoleAssignments**.

**Tests:** **Person, User and the four profiles remain six distinct models** · a Person holds
multiple profiles · **a historical Author with no User is supported** · **no profile grants any
privilege** · capability projections reflect only actual grants · **grants are audited** ·
**self-elevation is impossible** · `/authors/{slug}` and `/library/authors/{slug}` **301 to
`/people/{slug}`**.
**Exit:** One contributor identity model. **Author is delivered exactly once, before its
consumers.**

---

### Phase 6 — Editorial Core
**Entry:** Phases 4 and 5 complete.

**Deliverables:** Article and Page aggregates · **shared editorial workflow enforced
server-side** · revision history · **separation of duties** — author cannot approve own work
by default · Tiptap for editorial content only · **server-side HTML sanitisation** · admin
editorial routes and queue · typed topic assignment · public article routes · audit logging.

**Tests:** Lifecycle transitions enforced server-side · **workflow bypass attempts fail** ·
**XSS payloads sanitised** · negative permission cases · author self-approval blocked ·
`Article` and `BreadcrumbList` structured data valid.
**Exit:** Content publishable only through the reviewed workflow.

---

### Phase 7 — Storage Foundation
**Entry:** Phase 1 complete. **Separate from Library.**

**Deliverables:** **StorageService abstraction** with filesystem adapter · Asset model with
checksums · **upload validation: type, size, content sniffing** · **quarantine before
publication** · **malware scanning integration point** (provider selected here, not in 0A) ·
server-generated storage keys · authorisation-checking serving routes.

**Tests:** Disallowed types rejected · **content sniffing catches a mislabelled file** ·
**quarantined files are unreachable until cleared** · **path traversal via filename fails** ·
**large files are not database BLOBs** · unauthorised asset access fails.
**Exit:** Storage usable by every later domain, with quarantine and scanning proven.

---

### Phase 8 — Library: works, editions, translations
**Entry:** Phases 5, 6, 7 complete.

**Deliverables:** **Work, Edition, BookTranslation** (DOMAIN_MODEL.md §10.1) · contributors via
People & Contributors · SalePoint · public library routes · admin management.

**Tests:** **A Work with multiple Editions in multiple languages is modelled correctly** ·
**localized metadata is distinguishable from a genuine translated Edition** · contributors
resolve to `/people/{slug}` · `Book` structured data only where genuine ISBN and author exist.
**Exit:** Library modelled without conflating localisation and translation.

---

### Phase 9 — Research & Publications
**Entry:** Phase 8 complete.
**Deliverables:** Research, ResearchPaper, Publication, Magazine, MagazineIssue, Encyclopedia ·
public routes · admin management.
**Tests:** Issue hierarchy navigation · contributor references · standing requirements.
**Exit:** Scholarly and periodical content complete.

---

### Phases 10–12 — Media, split into three slices

| Phase | Slice | Deliverables | Key tests |
|---|---|---|---|
| **10** | **Video** | Video with provider metadata, Series, Playlist, speaker references, embed components, **CSP provider allowlist**, public watch routes | Embeds render; **no video files hosted**; `VideoObject` structured data valid; a video belongs to one Series but many Playlists |
| **11** | **Audio** | AudioTrack, AudioSeries — **non-Quran audio only**, `/listen` routes | **No AudioTrack can duplicate a Quran Recitation** (DOMAIN_MODEL.md §8.1) |
| **12** | **Galleries** | Photo, Gallery, GalleryItem, event and archive galleries | Asset handling via Phase 7; accessibility of image content |

---

### Phases 13–15 — News, Events, Collections, split for verification

| Phase | Deliverables | Key tests |
|---|---|---|
| **13 News** | NewsArticle, PressRelease, Statement, MediaCoverage; archive; public routes | `NewsArticle` structured data; `?sort=latest` is a query, **not a path** |
| **14 Events** | Event, EventSchedule; centre references; gallery links | `Event` structured data with genuine date and location |
| **15 Collections** | Collection with **typed item membership**; curated mixed-type sets | **Deleting a Collection deletes no content**; **no polymorphic references**; item integrity enforced |

---

### Phase 16 — Global Network
**Entry:** Phase 6 complete.
**Deliverables:** Country, Region, City, Centre, CentreContact with **flexible/nullable
parentage** · Centre addresses and coordinates · Find a Centre · centre-scoped news and events.
**Tests:** **A country with no regions is supported** · **a virtual centre with no city is
supported** · a centre serving multiple areas is representable · centre news uses the News
model with a reference, **not a parallel system**.
**Exit:** Global network modelled without a rigid chain.

---

### Phase 17 — Search Foundation
**Entry:** Phases 6 and 8 complete.

**Deliverables:** **`SearchService` abstraction** · **SQL Server FTS proof** · indexing on
publication · **initial indexed domains: editorial and library** · filters by type, topic,
language, date · search UI · rate limiting · `noindex` on search routes.

**Tests:** Results across the **initial** domains · **Arabic and Urdu tokenisation validated
with real content** · filters combine · **unpublished content never appears** · injection
attempts fail · expensive-query protection.
**Exit:** Search infrastructure proven on initial domains. **Tokenisation quality assessed and
recorded** — an engineering acceptance criterion; if inadequate, the abstraction permits
reconsideration without rework.

> **This phase does not claim product-wide search completeness.** Every later searchable
> domain adds its own projection, filters and tests (§3). Completeness is validated in
> Phase 31.

---

### Phase 18 — Quran
**Entry:** Phases 3, 5, 7 complete. **Authoritative Quran text source available**
(OPEN_DECISIONS.md).

**Deliverables:** Surah, Ayah, Juz · Translation, Transliteration, Tafsir as **separate layered
works** · **Recitation and RecitationSegment — owned by Quran** · TajweedRule · reader with
preference selection · indexes and Quran search · **canonical citation URLs** · related
material via topics · **admin surfaces with `quran.editCanonical` and step-up
reauthentication** · full audit logging · search projection.

**Tests:** **Arabic text verified character-by-character against the authoritative source** ·
multiple translations coexist with **none privileged** · **Arabic renders correctly in all
three locales** · citation URLs stable, preferences as query parameters · **canonical edit
requires the permission AND step-up, and writes an audit record** · **no automated publication
path exists** · **no Media AudioTrack duplicates a Recitation** · **Quran reader accessibility
criteria met** (SECURITY_BASELINE.md §16.2).
**Exit:** Quran readable in three locales with **verified** text integrity. Never assumed
correct.

---

### Phase 19 — Hadith
**Entry:** Phases 3 and 5 complete. **Authoritative Hadith sources and grading authority
confirmed** (OPEN_DECISIONS.md).

**Deliverables:** Collection → Book → Chapter → Hadith · translations and commentary as
separate records · **gradings and chains as sourced data** · sciences content · browse, search,
topic views · **canonical citation URLs** · admin with `hadith.editCanonical` and step-up ·
audit logging · search projection.

**Tests:** Hierarchy navigation · **gradings and chains stored exactly as sourced, never
inferred or generated** · source reference numbers preserved · translations separate ·
**elevated permission plus step-up required** · **Hadith is not merged with Quran anywhere**.
**Exit:** Hadith browsable and searchable with sourced, audited data.

---

### Phase 20 — Fatwa
**Entry:** Phases 2 and 5 complete. **Authorised Fatwa scholars identified and `fatwa.publish`
grants approved by Minhaj** (OPEN_DECISIONS.md).

**Deliverables:** FatwaCategory · Question with **private personal data handling** · Fatwa ·
full lifecycle through **scholar review** · authenticated ask and my-questions · public browse,
search and detail with **query-based sort views** · immutable rulings with visible revision
history · audit logging · search projection.

**Tests:** **Only `fatwa.publish` holders can publish, with step-up** · **every bypass path
fails: direct API, admin route, import path, bulk operation** · **questions are private** —
another user cannot read them, and they never appear in listings, search, logs or caches ·
publication anonymises the question · rulings immutable in substance · **no AI path can create
or publish a Fatwa** · **`/fatwa/latest` and `/fatwa/popular` do not exist as paths**.
**Exit:** **Fatwa publication provably restricted to authorised scholars.** The
highest-consequence exit criterion in this plan; **signed off by Minhaj**.

---

### Phase 21 — Personalisation & Notifications
**Entry:** Phases 2, 18, 19 complete.

**Deliverables:** The **Personalisation & Notifications context** (DOMAIN_MODEL.md §14) —
Bookmark, Note, SavedItem, PrivateCollection, ReadingHistory, WatchHistory, ReadingProgress,
NotificationPreference, Notification · **typed references to content** · My Minhaj routes ·
conditional onboarding · settings with data export and account deletion.

**Tests:** **All queries scoped to the requesting user** · **horizontal privilege escalation
fails** · **deleting an account deletes personalisation records** · **archiving referenced
content leaves the typed reference valid and renders as unavailable/archived** · **a hard
purge transactionally resolves personalisation records first and leaves no broken foreign
key** · **public pages still render fully signed out** ·
**cache-leakage: no personalisation in the public tree** · export and deletion work.
**Exit:** Personalisation working with **defined ownership, privacy and deletion rules** and no
reduction in public access.

---

### Phase 22 — Learning: courses & paths
**Entry:** Phases 5 and 6 complete.
**Deliverables:** Course, CourseModule, Lesson, LearningPath, Enrolment, Progress · public
catalogue · My Learning · admin management · TrialClassRequest and Booking · search projection.
**Tests:** Catalogue browsable **without an account** · enrolment requires authentication ·
progress scoped per user · **Enrolment and Booking remain distinct**.
**Exit:** Courses browsable publicly; enrolment and progress working.

---

### Phase 23 — Teacher Experience & Live Classes
**Entry:** Phase 22 complete. **⚠ Under-18 safeguarding decision received**
(OPEN_DECISIONS.md §2.1). **The organisation and its teachers can legitimately create and use
Google Meet meetings** (§5.3).

> **Google OAuth / Calendar / Meet API credentials are NOT a prerequisite for this phase.**
> Within the current V1 delivery plan, Google OAuth application credentials are required for
> Google sign-in (Phase 2G) and are not required for the manual Google Meet URL flow.
> V1 stores a manually entered Meet URL: a teacher or administrator creates the meeting in
> Google themselves and pastes the link. The application validates and stores a string — it
> never calls a Google API. Automatic Calendar/Meet provisioning remains deferred; **any
> future explicitly approved Google API integration will have its own credential
> requirements.**

**Deliverables:** Teacher area routes gated by a **current `teaching.perform` assignment** ·
students, courses, calendar, resources · Availability · Attendance · **ClassSession storing
`meetingProvider` and `meetingUrl`, entered manually** · **provider/URL consistency validation
and HTTPS `meet.google.com` allowlist** · `MeetingProvider` abstraction.

**Tests:** **A teacher can access only their currently assigned students** · **a revoked
assignment immediately removes access** · attendance permission-enforced · **meeting URLs are
exposed only to authorised participants** · **meeting URLs never appear in public caches or
logs** · a non-Meet or non-HTTPS URL is rejected for the Google Meet provider · **a
TeacherProfile without a RoleAssignment grants nothing**.
**Exit:** Teachers run classes with manually entered, validated Meet links. **No recording. No
automated provisioning.**

---

### Phase 24 — Messaging: domain & shared server services
**Entry:** Phases 2, 22, 23 complete. **⚠ Safeguarding decision received.**

**Deliverables:** Messaging context — Conversation, Participant, Message, ReadState,
Attachment, **Block, Report**, moderation · **Messaging-owned application services hosted in
`packages/server-core`** so one implementation serves both processes — **Messaging remains the
semantic owner** (ARCHITECTURE.md §3.1) · **current-relationship authorisation** · attachment handling via
Phase 7 · **non-realtime messaging fully working through the web application** · attachment
retention policy · moderation evidence access controls.

**Tests:** **Authorisation validates the current relationship, not historical membership** —
negative tests for **unrelated teacher, former teacher, revoked assignment, blocked user,
unauthorised student, removed class/course membership** · **messages persist before any
broadcast** · blocking prevents initiation and continuation · moderation evidence access
restricted and audited · **student↔student disabled by default**.
**Exit:** Messaging works **without any realtime process**, with relationship authorisation
proven.

---

### Phase 25 — Messaging: realtime runtime
**Entry:** Phase 24 complete. **The shared server boundary is proven.**

**Deliverables:** **`apps/realtime` created now — not in Phase 0B** · Socket.IO 4.8.3 ·
handshake authentication and per-event authorisation **via the Messaging and Identity
services hosted in `packages/server-core`** ·
presence and **ephemeral typing indicators** · NGINX WebSocket proxying · per-connection rate
limiting and payload caps.

**Tests:** **`apps/realtime` cannot import `packages/database` — the build fails if it tries**
· **no authorisation rule is reimplemented in the realtime process** · **history survives a
realtime restart** · **messaging degrades gracefully with the service down; nothing is lost** ·
handshake authentication enforced · **cross-conversation access fails** · **typing state is
never persisted** · socket input Zod-validated.
**Exit:** Realtime delivery working as a **transport adapter that owns no business rules**.

---

### Phase 26 — Membership
**Entry:** Phases 2, 5, 16 complete. **Not blocked by any payment provider.**
**Deliverables:** MembershipType, Membership, MembershipApplication · public membership routes
· admin management.
**Tests:** Application lifecycle · permission enforcement · **the phase completes with no
payment provider selected**.
**Exit:** Membership functional and **independent of Donations**.

---

### Phase 27 — Donations
**Entry:** Phase 2 complete. **Payment provider decided** (OPEN_DECISIONS.md). **May be
deferred indefinitely without blocking anything.**
**Deliverables:** DonationCampaign, Donation behind the `PaymentProvider` abstraction · public
donate routes · **webhook handling with signature verification, idempotency and replay
resistance**.
**Tests:** **Signature verification rejects forged webhooks** · **duplicate delivery produces
one effect** · **replayed events rejected** · **amount, currency and status verified
server-side** · **no card or payment credential data stored** · no payment data in logs.
**Exit:** Donations functional with verified webhooks and no sensitive data stored.

---

### Phase 28 — Staging Foundation
**Entry:** Phases 1 and 7 complete. **Staging SQL Server instance, access and infrastructure
available** (OPEN_DECISIONS.md §4.1) — the first phase that genuinely requires
externally-provisioned database infrastructure.

Scheduled **before** any live-source migration — correcting the prior plan, which required
staging in the migration phase while delivering it only in final operations.

**Deliverables:** Production-shaped staging environment · deployment pipeline to staging ·
staging database with restore-tested backups · **entire staging site `noindex` and
`Disallow`** · seed and reset procedures · access controls.
**Tests:** Deploy to staging succeeds · **staging is not publicly indexable** · restore
verified · staging data is isolated from production.
**Exit:** A usable staging environment exists **before** migration needs it.

---

### Phase 29 — Migration & Provenance Framework
**Entry:** Phases 1, 3, 28 complete.

> **Written source authorisation is NOT required for this phase.** All work here uses **local,
> synthetic or previously approved test fixtures**, with **no live legacy-source access of any
> kind**. Authorisation is mandatory before Phase 30 (OPEN_DECISIONS.md §3.1).

**Deliverables:** **Migration & Provenance context** (DOMAIN_MODEL.md §16) — LegacySource,
RawSnapshot, ImportRun, StagedRecord, ImportError, LegacyMapping, **PublishManifest**,
AssetProvenance · the pipeline of MIGRATION_STRATEGY.md §4 · **link extraction and rewriting**
· **reconciliation counting** · **reversible publication** · **safe retry classification and
`Retry-After`** · **SSRF and DNS-rebinding protections** · **sanitisation before staging** ·
**inert raw rendering in admin** · isolated staging · deduplication queue · admin migration
area · `scripts/migration/` adapter tooling structure.

**Tests:** **Interrupted runs resume correctly** · **re-running produces no duplicates** ·
**raw snapshots are immutable and render inertly** · **staged content is not publicly
reachable or indexable** · **imported XSS payloads sanitised before storage** · **SSRF and DNS
rebinding attempts blocked, including post-redirect revalidation** · **ordinary 4xx are not
retried; `Retry-After` respected** · **reconciliation arithmetic balances** · **a publish
manifest can be rolled back** · **link rewriting works and unresolved links are reported** ·
**publication goes through target domain interfaces, not table writes**.
**Exit:** Framework proven **against controlled fixtures — never against a live Minhaj site**.
**No real legacy source has been contacted and no real asset copied.**

---

### Phase 30 — Source Adapters & Initial Migration
**Entry:** Phase 29 complete. All target domains complete. Staging available.

> **⚠ Written authorisation recorded per source is mandatory before this phase begins.** It
> gates **live-source adapters and access, fetching any real legacy Minhaj source, copying any
> real asset, and running live ingestion**. A source without recorded written authorisation is
> **not contacted** (OPEN_DECISIONS.md §3.1).

**Deliverables:** Per-source adapters · migration executed **against staging** in the risk
order of MIGRATION_STRATEGY.md §10.1 · deduplication resolved · URL mapping complete ·
**unresolved-link report reviewed** · **reconciliation balanced** · **domain-specific
editorial and religious QA completed**.

**Tests:** **No religious content published without human approval** · duplicates resolved with
**all legacy URLs preserved** · **counts reconcile** · **no private data ingested** · asset
checksums and **per-asset licensing evidence** verified · 301s resolve correctly.
**Exit:** Content migrated, reviewed, approved and published **in staging**. **Religious content
signed off by Minhaj religious authority.** Completes on review capacity, not a date.

---

### Phase 31 — Search Completeness Validation
**Entry:** Phase 17 plus every searchable domain complete.
**Deliverables:** Final all-domain indexing verification · cross-domain relevance review ·
**Arabic and Urdu quality re-validated against the full migrated corpus**.
**Tests:** **Every searchable domain is represented** · filters work across all types ·
**unpublished, staged and private content never appears** · tokenisation quality acceptable
against real content at full volume.
**Exit:** Product-wide search completeness **demonstrated, not claimed**.

---

### Phase 32 — SEO & Accessibility Acceptance
**Entry:** All public domains complete.
**Deliverables:** Full SEO contract verification (ROUTE_MAP.md §9) · complete accessibility
audit · RTL QA across **every** page in Urdu and Arabic · Arabic and Urdu typography review.
**Tests:** **Canonical correctness across locales** · **reciprocal `hreflang` with correct
`x-default` resolved conditionally, never unconditionally English (ROUTE_MAP.md §9.2.1)** ·
**every `hreflang` target is a genuine canonical language version** · **untranslated content
excluded from alternates** · sitemap partitioning and
**genuine `lastmod`** · **`noindex` on all private and search surfaces** · **structured data
valid with no over-claiming** · **legacy 301s correct with no chains** · **WCAG 2.2 AA across
all surfaces** · **Quran reader, book reader, PDF and media criteria met** · **RTL correct on
every page, not merely those checked during development**.
**Exit:** SEO and accessibility **acceptance-tested before launch**.

---

### Phase 33 — Security Hardening & Final Assurance
**Entry:** All feature phases complete, **each having already passed its own security exit
criteria**.

This phase is **final assurance, not the first application of security**.

**Deliverables:** Full CSP · complete security headers · rate limiting reviewed end-to-end ·
**step-up coverage verified across all privileged operations** · audit coverage verified ·
logging redaction verified · secrets audit · dependency vulnerability scan · **penetration
testing of SECURITY_BASELINE.md §20**.

**Tests:** The complete security suite · **Fatwa publication authorisation re-verified** ·
**religious workflow bypass attempts fail** · **cache-leakage across every personalised
surface** · **no secrets in logs, bundles or source control** · horizontal privilege escalation
fails everywhere.
**Exit:** Security review passed. **No known unmitigated vulnerability.**

---

### Phase 34 — Performance & Operations
**Entry:** Phases 32 and 33 complete. **Production infrastructure available** — production
SQL Server instance and access, DBA ownership, licensing, network access and any HA/DR
expectations (OPEN_DECISIONS.md §4.1).
**Deliverables:** Performance profiling, query and index optimisation · caching strategy ·
asset optimisation · production Docker Compose · NGINX with TLS, headers and WebSocket upgrade
· SQL Server production setup · **backup automation with tested restores** · monitoring,
alerting and log aggregation · deployment runbook · **rollback procedure** · incident response.
**Tests:** Deployment to production-shaped staging · **restore verified** · **rollback
verified** · alerts fire correctly · **a web deployment does not destructively drop realtime
connections** · performance targets met on low-bandwidth mobile.
**Exit:** Deployable, monitored, backed up, with a **proven** rollback.

---

### Phase 35 — Launch: Delta Migration & Cutover
**Entry:** Phases 30, 31, 32, 33, 34 complete. **Organisational go-live approval. DNS and
legacy hosting access arranged.** **Cutover rollback runbook written and rehearsed.**

**Deliverables:** Delta migration **with unchanged review requirements** · final URL mapping
verification · **301 redirects live** · legacy domain cutover per organisational decision ·
unmapped-URL logging · post-launch monitoring.

**Tests:** **Delta religious content reviewed to the same standard as initial content** ·
**legacy URLs 301 to correct canonical destinations with no chains** · unmapped URLs return the
helpful 404 · **search indexes complete** · **the site works fully signed out** ·
**cutover rollback rehearsed against defined triggers**.
**Exit:** Platform live. Legacy URLs preserved. **Religious content verified.** Monitoring
active. **Rollback available.**

---

## 5. Definition of done

A phase is complete only when **all** hold:

1. Deliverables implemented and reviewed
2. All phase tests passing
3. **All standing requirements (§3) satisfied — including security and cache-leakage**
4. CI green — type check, lint, **boundary rules**, tests, build
5. Documentation updated where architecture changed
6. Exit criteria explicitly verified, not assumed
7. Reviewer approval obtained

**Phases 18, 19, 20 and 30 additionally require sign-off from Minhaj religious authority** for
the content they handle. That is not an engineering judgement and cannot be substituted by one.

---

## 6. Review and commit workflow

```
implement / document → inspect git diff → run required validation
   → review results → user / reviewer approval → commit ONLY when explicitly requested
```

- **No commit unless the user explicitly requests it after reviewing the work.**
- **The existing Haseeb Git identity is preserved.** Never changed to an agent identity; no
  Git email invented; **not inferred from the GitHub username**. Expected GitHub account:
  **`haseeb1229`**.
- Commit messages are concise and professional.
- **No AI tool mentioned. No co-author trailers. No agent attribution. No generated-by
  notices. No AI badges.**
- Genuine Dependabot commits are acceptable when actually created by Dependabot.
- Only the reviewed scope of the phase is committed.
- **Never `--no-verify`** unless explicitly authorised after understanding the failure.
- **Never** force-push, rewrite history, amend commits, alter branch protection or change
  GitHub settings unless explicitly requested for a specific reason.
- **Changes are never hidden by committing before review.**

---

## 7. Risks to the plan

| Risk | Mitigation |
|---|---|
| **Religious review capacity is the bottleneck** | Sequenced so review begins early on lower-risk content; reviewer tooling in Phase 29; **no fixed deadline, precisely because this cannot be rushed** |
| Migration reveals unanticipated structures | Raw preservation permits reparsing without refetching; adapters isolated per source |
| **Arabic/Urdu search quality inadequate** | Assessed in Phase 17 and re-validated in Phase 31; the abstraction keeps replacement cheap |
| Scope pressure to recombine phases | Boundaries follow dependency and risk; **vertical slices exist so verification stays possible** |
| **Safeguarding decision arrives late** | Gates only Phases 23–25; **all other work proceeds**; raised early in OPEN_DECISIONS.md |
| **Payment provider unresolved** | Gates only Phase 27; **Membership is independent** |
| Single-instance realtime becomes a constraint | Known, bounded, documented; the RateLimiter and realtime abstractions permit a shared store later |
| External decisions block phases | Tracked in OPEN_DECISIONS.md with the phases each gates |
| **Unprovisioned production SQL stalls foundation work** | **Phase 1 runs on local Developer edition; only Phases 28 and 34 need external instances** |
| **Migration authorisation delays framework work** | **Phase 29 is fixture-only; authorisation gates Phase 30 alone** |
| **Google credential delays block live classes** | **The manual Meet flow needs no application API credential; within the current V1 plan only Google sign-in (Phase 2G) requires them. A future approved Google API integration would carry its own requirements** |
| Opportunistic dependency upgrades destabilise work | Versioning policy: **stop, investigate, report** — never automatic substitution |
