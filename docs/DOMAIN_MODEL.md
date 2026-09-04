# Domain Model — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit
**Document type:** Conceptual modelling only. No schema, no migrations, no code.

This document describes bounded contexts, aggregates and relationships at a conceptual
level. Field lists are indicative of intent, not a schema specification. Physical modelling
belongs to the implementation phase of each owning slice.

---

## 1. Bounded contexts

The model is organised into **16 bounded contexts**. A bounded context is a cohesive area
of the business with its own language, its own invariants and a single owner. It is not a
table, and not every aggregate deserves one.

| # | Bounded context | Owns |
|---|---|---|
| 1 | **Identity & Access** | User accounts, authentication, sessions, roles, permissions, capability projections |
| 2 | **People & Contributors** | Person, and the Author / Speaker / Scholar / Teacher profiles attached to a Person |
| 3 | **Taxonomy** | Canonical Topics, Languages, Tags, and typed topic assignment |
| 4 | **Editorial** | Article, Page, News, PressRelease, Statement, MediaCoverage, Event, Collection, and the shared editorial workflow |
| 5 | **Quran** | Surah, Ayah, Juz, Translation, Transliteration, Tafsir, Tajweed, **Recitation** |
| 6 | **Hadith** | Collection, Book, Chapter, Hadith, Translation, Commentary, Sciences, Narrator |
| 7 | **Library** | Work, Edition, BookTranslation, Research, ResearchPaper, Publication, Magazine, MagazineIssue, Encyclopedia, SalePoint |
| 8 | **Media** | Video, Series, Playlist, AudioTrack (non-Quran), AudioSeries, Photo, Gallery |
| 9 | **Fatwa** | FatwaCategory, Question, Fatwa, and the ruling workflow |
| 10 | **Learning** | Course, Module, Lesson, LearningPath, Enrolment, Progress, ClassSession, Availability, Attendance, TrialClassRequest, Booking |
| 11 | **Personalisation & Notifications** | Bookmarks, notes, saved items, private collections, reading/watch history, progress projections, notification preferences, notifications |
| 12 | **Messaging** | Conversation, Participant, Message, ReadState, Block, Report, moderation |
| 13 | **Global Network** | Country, Region, City, Centre, CentreContact |
| 14 | **Membership** | MembershipType, Membership, MembershipApplication |
| 15 | **Donations** | DonationCampaign, Donation |
| 16 | **Migration & Provenance** | LegacySource, RawSnapshot, ImportRun, StagedRecord, ImportError, LegacyMapping, PublishManifest, authorisation/licensing evidence |

### 1.1 What is deliberately NOT a bounded context

The following are **platform/infrastructure services exposed through abstractions**, not
business domains. They have no domain language of their own and own no business invariants:

`database` · `storage` · `search` · `email` · `logging` · `auditing` · `rate limiting`

They are consumed by bounded contexts through interfaces (ARCHITECTURE.md §4). Treating
them as domains was an error in the prior revision: it invited business logic to accumulate
inside infrastructure and produced entity-sized "domains" with no invariants to protect.

The prospective **Minhaj Guide assistant** is **not** given a context here. Reserving an
empty boundary before the capability is authorised creates an architectural placeholder
with nothing in it. It will be added when it is scheduled.

### 1.2 Aggregates are not contexts

Distinct aggregates remain distinct **inside** a context. Article, News, Event and
Collection are separate aggregates with separate schemas and separate lifecycles — they
simply share the Editorial context's workflow, permissions and language. Grouping them does
not merge them.

---

## 2. Ownership rules

1. **A concept has exactly one owning context.** That context owns its tables, its
   invariants and its write path.
2. **Cross-context access goes through the owning context's public application interface**,
   never through direct queries into another context's tables.
3. **Cross-context references are by identifier**, never by embedded copies of data.
4. **Shared concerns are promoted toward foundation contexts**, not duplicated sideways.
5. **A context may depend only on the contexts allowlisted for it** in §3.1 and §3.2.
6. **Religious canon contexts (Quran, Hadith) never depend on Editorial.** Editorial
   concerns must not reach canonical text.
7. **Infrastructure is consumed through abstractions only.** No context depends on Prisma,
   the filesystem, or a search engine directly.

---

## 3. Dependency model — explicit acyclic allowlist

The dependency model is **an explicit acyclic context allowlist**, not a strictly
"downward-only" rule.

Dependencies **generally** flow toward foundation contexts, and the layering below shows that
general shape. But a small number of **directed same-level dependencies are legitimate**, and
the model lists them rather than pretending otherwise — `Messaging → Learning` being the clear
case (§3.2).

**ARCHITECTURE.md §6 is canonical for dependency direction; this section mirrors it.** The
graph is **acyclic** and enforceable **without ESLint exceptions** — a defect in the prior
revision, where `auth` sat below `users` while being required to depend on it.

```
Layer 4  Application composition
         app routes · layouts · pages · admin surfaces · cross-context orchestration
              │
Layer 3  Feature contexts
         Learning · Personalisation & Notifications · Messaging
         Membership · Donations · Migration & Provenance
              │
Layer 2  Content contexts
         Editorial · Quran · Hadith · Library · Media · Fatwa · Global Network
              │
Layer 1  Foundation contexts
         Identity & Access · People & Contributors · Taxonomy
              │
Layer 0  Platform abstractions and adapters
         database · storage · search · email · logging · auditing · rate limiting
         shared contracts and types
```

### 3.1 Permitted dependency edges — the allowlist

Stated explicitly, so the lint configuration is a transcription rather than an
interpretation. **An edge not listed here does not exist.**

| Context | May depend on |
|---|---|
| Identity & Access | Layer 0 only |
| People & Contributors | Layer 0; Identity & Access *(to link a Person to an optional User)* |
| Taxonomy | Layer 0 only |
| Editorial | Layer 0; Identity & Access; People & Contributors; Taxonomy |
| Quran | Layer 0; Identity & Access; People & Contributors; Taxonomy |
| Hadith | Layer 0; Identity & Access; People & Contributors; Taxonomy |
| Library | Layer 0; Identity & Access; People & Contributors; Taxonomy |
| Media | Layer 0; Identity & Access; People & Contributors; Taxonomy |
| Fatwa | Layer 0; Identity & Access; People & Contributors; Taxonomy |
| Global Network | Layer 0; Identity & Access; Taxonomy |
| Learning | Layer 0; Layer 1; Media; Library; Global Network |
| Personalisation & Notifications | Layer 0; Identity & Access; **references content by typed identifier only** |
| Messaging | Layer 0; Identity & Access; People & Contributors; **Learning** *(same-level edge — see §3.2)* |
| Membership | Layer 0; Identity & Access; People & Contributors; Global Network |
| Donations | Layer 0; Identity & Access |
| Migration & Provenance | Layer 0; Identity & Access; Taxonomy — **and no target content context** |

**Notes on the non-obvious edges:**

- **Quran and Hadith do not appear in any other context's dependency list except through
  Layer 4 composition.** Nothing reaches into canonical religious text.
- **Migration & Provenance depends on no target content context.** It publishes *into*
  target domains through their public interfaces, invoked at Layer 4 (§16.4). This is what
  allows Quran and Hadith to carry provenance without depending on Editorial.
- **Personalisation references content but does not depend on content contexts.** It stores
  typed references and resolves them at Layer 4 (§11.3).
- **Messaging depends on Learning** because relationship authorisation must ask whether an
  enrolment or teaching assignment is *currently* valid (§15.3). This is an explicitly
  allowlisted same-level edge (§3.2), **not** an implicit lateral import.

### 3.2 Permitted same-level dependencies

Only these directed same-level edges exist. Each is **one-directional**; **the reverse is
neither implied nor permitted.**

| Permitted edge | Why it is legitimate | Reverse |
|---|---|---|
| **Messaging → Learning** | Message authorisation must verify a **current** teaching assignment or enrolment (§15.3). That knowledge belongs to Learning, and duplicating it inside Messaging would create two sources of truth for who may speak to whom | **`Learning → Messaging` is prohibited** |

**Rules:**
- **No implicit lateral imports.** A same-level dependency exists only if listed here, and
  only in the listed direction.
- **Acyclicity is preserved** by directedness: because `Learning → Messaging` is prohibited,
  the pair cannot form a cycle.
- **Adding an edge is an architecture decision** requiring review — never a convenience taken
  during feature work.
- The architecture is **not reorganised merely to make layer numbering look uniform**.

### 3.3 Cross-context composition

Pages that span contexts — the topic hub, search results, a scholar profile showing works
from four contexts, the personalised home — are composed at **Layer 4**, which may call
many contexts. Composition is an application-layer responsibility and never a licence for a
Layer 2 context to import another.

---

## 4. Identity & Access

Merged from the prior separate `auth`, `users` and `permissions` modules, whose split
produced the cyclic dependency the audit identified.

### 4.1 Internal structure

Within the context, sub-layering keeps framework adapters below domain contracts:

```
  Authentication orchestration      sign-in, linking, verification, reset flows
            │  (depends on ↓ through interfaces)
  User & Account domain             User, Account, Session, Verification
  Permission domain                 Permission, Role, RoleAssignment, Capability projection
            │
  Framework / provider adapters     Better Auth adapter, OAuth provider adapter,
                                    session store adapter
```

Authentication orchestration **may** depend on the user/account and permission domains
through their public interfaces. Adapters sit **below** the domain-facing contracts and are
depended upon, never depending upward. The graph is acyclic.

### 4.2 User

The authoritative internal record for an application identity. Indicative concerns:
internal identifier, email, display name, locale preference, timezone, status, onboarding
state, timestamps.

**Rules:**
- A User exists independently of any authentication method.
- **Google sign-in never creates a Minhaj email address.** Google is an identity provider.
- **A User account is authentication/application identity. It is NOT automatically a public
  Person profile** (§5.2).
- One person, one User record, regardless of how many sign-in methods.

### 4.3 Account, Session, Verification

Authentication mechanics. An **Account** is one authentication method bound to a User;
a User may have several. Session and Verification handle sessions and
verification/reset flows.

### 4.4 Permissions — the single enforcement path

**Granular permissions are the sole source of truth for authorisation.** There is exactly
one enforcement path, and no competing boolean system.

- **Permission** — a granular capability: `content.review`, `fatwa.publish`,
  `quran.editCanonical`, `teaching.perform`.
- **Role** — a named bundle of permissions.
- **RoleAssignment** — binds a User to a Role, optionally scoped (for example to one Centre
  or one Course), with grant metadata and an audit trail.

Indicative permissions: `teaching.perform` · `question.receive` · `content.review` ·
`content.publish` · `fatwa.answer` · `fatwa.publish` · `quran.editCanonical` ·
`hadith.editCanonical` · `migration.publish` · `permissions.grant`.

Exact naming may evolve; **the source-of-truth principle may not.**

### 4.5 Capability projections

Labels such as `canTeach`, `canReceiveQuestions`, `canReviewContent` and `canIssueFatwa`
are **named projections derived from explicit permission grants or approved role
assignments**. They are read-only conveniences for presentation and query.

> **They are never independently stored booleans, and never an enforcement path.**

| Projection | Derived from |
|---|---|
| `canTeach` | `teaching.perform` |
| `canReceiveQuestions` | `question.receive` |
| `canReviewContent` | `content.review` |
| `canIssueFatwa` | `fatwa.publish` |

**A profile alone grants nothing.** Creating a Teacher profile confers no teaching
privilege; **teacher approval must create an auditable RoleAssignment**. This corrects the
prior revision, where a profile flag and a permission were two gates that could disagree.

---

## 5. People & Contributors

A shared boundary connecting distinct contributor roles **without conflating them**.
Introduced because the prior revision let `books` own Author, leaving Speaker unowned and
authorship duplicated across contexts.

### 5.1 Person

The human being. Indicative concerns: canonical name and name variants per locale, life
dates where public and known, biography per locale, an **optional** link to a User account.

A Person is a public-facing record. It exists for historical figures with no account, and
for contributors who have never signed in.

### 5.2 Profiles

A **Person may hold several legitimate profiles simultaneously.** Each is a separate
aggregate with its own fields and its own lifecycle:

| Profile | Represents | Notes |
|---|---|---|
| **AuthorProfile** | A writer of works | May be historical; **no longer owned by Library** |
| **SpeakerProfile** | A speaker in video or audio | **Explicitly owned here** — previously unowned |
| **ScholarProfile** | A public scholarly profile | Qualifications, expertise, languages |
| **TeacherProfile** | An approved teacher | Teaching subjects, languages, public biography |

**Rules:**
- **Person, AuthorProfile, SpeakerProfile, ScholarProfile, TeacherProfile and User are six
  distinct models and are never merged.**
- A Person may be author, speaker, scholar and teacher at once — four profiles, one Person.
- A Person need not have a User; a User need not have a Person.
- **No profile grants any privilege.** Privilege comes only from a RoleAssignment (§4.5).
- Editorial, Quran, Hadith, Library, Media and Learning reference contributors **through
  this boundary**, by Person or profile identifier.

### 5.3 Contribution roles

Where a work has contributors in differing capacities — author, translator, editor,
compiler, narrator, reciter, speaker — the relationship carries the **role of the
contribution**. The contributor is referenced from People & Contributors; the relationship
row belongs to the owning content context.

---

## 6. Taxonomy

### 6.1 Topic

The canonical, hierarchical, locale-aware subject taxonomy: stable identifier, slug, parent,
ordering, status, and per-locale name and description.

Canonical top-level topics: Quran · Hadith · Seerah · Faith (Aqeedah) · Fiqh · Worship ·
Spirituality · Ahl al-Bayt · Sahabah · Islamic History · Ethics · Family & Society ·
Education · Peace · Interfaith · Human Rights · Economics & Finance · Islam & Science ·
Contemporary Issues.

### 6.2 Typed topic assignment — referential integrity is mandatory

> **Generic `targetType + targetId` polymorphic references are prohibited.**

SQL Server cannot enforce a foreign key from a polymorphic pair to many target tables. Such
a design guarantees dangling references whenever a target is deleted, and no amount of
application validation closes that gap.

Instead, topic assignment uses **typed junction relationships**, conceptually:

```
ArticleTopic · NewsTopic · EventTopic
QuranTopic   · HadithTopic
WorkTopic    · ResearchTopic · PublicationTopic
VideoTopic   · AudioTopic
FatwaTopic   · CourseTopic   · CollectionTopic
```

Each has real foreign keys to the Topic and to its single target type, with cascade
behaviour defined by the owning context.

**Phase 0A requirement:** *referential integrity must be enforceable by the database.* The
precise physical schema — junction tables per type, or an integrity-preserving registry
whose lifecycle is transactionally bound to the owning aggregate — is implementation-phase
work. **Designing intentional dangling references is not an option.**

### 6.3 Language

The set of content languages. **Distinct from interface locale**: the UI may be English
while the content is Urdu. Conflating them is a common and damaging modelling error.

### 6.4 Tag

Free-form editorial labels. **Tags are not Topics** — no hierarchy, no curation, no
cross-context guarantees. Never a substitute for the canonical taxonomy.

---

## 7. Editorial

Owns general editorial content and the shared editorial workflow. Distinct aggregates are
preserved; they share language and workflow, not schema.

### 7.1 Aggregates

**Article** · **Page** (organisational/static content) · **NewsArticle** · **PressRelease**
· **Statement** · **MediaCoverage** · **Event** · **EventSchedule** · **Collection**.

These remain separate aggregates because their metadata genuinely differs — media coverage
references an external outlet; a statement carries an issuing authority; an event has time
and place.

### 7.2 Shared editorial workflow

Publication status (draft → in review → scheduled → published → archived), contributor
references, slugs, SEO metadata, derived flags (`isFeatured`, `isPopular`), and revision
history.

**Legacy provenance is NOT here.** It moved to Migration & Provenance (§16) — this was the
prior revision's third architecture-breaking defect, because Quran and Hadith needed
provenance while being forbidden from depending on Editorial.

### 7.3 Collection — typed membership

A curated, ordered, described set that may contain items of **mixed type**: historical
tours, letters, campaigns, conferences, the terrorism-Fatwa material, Al-Hidayah material.

**CollectionItem membership uses typed relationships, not `targetType + targetId`**, for
exactly the reason given in §6.2.

**Rules:**
- A Collection **never owns content**; it references existing records. Deleting a Collection
  never deletes the material it curated.
- Editorial Collections are **distinct from a user's private saved collections** (§11).

### 7.4 Derived views are not entities

`Featured`, `Popular` and `Latest` are **flags and queries**, never separate aggregates,
tables or workflows. A featured book is a Work with `isFeatured = true`.

---

## 8. Quran

Independent first-class context with the platform's strictest integrity requirements.

| Aggregate | Description |
|---|---|
| Surah | The 114 chapters: number, names per locale, revelation type, ayah count |
| Ayah | A verse: surah, number, Arabic text, juz, hizb, page, sajdah marker |
| Juz | The 30 parts and their ayah ranges |
| Translation / TranslationText | A named translation work; its rendering per ayah |
| Transliteration | A scheme and its per-ayah text |
| Tafsir / TafsirText | A named exegetical work; content per ayah or range |
| **Recitation / RecitationSegment** | **A reciter's recitation work and its verse/surah mapping** |
| TajweedRule | Tajweed guidance |

### 8.1 Recitation ownership — competing ownership removed

The prior revision let Quran own `Recitation` while Media's `AudioTrack` also covered Quran
recitation. The same recitation could therefore acquire two independently authorable
records. Corrected:

| Concern | Owner |
|---|---|
| **The logical Recitation work** — reciter, style, Quran-specific metadata, and its mapping to Surah / Ayah / range | **Quran** |
| The binary audio file and provider reference | **Storage abstraction** |
| Playback and catalogue **projections** for browsing | **Media** — read-only projections |

> **There must be no separately authorable AudioTrack duplicating a Quran Recitation.**
> Media may present recitations in a catalogue; it may not author them.

General non-Quran audio (lectures, talks) remains owned by Media.

### 8.2 Rules

- **Quranic Arabic text is immutable in normal operation.** Change requires
  `quran.editCanonical`, a documented authoritative source, step-up reauthentication, and a
  full audit entry.
- Translation, transliteration, tafsir and recitation are **separate works layered over**
  the Ayah — never fields on it. Multiple translations coexist; none is privileged.
- Every Ayah has a stable canonical reference (surah:ayah) that never changes.
- **Quran is never merged into Library.** Books *about* the Quran are Works; the Quran is not.

---

## 9. Hadith

Independent first-class context, structurally parallel to Quran but **never merged with
it**. Different structures, different scholarship, different integrity rules.

| Aggregate | Description |
|---|---|
| HadithCollection → HadithBook → HadithChapter → Hadith | The structural hierarchy, preserved exactly |
| HadithTranslation | A translation into a language |
| HadithCommentary | Scholarly commentary |
| HadithScience | Editorial content on the sciences of Hadith |
| Narrator | A person in a chain of transmission *(later phase)* |

**Rules:**
- **Grading and narrator chains are sourced data — never inferred, never generated, never
  assigned by the platform.** Entered from authoritative sources by authorised personnel.
- Original Arabic and translations are separate records.
- Source reference numbering is retained for citation.
- Edits require `hadith.editCanonical`, step-up reauthentication and an audit entry.
- **Conflicting variants between sources are escalated, never silently resolved.**

---

## 10. Library

Owns published works. Corrects the prior revision's conflation of *localized metadata* with
*genuine translation*.

### 10.1 Work / Edition / Translation

| Concept | Meaning |
|---|---|
| **Work** | The intellectual creation — "Islam and Peace" as a work, independent of any printing or language |
| **Edition** | A concrete published manifestation of a Work: language, publisher, year, ISBN, page count, cover, downloadable file |
| **BookTranslation** | An Edition that is a **translation of a Work into another language**, recording translator contributors and the source Edition where known |
| **Localized descriptive metadata** | The title/description of a Work or Edition rendered in the UI's locale |

> **A translated book is not a translated UI label.**
>
> English descriptive metadata for an Arabic Work is **not** an English translation of that
> Work. The first is presentation; the second is a distinct Edition with its own translator,
> its own text and its own scholarly standing. The prior revision conflated these.

**Rules:**
- One Work, many Editions. A Work surfaced under Quran, Hadith, Library and Shaykh-ul-Islam
  is **one Work with relationships**, not four records.
- Cross-language Editions of one Work are **related, not duplicates** — never merged by
  deduplication (MIGRATION_STRATEGY.md §5).
- Contributors are referenced from **People & Contributors** (§5). **Library no longer owns
  Author.**
- Large PDFs are **never database BLOBs** — storage references and checksums only.

### 10.2 Other aggregates

**Research** and **ResearchPaper** — abstract, citations, institutional context; a different
lifecycle from books. **Publication**, **Magazine**, **MagazineIssue**, **Encyclopedia** —
periodicals modelled with an issue hierarchy, because volume, issue and date are first-class
access paths for a magazine and meaningless for a book. **SalePoint** — printed-book
availability.

---

## 11. Media

**Video** — title/description per locale, `provider` (`youtube` | `vimeo`),
`providerVideoId`, duration, thumbnail, **speaker references via People & Contributors**,
topics, series, publication state. **Series** and **Playlist** — a video belongs to at most
one Series but may appear in many Playlists. **AudioTrack** and **AudioSeries** — non-Quran
audio only (§8.1). **Photo**, **Gallery**, **GalleryItem** — event galleries and the
historical archive.

**Rules:**
- Provider metadata is stored and the provider player embedded. **No video files are hosted.**
- One Video entity; appearance under Watch, Quran, Hadith and Events comes from
  relationships.
- **Media does not author Quran recitations** (§8.1).

---

## 12. Fatwa

**FatwaCategory** · **Question** · **Fatwa**.

Question lifecycle: submitted → triaged → assigned → drafted → **scholar review** →
published / declined / returned for revision.

**Rules — non-negotiable:**
- **Publication requires the `fatwa.publish` permission**, enforced in the domain layer.
  There is no bypass: no direct API, no admin route, no import path, no bulk operation.
  Step-up reauthentication is required (SECURITY_BASELINE.md §6).
- **No AI system may issue, draft, generate or publish a Fatwa.** At most, an assistant may
  locate and link existing published Fatawa.
- A **Question is private personal data.** Publishing publishes the ruling with an
  anonymised question — never the asker's identity, contact details or personal
  circumstances without explicit consent.
- Published Fatawa are **immutable in substance**; corrections create a visible new version.
- **FatwaCategory is a domain classification** that maps onto canonical Topics; it does not
  replace them.

---

## 13. Learning

**Course** · **CourseModule** · **Lesson** · **LearningPath** · **Enrolment** · **Progress**
· **ClassSession** · **Availability** · **Attendance** · **TrialClassRequest** · **Booking**.

### 13.1 ClassSession and live classes

Stores `meetingProvider` and `meetingUrl` as plain values; a teacher or administrator enters
a Google Meet URL manually. Automated provisioning is deferred behind an integration
abstraction, and the model already accepts it without change.

**Validation invariants** (SECURITY_BASELINE.md §11): provider and URL must be consistent;
for the Google Meet provider only **HTTPS `meet.google.com`** URLs are accepted; meeting
URLs are **disclosed only to authorised participants and administrators**, never placed in
public caches, and not logged unnecessarily.

**Class recording is out of scope for V1.** Class metadata and history are in scope later.

### 13.2 Teaching authorisation

A **TeacherProfile** (owned by People & Contributors) confers **no privilege**. Teaching
requires an auditable **RoleAssignment** granting `teaching.perform`, optionally scoped to
specific courses. Approval creates that assignment; revocation removes it — and revocation
**immediately** affects messaging authorisation (§12.3 of this document's Messaging section).

### 13.3 Enrolment vs Booking

Distinct lifecycles. A trial booking (requested → confirmed → completed/cancelled) precedes
and is independent of course enrolment.

---

## 14. Personalisation & Notifications

A bounded context that did not exist in the prior revision, leaving bookmarks, notes,
history and notifications with no owner and no retention rules.

### 14.1 Aggregates

| Aggregate | Description |
|---|---|
| Bookmark | A user's saved pointer to a content item, **including Quran ayat** |
| Note | A user's private annotation, including on Quran ayat |
| SavedItem | A saved resource of any supported type |
| **PrivateCollection** | A user's own list — **distinct from an editorial Collection** |
| ReadingHistory | What a user has read, when |
| WatchHistory | What a user has watched, when |
| ReadingProgress | Quran reading position and course progress projections |
| NotificationPreference | Per-channel, per-category preferences |
| Notification | A system-generated, one-directional message to a user |

### 14.2 Ownership and privacy rules

1. **Canonical content remains owned by its original context.** Personalisation stores only
   **typed references** to it — never copies of content.
2. **Typed references, not polymorphic pairs** (§6.2). `QuranBookmark`, `VideoBookmark`,
   `WorkBookmark` and similar keep referential integrity enforceable.
3. **Every record is owned by exactly one User** and is readable only by that User and by
   explicitly authorised personnel. All queries are scoped by user identifier — the primary
   defence against horizontal privilege escalation.
4. **Deleting a user's account deletes their personalisation records.** Aggregated,
   anonymised statistics and legally required audit records may be retained.
5. **Referenced content is normally archived, not hard-deleted** — see §14.3. The typed
   foreign key therefore stays valid, and the personalisation record renders the item as
   unavailable or archived **without ever becoming a dangling reference**.
6. **Personalisation is never read in the anonymous cached public render tree**
   (ARCHITECTURE.md §8).
7. **Notification ≠ Message.** Notifications are system-generated and one-directional;
   messages are conversational and owned by Messaging.

Detailed schema is deliberately not invented here; it arrives with the owning slice.

### 14.3 Deletion integrity — reconciling typed references with graceful degradation

Two requirements meet here: references must be **typed and database-enforceable** (§6.2), and
saved items must **degrade gracefully** when content becomes unavailable. These are reconciled
by controlling *how content leaves*, not by weakening the reference.

#### Normal removal is archival, not deletion

> **Published content is withdrawn by unpublish, archive or soft-delete semantics — not by row
> deletion.**

The row continues to exist, so **the typed foreign key remains valid**. Personalisation
resolves the reference, observes the archived state, and renders the item as
**unavailable/archived** — a saved bookmark to a withdrawn article shows as withdrawn rather
than vanishing or breaking. **No dangling reference is ever created**, because nothing was
detached.

This also serves the content domains: archival preserves provenance, audit history and legacy
URL mappings that a hard delete would destroy.

#### Hard deletion is a rare, explicit, transactional purge

Genuine hard deletion is reserved for legal, security or retention-driven purposes — an
erasure request, a copyright demand, unlawful material, an expired retention window.

It is performed by an **explicit purge workflow**, never by an ordinary delete:

1. The purge runs **in a single transaction**.
2. It **first resolves every affected Personalisation record** — removing, anonymising or
   converting it to a tombstone reference according to the applicable policy.
3. **Only then** is the content row removed.
4. **A broken foreign key is never left behind**, and the operation is audited.
5. The workflow requires elevated permission and **step-up reauthentication**
   (SECURITY_BASELINE.md §8).

#### What is explicitly rejected

- ✘ **A generic polymorphic reference** to sidestep the constraint — that reintroduces exactly
  the unenforceable design §6.2 prohibits.
- ✘ **A generic cross-domain integrity registry** built solely for this case — disproportionate
  machinery for a rare operation that archival already handles.
- ✘ **Nullable references left dangling after deletion.**

Physical modelling — cascade behaviour, tombstone shape, per-type purge steps — is
implementation-phase work for the owning slices. **The rule that hard deletion must
transactionally resolve personalisation first is settled here.**

---

## 15. Messaging

**Conversation** · **ConversationParticipant** · **Message** · **MessageAttachment** ·
**MessageReadState** · **Block** · **Report** · moderation records.

### 15.1 Single ownership

> **Messaging is the one owner of conversations, participants, message creation,
> authorisation invariants, blocking, and assignment/enrolment checks.**

**Ownership is unaffected by where an implementation is hosted.** Selected Messaging
application services are exported through `packages/server-core` so that both the web process
and the future realtime transport call the same implementation. That package is a
**server-only host and export surface — not a bounded context, not a second domain layer, and
not an owner of any rule** (ARCHITECTURE.md §3.1). **Messaging remains the semantic owner**
and the only place these rules may change.

The future realtime process is a **transport, presence and event-delivery adapter**. It does
not own data, does not reimplement rules, and does not access the database directly.

### 15.2 Persistence

**SQL Server is the source of truth.** A message is durably persisted **before** it is
broadcast. With the realtime process unavailable, sending and reading still work through
the web application — delivery degrades from instant to on-refresh, and **nothing is lost**.

**Typing state is ephemeral and never persisted.**

### 15.3 Relationship authorisation — current, not historical

> **Every authorisation check validates the *currently* allowed relationship, not merely
> historical conversation membership.**

This is a correction: participant membership alone is not authorisation, because
relationships end.

| Conversation type | Requirement re-checked on every send and every event |
|---|---|
| Student ↔ teacher | The teacher must **still** hold a current, valid assignment to that student where policy requires it |
| Student ↔ student | The relationship must **currently** satisfy the approved course/class/community policy |
| Support | The staff participant must **currently** hold the support permission |

Required negative tests (DELIVERY_PLAN.md): unrelated teacher · **former teacher** ·
**revoked assignment** · blocked user · unauthorised student · **removed class/course
membership**.

### 15.4 Safety rules

- **Block** — a blocked pair cannot initiate or continue a conversation.
- **Report** — any participant may report a message or conversation.
- **Moderation** — moderation state is a first-class field; evidence access is restricted to
  authorised moderators and audited.
- **Attachment retention** — retention and disposal are defined policy, not incidental.
- **Student ↔ student requires policy approval** and is disabled by default.
- **Explicitly excluded:** calling, stories, statuses, and social-network cloning.

---

## 16. Migration & Provenance

A foundation-level context that did not exist in the prior revision, where legacy mapping
sat inside Editorial — an impossible arrangement, since Quran and Hadith require provenance
yet must not depend on Editorial.

### 16.1 Aggregates

| Aggregate | Description |
|---|---|
| **LegacySource** | A registered authorised origin: access method, **authorisation reference and date**, licensing evidence, rate-limit policy, expected content types |
| **RawSnapshot** | The **immutable** preserved raw response: body, status, headers, fetch timestamp, source URL, checksum |
| **ImportRun** | One execution: operator, timing, stage counts, status |
| **StagedRecord** | A normalised candidate awaiting review, with validation results and proposed topic mappings |
| **ImportError** | A failure with context, classification and retry eligibility |
| **LegacyMapping** | Original URL and identifier → canonical new URL. **Drives 301 redirects and traceability** |
| **PublishManifest** | The reversible record of what one run published, enabling reconciliation and rollback |
| **AssetProvenance** | Per-asset authorisation and licensing evidence |
| **MigrationStatus** | Per-record lifecycle state across the pipeline |

### 16.2 Provenance is available to every target domain

Quran, Hadith, Library, Media, Fatwa, Editorial and Global Network all carry legacy
provenance **without depending on Editorial** — they are referenced *by* Migration &
Provenance, not the reverse.

### 16.3 Publication direction

> **Migration publishes INTO a target domain through that domain's public application
> interface, never by writing to its tables.**

Because Migration & Provenance depends on no target content context (§3.1), this
orchestration is composed at **Layer 4**. Consequently **every domain rule applies to
migrated content exactly as to hand-authored content** — including the religious approval
workflows that no import path may bypass.

### 16.4 Control data vs tooling

| Concern | Location |
|---|---|
| Persistent migration control and provenance **data** | **Migration & Provenance context** — a real domain owner |
| Source-adapter **executables and tooling** | `scripts/migration/` |

The prior revision placed migration "outside application modules" while giving it persistent
records, admin routes and an API — a contradiction now resolved.

---

## 17. Global Network, Membership, Donations

### 17.1 Global Network

**Country → Region → City → Centre**, plus **CentreContact**.

**Flexible parentage is required.** Not every country has meaningful regions; some centres
serve multiple cities; virtual centres have no city at all. Intermediate levels are
**nullable**, and a Centre carries its own address and coordinates rather than depending on
a rigid chain. Pakistan's city structure fits within this same hierarchy — not as a parallel
special case.

A Centre's news and events are ordinary Editorial records carrying a Centre reference —
**not** a separate per-centre content system.

### 17.2 Membership

**MembershipType** · **Membership** · **MembershipApplication**. Modelled separately from
User: membership is an organisational relationship with its own lifecycle.

**Membership does not depend on Donations** and is delivered as its own slice — an
unresolved payment provider must never block it.

### 17.3 Donations

**DonationCampaign** · **Donation**, behind a `PaymentProvider` abstraction. **No provider
is selected in Phase 0A.** **No card or payment credential data is ever stored.** Webhook
requirements — signature verification, idempotency, replay resistance, and server-side
verification of amount, currency and status — are in SECURITY_BASELINE.md §14.

---

## 18. Models that must NOT be merged

| Do not merge | Why |
|---|---|
| **Quran and Hadith** | Different structures, scholarship and integrity rules |
| **Quran and Work/Edition** | The Quran is not a publication; books *about* it are Works |
| **Ayah and Translation** | Multiple translations layer over one immutable Arabic text |
| **Hadith and HadithTranslation** | Same reasoning |
| **Quran Recitation and Media AudioTrack** | One authorable source of truth; Media projects, never authors |
| **Person and User** | A Person may be historical; a User is an application identity |
| **User and any public profile** | An account is not automatically a public profile |
| **AuthorProfile, SpeakerProfile, ScholarProfile, TeacherProfile** | Four distinct roles a Person may hold simultaneously |
| **Profile and permission** | **A profile grants nothing; only a RoleAssignment does** |
| **Capability projection and permission** | Projections are derived views, never an enforcement path |
| **Work and Edition** | One work, many manifestations |
| **Localized metadata and BookTranslation** | Presentation vs a genuine translated Edition |
| **Fatwa and Article** | Merging permits publishing a ruling through an editorial path |
| **Question and Fatwa** | Private personal data vs public ruling |
| **Topic and Tag** | Canonical/curated/hierarchical vs free-form |
| **Topic and FatwaCategory** | Domain classification maps onto topics, does not replace them |
| **Topic and Surah/Juz** | Quran structure is not subject taxonomy |
| **Interface locale and content language** | Independent concerns |
| **Editorial Collection and PrivateCollection** | Public curated vs private personal |
| **Video and Audio** | Different players, metadata and consumption |
| **Series and Playlist** | One series per video; many playlists |
| **Event and News** | An event occurs; news reports on it |
| **Enrolment and Booking** | Different lifecycles |
| **Centre news and general News** | One News model with a Centre reference |
| **Message and Notification** | Conversational vs system-generated |
| **Membership and User** | An organisational relationship with its own lifecycle |
| **Featured/Popular/Latest and content types** | Flags and queries, never entities |
| **Migration provenance and Editorial content** | Provenance serves every domain, including those forbidden to depend on Editorial |

---

## 19. Cross-cutting concerns

### 19.1 Localisation

Locale-aware fields are **translation rows related to the parent record** — never parallel
columns (`title_en`, `title_ur`), never separate databases per language.

Adding a fourth language becomes a data operation. Missing translations are detectable and
reportable. **One content database serves all locales.**

Three distinct concepts, never conflated: **content language** (what a work is written in) ·
**interface locale** (the UI language) · **translation availability** (which locales a record
has). And a fourth, for Library: a **BookTranslation Edition** is a genuine translated work,
not localized metadata (§10.1).

### 19.2 Publication state

Shared across editorial content: draft → in review → scheduled → published → archived.
Religious contexts extend this with mandatory review stages that **cannot be skipped by any
path**, including import.

### 19.3 Auditability

Mutations to religious content, permission grants, publication and migration publication
record: actor, timestamp, before and after state, and the authorising source. A domain
requirement, not a logging convenience. The realistic integrity baseline is in
SECURITY_BASELINE.md §13.

### 19.4 Referential integrity

**Enforceable database-level integrity is a Phase 0A requirement**, not an implementation
preference. Wherever the prior revision proposed `targetType + targetId`, typed
relationships are required instead (§6.2, §7.3, §14.2).
