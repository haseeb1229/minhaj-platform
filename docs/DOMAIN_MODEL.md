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
| 4 | **Editorial** | Article, Page, News, PressRelease, Statement, MediaCoverage, Event, Collection, the shared editorial workflow, and a **limited private correspondence area** — ContactInquiry and Feedback (§7.5) |
| 5 | **Quran** | Surah, Ayah, Juz, Translation, Transliteration, Tafsir, Tajweed, **Recitation** |
| 6 | **Hadith** | Collection, Book, Chapter, Hadith, Translation, Commentary, Sciences, Narrator |
| 7 | **Library** | Work, Edition, BookTranslation, Research, ResearchPaper, Publication, Magazine, MagazineIssue, Encyclopedia, SalePoint |
| 8 | **Media** | Video, Series, Playlist, AudioTrack (non-Quran), AudioSeries, Photo, Gallery |
| 9 | **Fatwa** | FatwaCategory, Question, Fatwa, and the ruling workflow |
| 10 | **Learning** | Course, Module, Lesson, LearningPath, Enrolment, Progress, ClassSession, Availability, Attendance, TrialClassRequest, Booking |
| 11 | **Personalisation & Notifications** | Bookmarks, notes, saved items, private collections, reading/watch history, progress projections, notification preferences, notifications, **NewsletterSubscriber** (§14.5) |
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
   the filesystem, or a search engine directly. A context reaches persistence through **its own
   persistence port**, whose approved adapter is **physically implemented inside
   `packages/database`** while remaining **semantically owned by that context**
   (ARCHITECTURE.md §3.1.1, §4.1). Invoking a service that internally persists is not the same
   as holding raw database capability, and **no context may use another context's persistence
   adapter as a shortcut** — it calls that context's public interface instead.

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
| Editorial | Layer 0; Identity & Access; People & Contributors; Taxonomy; **Global Network** *(same-level edge — see §3.2)* |
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
- **Editorial depends on Global Network** because a centre-scoped NewsArticle names a
  Global-owned Centre by typed identity (§17.1), and Events will do the same (Phase 14). Editorial
  asks only Global's public reference interface; Global never imports Editorial, and a Centre
  page composing both is Layer 4 (§3.3).
- **Layer 0 `database` is infrastructure, never an owner.** A context's persistence adapter may
  be physically implemented inside `packages/database` while remaining owned by that context
  (ARCHITECTURE.md §3.1.1). Physical placement grants no cross-context access and creates no
  edge: **a context still reaches only what its row above permits.**
- **`packages/server-core` is not a layer and is not a dependency edge.** Hosting a context's
  service there changes only where it is exported from; the hosted service obeys its own
  context's row in this table, and admission is governed by ARCHITECTURE.md §3.1.3.

### 3.2 Permitted same-level dependencies

Only these directed same-level edges exist. Each is **one-directional**; **the reverse is
neither implied nor permitted.**

| Permitted edge | Why it is legitimate | Reverse |
|---|---|---|
| **Messaging → Learning** | Message authorisation must verify a **current** teaching assignment or enrolment (§15.3). That knowledge belongs to Learning, and duplicating it inside Messaging would create two sources of truth for who may speak to whom | **`Learning → Messaging` is prohibited** |
| **Editorial → Global Network** | A NewsArticle revision — and, from Phase 14, an Event — carries a typed reference to a **Centre**, which Global Network owns (§17.1). Editorial asks Global's public reference interface whether a Centre may be chosen; it never reads Global's tables, and no Global data is copied into Editorial | **`Global Network → Editorial` is prohibited**: Global persistence never reads Editorial tables, and a Centre page composes Global's Centre with Editorial's own bounded centre-News read at Layer 4 |

**Rules:**
- **No implicit lateral imports.** A same-level dependency exists only if listed here, and
  only in the listed direction.
- **Acyclicity is preserved** by directedness: because `Learning → Messaging` and
  `Global Network → Editorial` are prohibited, neither pair can form a cycle.
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
internal identifier, **account email**, display name, **private basic account profile**,
**account interface locale**, **timezone**, **account status**, **account-setup state**,
timestamps.

**Rules:**
- A User exists independently of any authentication method.
- **Google sign-in never creates a Minhaj email address.** Google is an identity provider.
- **A User account is authentication/application identity. It is NOT automatically a public
  Person profile** (§5.2).
- One person, one User record, regardless of how many sign-in methods.

> **Account setup is not personalisation onboarding.** Identity & Access owns the
> **account-setup state** — the account exists, its email is verified, its interface locale and
> timezone are chosen. **Personalisation & Notifications owns personalisation onboarding** —
> interests, goals, learner level, preferred format (§14.1). They are separate states with
> separate owners and separate delivery phases, and **Identity depends on neither Taxonomy nor
> Personalisation** to complete its own.
>
> **Account locale and timezone belong here**, because authentication surfaces, security mail
> and session handling need them before any personalisation context exists. They remain
> distinct from **content language** (§6.3).

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

### 4.6 Account lifecycle — product and security invariants

Identity & Access owns the whole life of an account, not merely the moment of sign-in. These
invariants are stated here because each of them is a place where a plausible implementation is
quietly wrong. **The exact Better Auth-compatible mechanism is implementation-phase proof
(DELIVERY_PLAN.md, Phase 2); the invariants are settled now.**

**Identity of an address**

- **Canonical comparison semantics are defined and applied consistently** wherever an address
  is compared — signup, sign-in, email change, reset and linking. Normalisation and case
  handling follow one rule, and that rule is the same everywhere.
- **Uniqueness is enforced by the database**, not only by an application check, so two
  concurrent signups cannot both succeed. **Race-safety is a schema property.**
- > **Provider-specific rewriting is not canonicalisation.** Gmail-style dot-stripping and
  > plus-tag removal are **not** applied as a global rule. Treating `a.b@example.com` and
  > `ab@example.com` as one identity is a provider behaviour, not an internet-wide one, and
  > applying it globally merges distinct people's accounts.

**Collisions and change**

- A **signup collision** resolves deterministically to exactly one account, with a
  **non-enumerating** response.
- An **email-change collision** is rejected safely, without revealing whether the target
  address already has an account.
- **Changing an email requires proving ownership of the new address**, and the account's
  verified state follows the address rather than persisting from the previous one.

**Status and closure**

- **Disable**, **suspension**, **reactivation where supported** and **closure/deletion** are
  distinct states with distinct effects, and **account status is enforced on every
  authenticated request**, not only at sign-in.
- **Later re-registration with the same address starts clean.** Closure followed by a new
  account must **never** restore prior role assignments, grants or private data.
- Account closure is **coordinated across semantic owners** rather than performed by one
  context reaching into another's data (§14.3, SECURITY_BASELINE.md §19.1).

**Authentication methods**

- **Provider account linking requires verified ownership** of the address (§4.3).
- **Unlinking is safe**: the system **refuses to remove the final usable authentication
  method**, which would otherwise lock a person out of their own account irrecoverably.

**Sessions**

- **Sessions are revoked after a high-risk security or privilege change** — password change,
  email change, second-factor change, or a change to what the account is permitted to do.

**Responses**

- Sign-in, signup, reset and resend responses are **generic and uniform**, so none of them
  discloses whether an account exists (SECURITY_BASELINE.md §15.2).

> **These capabilities must be reachable in the product.** A password change, a session
> revocation, a connected-account review or a second-factor enrolment that exists only as a
> backend service is not delivered. Phase 2 ships a **usable minimum Account & Security
> surface** (ROUTE_MAP.md §5.1).

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

### 5.4 Data disposition — what account closure does to a Person

SECURITY_BASELINE.md §19.1 requires **every semantic data owner to define the disposition of
its own data**, and names `profile` among the classes that must be covered. This is People &
Contributors' definition, settled here because the answer must not be re-decided per phase.

| Record | On closure of a linked account |
|---|---|
| **Person, and every profile** | **Unchanged.** A Person is a *public contributor record* with its own lifecycle. Closing an account is not a decision to withdraw somebody's authorship, and destroying the record would break attributions later content domains carry |
| **The optional `Person → User` link** | **Released.** People removes it, through its own service, after Identity's closure has committed |

**Why the live link is released rather than retained.** `Person` and `User` are distinct
aggregates, and `Person.userId` is an operational account-linkage mechanism rather than the
contributor-history or provenance record. Once that application account is closed, the live
association has no current sign-in or authorisation purpose. Releasing it is One Minhaj's
privacy-minimising product default; it is not a claim that every jurisdiction legally requires
release. If an adopted legal or operational policy later requires a historical association, it
must introduce an explicit, separately reviewed retention/provenance mechanism rather than keep
the live link as a surrogate for that future requirement.

**Consequences, in the order they matter:** the contributor page renders exactly as before;
the capability projections (§4.5) report false, because there is no account to project from;
and a later re-registration of the same address is a **new** `User` id that is **not** relinked
— nothing links by email or name, and no People operation runs on sign-up.

> **The two halves are two owners' own transactions**, coordinated at Layer 4 and **idempotent
> and resumable** (ARCHITECTURE.md §3.1.2.1). A cross-context transaction is never used, and an
> interrupted closure leaves a link that the next reconciliation releases.

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

#### 6.2.1 What the prohibition covers — and what it does not

The prohibition addresses **relational domain references**: a pair used to *navigate* from one
business record to another, bypassing referential integrity and typed ownership. That is the
design SQL Server cannot enforce, and that is what is forbidden.

**Historical audit identifiers are a different thing, and are explicitly allowed.** The
`AuditLog` actor and target identifiers established in the Phase 1 database foundation are:

- **historical evidence** — a snapshot of who acted and what the event concerned
- **intentionally capable of outliving** the deletion or change of the domain records they name
- **not relational navigation** — nothing joins from an audit row into a domain table
- **not a shortcut for cross-domain persistence**
- **not a polymorphic business relationship**

An audit record must stay readable and truthful after its target is archived, renamed, purged
or reassigned. A foreign key would make that impossible: it would either block a lawful purge
(§14.3) or destroy the evidence the record exists to preserve.

> **The existing Phase 1 `AuditLog` representation is therefore correct as it stands, carries
> no foreign keys, and is not changed by this rule** (SECURITY_BASELINE.md §13).

**The derived search projection is the second, equally narrow case (Phase 17).** Its
`scopeKind + scopeId` and `kind + resourceId` name an owner's resource inside a **rebuildable,
non-authoritative index** (ARCHITECTURE.md §8.5). They are not navigation between business
records, no owner reads them, nothing joins from them into an owner table, and deleting every
one of them loses nothing a rebuild from the owners cannot recreate. They carry **no foreign
key into any owner**, deliberately: typed edges from a derived index into every table it
reflects would make Search a relational dependant of every context. **This does not relax the
rule for anything authoritative** — no business relation may be expressed through, or read
from, the search projection, and a context's typed relationships stay typed.

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

#### 7.2.1 Article and Page publication snapshots

Each Article and Page owns separate immutable revision, translation, typed Topic/Person
reference, and permanent slug-reservation tables. Approval names the exact current revision.
Neither its creator nor that revision's editor may approve it, including a Platform
Administrator. Author, reviewer and publisher authority are distinct live Permission checks;
`content.review` is now a grantable Editorial permission and remains the sole source of
Identity's `canReviewContent` projection. A contributor profile grants nothing.

Every material mutation carries an expected version. Saving a new revision returns the
record to draft, withdraws its published representation, and clears approval and scheduling.
The administrative form discloses this before saving. Publication requires fresh independent
approval; no parallel published/draft branch is maintained in Phase 6. Revisions retain the
structured document, schema version and server-sanitised rendering. Public DTOs exclude the
authoring document and private workflow actors.

Article slugs and help-article Page slugs may change; all prior slugs remain reserved and
resolve directly to the current published canonical URL with HTTP 301. Fixed organisational,
legal and utility Page destinations are an allowlist, immutable after creation, with the
internal slug `page`. They cannot claim another context's route.

The stored schedule binds UTC time, an IANA display zone, revision and scheduling actor.
A single-instance executor processes at most 25 due records of each workflow-governed
aggregate per sweep (Article, Page and, since Phase 13, the four News families), rechecking
reviewer and publisher authority. Failed authority or execution leaves a visible stopped
schedule; an authorised publisher may reschedule after review. Expected-version transactions
make duplicate execution harmless. Restart resumes pending due work; multi-instance hosting
still requires the leasing gate in ARCHITECTURE §3.5.1.

#### 7.2.2 News — as delivered (Phase 13)

NewsArticle, PressRelease, Statement and MediaCoverage are four Editorial aggregates, **not a
News context and not one content table with a type column**. Each owns the Article's shape of
tables — record, immutable revisions, revision translations, typed Topic and Person
references and permanent slug reservations — and is governed by the same workflow, through one
shared set of workflow rules: the same lifecycle, the same approval of the exact current
revision by someone other than its creator or editor (no administrator exception), the same
edit-invalidates-approval-and-schedule rule and the same durable, re-checked schedule. The four
editorial keys `content.read/author/review/publish` govern them; no `news.*` key exists.

| Aggregate | What genuinely distinguishes it |
|---|---|
| **NewsArticle** | Canonical at `/news/{slug}`. Its slug can never be `archive`, `press-releases`, `statements` or `media-coverage` — refused by the contract and by SQL CHECKs on the record and its slug history |
| **PressRelease** | Its own family and route; no extra metadata is invented for it |
| **Statement** | Every translation names its **issuing authority** — a bounded, human-facing text, because the authority may be institutional and no Organization entity exists; it is not a Person reference |
| **MediaCoverage** | The revision names the **outlet**, and only where known an **HTTPS source address** (normalised; no credentials, no other scheme) and the **date of the coverage**. Title, summary and body are the organisation's own words about the coverage — nothing of the third party's article is copied, mirrored, embedded or fetched |

**Rules:**
- **No image.** News depends on Editorial and Search, not on Storage or Media, so no lead
  image, Asset, Photo, Gallery or remote image address exists. A future lead image is an
  explicit dependency decision.
- **No forward reference.** No Event, Centre, Collection or newsletter relation; centre-scoped
  News is Phase 16's Centre reference on these records.
- **No engagement state.** No view count, popularity score or featured flag; "latest" is the
  publication-instant order.
- **The archive and topic timelines read genuine publication instants** (UTC year and month),
  never a record's creation time, across all four families.
- **Issuer and source changes are audited as their own events**, and no audit row carries a
  title, body, authoring document, issuer or source address.

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

### 7.5 The limited private correspondence area

Public visitors can write to the organisation through `/contact` and `/feedback`
(ROUTE_MAP.md §3.1). Those submissions had no owner, which is how they end up either as an
unmanaged mailbox or as an invented ticketing product. **They are owned here**, in a
deliberately limited private area of Editorial.

| Aggregate | What it is |
|---|---|
| **ContactInquiry** | A private inbound enquiry from a visitor |
| **Feedback** | A private inbound suggestion or report — **a distinct record and workflow**, because its fields and lifecycle genuinely differ |

**Lifecycle:** submitted -> triaged -> assigned / in progress -> resolved / closed, plus an
explicit **spam disposition**.

**Required behaviour for both:** rate limiting and anti-abuse · private operator notes where
needed · acknowledgement to the sender where appropriate · privacy · a **defined retention
period** · **permission-controlled operator access** · an admin triage surface · and honest
success and failure behaviour for the submitter.

**What this is not:**

- ✘ **Not public editorial content.** These records never appear in listings, search or caches.
- ✘ **Not a Fatwa Question.** A religious question is Fatwa-owned, with its own privacy and
  workflow (§12). A contact form is not a route into the Fatwa pipeline.
- ✘ **Not a CRM.** There is no pipeline, no lead, no campaign and no contact-management product.
- ✘ **Not a support conversation.** Authenticated `Messages -> Support` is **Messaging-owned**
  (§15.5); this is the unauthenticated public path.

**Ordinary published contact information** — addresses, phone numbers, office details — remains
**Page** content under the normal editorial workflow (§7.1). Only the private inbound records
live here.

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
- **A reference number is never a platform-wide key.** The same apparent number denotes
  different narrations across collections, across editions of one collection, and across source
  systems. Hadith identity is therefore **qualified by collection, edition and source system**,
  so that two sources numbering differently — or identically — **cannot silently collide** or
  overwrite one another during migration or editing.
- **Narrator is sourced data where it is included at all.** A conceptual mention of Narrator in
  this model is **not** authority to build a narrator-management subsystem
  (PRODUCT_SCOPE.md §4.4).

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

As delivered (Phase 9):

| Aggregate | Carries |
|---|---|
| **Research** | Content language, date facts, abstract, institutional context, ordered citations, readable text |
| **ResearchPaper** | The same, plus where it appeared and its own DOI — an independent aggregate, never Research's child |
| **Publication** | Content language, date facts, publisher, readable text — not a Work, not a Magazine, and it has no issues |
| **Encyclopedia** | Content language, date facts, publisher, readable text — its structure is its document; there is no entry subsystem |
| **Magazine** | The periodical itself: no content language and no date of its own |
| **MagazineIssue** | Belongs to exactly one Magazine for ever; content language, optional volume, number and date, readable text |

Each has its own table, slug namespace and typed label, contributor (People) and topic
(Taxonomy) relations; no type column and no polymorphic reference joins them. Labels are
localized descriptive metadata, never a translation of the text. A citation is bounded plain
text with an HTTPS address and a DOI only where genuinely known. An issue's slug and (volume,
number) are unique within its Magazine, and an issue is public only while its Magazine is.

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

As delivered (Phase 10) — Video, Series and Playlist only:

| Aggregate | Carries |
|---|---|
| **Video** | `provider` + `providerVideoId` (unique together; nothing else about the player is stored), content language (Taxonomy), localized title and description, optional duration, provider publication date, provider thumbnail address, captions-offered flag, organisation-held transcript, an optional curated **format** (`lecture`, `event`, `highlight`, `interview`, `documentary`), ordered speakers (People), topics (Taxonomy), at most one Series with its episode position, featured flag, **availability** |
| **Series** | Localized title and description and a **kind** — `series` or `program`. A programme is a Series kind, not an aggregate |
| **Playlist** | Localized title and description and an ordered, duplicate-free membership of Videos (at most 200); removing a Playlist never removes a Video |

Each has its own table, slug namespace and slug history; lifecycle is draft, published,
archived. **Availability is orthogonal to publication**: an operator records that the provider
no longer serves a published Video, and its page then offers the provider link instead of a
player — nothing polls the provider, and a cross-origin frame's failure is not observable. The
`event` format is event coverage, not a reference to an Event. A thumbnail must be this video's
image on the provider's own image host, and a transcript is text the organisation holds —
neither is fetched nor generated.

As delivered (Phase 11) — AudioTrack and AudioSeries, **non-Quran audio only**:

| Aggregate | Carries |
|---|---|
| **AudioTrack** | Content language (Taxonomy), localized title and description, optional duration, optional recording date (a date, never an instant), organisation-held transcript, ordered speakers (People), topics (Taxonomy), at most one AudioSeries with a unique place in it, and **one typed, nullable reference to the Storage `Asset` holding its audio** |
| **AudioSeries** | Localized title and description. It is **not** the Video `Series`: its own table, its own members. Removing or archiving one never removes a track |

**Rules:**
- **No AudioTrack can describe a Quran recitation.** There is no reciter, Surah, Ayah, Juz,
  range, recitation kind or `isQuran` field, and the input schemas are strict, so such a field
  is refused rather than ignored. `/listen/recitations` stays absent until Quran delivers its
  own catalogue; an AudioTrack never fills it (§8.1).
- **The file is Storage's; its meaning is Media's.** A track names exactly one `Asset` by a
  foreign key that never cascades, and one Asset serves at most one track. The asset
  identifier is never accepted from a form: a file is attached only by uploading it to that
  track, and only once Storage has cleared its exact bytes. Media reads nothing of the Asset
  row — size, type and scan state are Storage's to report through `StorageServicePort`.
- **A published track has audio** — enforced by the service and by a SQL CHECK. **Technical
  availability is orthogonal to publication:** a published track whose bytes cannot be served
  (missing after a restore, never cleared) keeps its page and says the recording is
  unavailable; it is not thereby unpublished.
- **Playback grants no copy.** There is no download purpose; none is offered until a rights
  decision authorises one.
- **Replacing a file never destroys the one it replaced.** The new relation is written under
  the expected version and the previous Asset stays in Storage, unreferenced and unservable.
- Lifecycle is draft, published, archived; each aggregate has its own slug namespace and
  native slug history. No AudioPlaylist, Podcast, Album, Season or Episode aggregate exists,
  and no listening history is recorded.

As delivered (Phase 12) — Photo, Gallery and GalleryItem, **with no Event relationship**:

| Aggregate | Carries |
|---|---|
| **Photo** | Primary locale, lifecycle, per-locale **alternative text** and **caption** (each optional, never generated), an optional credit (descriptive, not a licence), an optional **date taken as precisely as it is known** — a year, a month and year, or a day — and **one typed, nullable reference to the Storage `Asset`** holding its image, with the image's displayed width and height recorded with it. **No slug**: a Photo has no page of its own |
| **Gallery** | Localized title and description, its own slug namespace and native slug history, lifecycle |
| **GalleryItem** | One Photo's place in one Gallery — typed foreign keys to both, a unique position, duplicate-free, at most 240 per Gallery. No page, slug or lifecycle of its own |

**Rules:**
- **No forward reference.** Nothing here names an Event, Centre or Collection, and a Gallery has
  no kind: the Event↔Gallery association is Phase 14's, owned there once both ends exist.
- **The image is Storage's; its meaning is Media's**, exactly as for audio: one never-cascading
  foreign key, one Asset per Photo, the identifier never accepted from a form, and **a published
  Photo has an image** (service and SQL CHECK). Technical availability is orthogonal to
  publication: a Photo whose bytes cannot be served is shown as unavailable, not unpublished.
- **A Photo may appear in many Galleries.** A Gallery owns its membership and order, never its
  Photos: removing membership removes no Photo, and neither Photo nor Gallery is ever deleted.
- **The cover is derived** — the first public Photo in the Gallery's order — never a second
  relation that could disagree with it.
- **A date taken is never a record's creation time**, and a year stays a year (§19.5).
- **Nothing is inferred from an image**: no person, place, topic, caption or description.

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
| **NewsletterSubscriber** | A confirmed or pending subscription to the newsletter — **independent of User** (§14.5) |

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

#### Hard deletion is a rare, explicit, durable, fail-closed purge

Genuine hard deletion is reserved for legal, security or retention-driven purposes — an
erasure request, a copyright demand, unlawful material, an expired retention window.

A previous revision required the purge to run **in a single transaction** spanning the content
context and Personalisation. **That is corrected here**, because the only way to honour it
would be to pass a transaction handle across a context boundary — precisely the capability
laundering Model A prohibits (ARCHITECTURE.md §3.1.2). **The guarantee is preserved; the
mechanism changes.**

The purge is an **explicit, durable, resumable workflow**, never an ordinary delete
(ARCHITECTURE.md §3.1.2.1):

1. The target is first marked **unavailable, archived or purge-pending**.
2. **It cannot leak publicly while the purge is incomplete** — the workflow is fail-closed, so
   an interruption withholds content rather than exposing it.
3. **Layer 4 coordinates the public services of the semantic owners.** It calls interfaces; it
   never reaches into another context's tables.
4. **Each owner disposes of its own records** — removing, anonymising or converting them to a
   tombstone reference — according to its own policy. Personalisation resolves its records
   through its own service, as every other owner does.
5. **Every step is idempotent and resumable**, so a retry after interruption is safe.
6. The absence of any prohibited relational reference is **verified**.
7. **Only then** may the owning content context physically delete the row.
8. **Workflow state and failures are audited**, and the workflow requires elevated permission
   and **step-up reauthentication** (SECURITY_BASELINE.md §8).

**A failure may delay final physical deletion. It must never break referential integrity, leak
content, or bypass semantic ownership** — and **no Prisma client, delegate, transaction handle,
persistence adapter, repository or raw-query capability crosses a context boundary at any
point.**

#### What is explicitly rejected

- ✘ **A generic polymorphic reference** to sidestep the constraint — that reintroduces exactly
  the unenforceable design §6.2 prohibits.
- ✘ **A generic cross-domain integrity registry** built solely for this case — disproportionate
  machinery for a rare operation that archival already handles.
- ✘ **Nullable references left dangling after deletion.**

Physical modelling — cascade behaviour, tombstone shape, per-type purge steps — is
implementation-phase work for the owning slices. **The settled rule is that hard deletion
resolves every owner's records, through that owner's own service, before the content row is
removed — durably, idempotently and fail-closed — and that no purge leaves a broken reference
behind.**

### 14.4 "My Minhaj" is a Layer-4 experience, not this context's ownership boundary

`/my/*` is an **authenticated experience and composition surface at Layer 4** (§3.3). It is
**not** a bounded context, and it does **not** make Personalisation & Notifications the
semantic owner of every operation reachable beneath it.

| Capability surfaced under `/my` | Semantic owner |
|---|---|
| Account and security | **Identity & Access** (§4) |
| Roles and permissions | **Identity & Access** (§4.4) |
| Courses and progress rules | **Learning** (§13) |
| Teacher and class operations | **Learning** / the teacher-owning phase as documented |
| Messaging | **Messaging** (§15) |
| Fatwa questions | **Fatwa** (§12) |
| Bookmarks, history, preferences, notifications | **Personalisation & Notifications** (§14.1) |
| Membership | **Membership** (§17.2) |
| Donations | **Donations** (§17.3) |

> **Route placement transfers no semantic or domain ownership.** A `/my` route *composes* these
> capabilities through their owning contexts' public interfaces, exactly as any other Layer-4
> surface does (§3.3).

Personalisation & Notifications owns the aggregates listed in §14.1 — and only those.

### 14.5 Newsletter — subscription is consent, not a stored address

The newsletter is promised across the information architecture (Explore, the footer,
`/newsletter`) and had no owner. **It is owned here**, alongside the other communication
preferences — and **no new bounded context is created for it**.

> **`NewsletterSubscriber` is independent of `User`.** A visitor subscribes without an account,
> and **creating an account never subscribes it**. Marketing consent is not a side effect of
> registering.

**V1 uses double opt-in**, as an engineering-controlled safe default:

```
submitted -> confirmation pending -> confirmed subscriber -> unsubscribed / suppressed
```

**Rules:**

- **Submitting an address alone does not activate a subscription.** Only confirmation does —
  it is what proves mailbox control and explicit consent, and it is what stops a third party
  subscribing someone else's address.
- Confirmation attempts are **rate-limited**, and responses are **anti-enumerating**: the
  result never reveals whether an address is already subscribed.
- Confirmation tokens are **single-purpose, bounded-lifetime and replay-safe**. They carry no
  authentication authority and are **not** the Better Auth tokens (ARCHITECTURE.md §4.6.1).
- **Unsubscribe is simple and never requires signing in.**
- Locale or language preference is retained where useful; **consent evidence is retained
  appropriately** (SECURITY_BASELINE.md §19.1).
- **Provider bounce and complaint suppression overrides any future optional marketing send.**
- The operator broadcast lifecycle stays bounded. **No marketing automation platform and no
  campaign CRM is introduced.**

> **A marketing unsubscribe never suppresses security-critical or account-service
> communication** (ARCHITECTURE.md §4.6.1). They are different classes of mail with different
> consent bases.

This posture is a safe V1 default. **A future adopter or jurisdiction may require stricter
behaviour; it is never weakened below verified explicit opt-in.**

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

Hosting follows the admission rule of ARCHITECTURE.md §3.1.3, and a hosted service **never
returns raw persistence capability** to its caller. It persists internally through Messaging's
own persistence port, whose adapter — wherever it is physically implemented — remains owned by
Messaging (ARCHITECTURE.md §3.1.1).

The future realtime process is a **transport, presence and event-delivery adapter**. It does
not own data, does not reimplement rules, and **never acquires raw database capability**
(ARCHITECTURE.md §3.1.2).

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

> **The check is not only on send.** Wherever the *data itself* is relationship-protected —
> reading conversation history, listing conversations, opening an attachment — the **current**
> relationship is what authorises access. Restricting only the send path would leave a revoked
> teacher able to keep reading a student's history, which is the same defect in a quieter form.

**Send is idempotent.** A client supplies an **operation identifier**, so a retry after a
timeout or a lost response produces **exactly one message** rather than a duplicate. Ordering
is durable, history is paginated, read and unread state is tracked, and a reconnecting client
**catches up** rather than silently missing messages.

### 15.4 Safety rules

- **Block** — a blocked pair cannot initiate or continue a conversation.
- **Report** — any participant may report a message or conversation.
- **Moderation** — moderation state is a first-class field; evidence access is restricted to
  authorised moderators and audited.
- **Attachment retention** — retention and disposal are defined policy, not incidental.
- **Student ↔ student requires policy approval** and is disabled by default.
- **Account closure follows a defined shared-conversation policy** — closing one participant's
  account must not silently destroy another participant's history
  (SECURITY_BASELINE.md §19.1).
- **With the realtime process unavailable, messaging degrades to on-refresh and loses nothing**
  (§15.2).
- **Explicitly excluded:** calling, stories, statuses, and social-network cloning.

### 15.5 Authenticated support conversations

The authenticated information architecture promises `Messages -> Support`
(INFORMATION_ARCHITECTURE.md §5). Its V1 meaning is stated here rather than left open.

> **Support is a conversation type owned by Messaging.** It is a conversation between an
> authenticated user and authorised support or operator participants.

It **reuses** Conversation, Participant, Message, ReadState, attachment security, and the
blocking and reporting rules where they apply. **No separate support-ticket or CRM bounded
context is created** — a support thread is a conversation, and modelling it twice would give
the platform two message stores with two authorisation implementations.

**Rules:**

- Support and operator participation is **permission-controlled**, through the normal
  Permission/RoleAssignment path (§4.4) — the support participant must **currently** hold the
  support permission (§15.3).
- **Sensitive support access is audited** where appropriate (SECURITY_BASELINE.md §13.2).
- **User A can never read user B's support conversation.**
- Support conversations follow the same **privacy and retention** rules as the rest of
  Messaging.

**This is distinct from the unauthenticated public path.** `/contact` and `/feedback` are
**Editorial-owned correspondence workflows** (§7.5) for visitors with no account. The two are
not merged, and neither is a route into the other.

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

#### 17.1.1 As delivered (Phase 16)

- **One Country per record, refused across Countries by the database.** A Region belongs to
  one Country; a City to one Country and, optionally, one Region **of that Country**; a Centre
  to one Country. Every parent reference below Country is a **composite foreign key on
  `(id, countryId)`**, so a cross-Country parent is impossible whoever writes. A Region or City
  **never leaves its Country** (its Country-scoped slug reservations pin it); a City may move
  between Regions of its Country.
- **One locality fact per Centre.** A Centre names a physical City — whose Region is then the
  Centre's — or, with no City, a Region directly, or neither; never both. **Virtual is an
  explicit fact** (`isVirtual`), never inferred, and a virtual Centre has no physical City,
  Region, coordinates or address.
- **Served Cities** are a typed, same-Country relation (`CentreServiceCity`), never a list of
  names or identifiers. Address words are localised per locale; **coordinates** are optional,
  exact `decimal(9,6)`, both or neither, never geocoded.
- **CentreContact** is public directory contact data — phone, email, HTTPS website — in twelve
  ordered places; it is not correspondence, messaging or a staff directory.
- **Lifecycle** is Global's own `draft → published → archived`; no review step and no hard
  deletion. **A record is public only under public ancestors** — a withheld Country, Region or
  City hides everything beneath it.
- **Slugs are editable with native history**: Country and Centre slugs are global; Region and
  City slugs are scoped by Country, as their addresses are.
- **Centre-scoped News** is the existing `NewsArticle`: its **revision** carries one nullable,
  non-cascading `centreId`, so choosing or changing a Centre is an ordinary edit that needs
  fresh review. No other News family carries a Centre. Archiving a Centre changes no News; a
  News page shows the Centre only while it is public.
- **Not searchable yet.** Phase 16 enters from 6 and 13, not 17; Find a Centre is Global's own
  owner query. A Global search projection, if wanted, is a recorded later step, and Phase 31
  proves completeness (DELIVERY_PLAN.md §3).

### 17.2 Membership

**MembershipType** · **Membership** · **MembershipApplication**. Modelled separately from
User: membership is an organisational relationship with its own lifecycle.

**Applicant lifecycle:** application -> review and decision -> status -> withdrawal or closure
where appropriate. The context owns the public membership information, the **applicant-facing
status**, operator management with permission checks, and its **application and status service
communication** (ARCHITECTURE.md §4.6.1). An applicant sees **only their own** application.

**Membership does not depend on Donations** and is delivered as its own slice — an
unresolved payment provider must never block it. **Membership contains no payment code path
whatsoever**; joining is an organisational act, and any future fee arrangement would be a
separate explicit decision rather than an implied one.

### 17.3 Donations

**DonationCampaign** · **Donation**, behind a `PaymentProvider` abstraction. **No provider is
selected in Phase 0A, and none is selected since.** **No card or payment credential data is
ever stored.** Webhook requirements — signature verification, idempotency, replay resistance,
and server-side verification of amount, currency and status — are in SECURITY_BASELINE.md §14.

**A donation carries a provider-neutral lifecycle**, so that changing provider is an adapter
change rather than a remodelling:

- an **anonymous** donor, or an **optional user-linked** donor;
- a **server-created, immutable expected amount and currency** for the attempt — the client
  never asserts what is owed;
- states: **pending, succeeded, failed, cancelled**, **expired** where the provider's semantics
  require it, **refunded**, **partially refunded** where supported, and **disputed / charged
  back** where the provider requires it;
- **duplicate-submission prevention**;
- provider transaction and event identifiers, **scoped to the provider account and
  environment**, so a sandbox identifier can never be mistaken for a live one;
- **durable event deduplication** and **out-of-order event handling**;
- **reconciliation** for ambiguous, delayed or missing provider events;
- confirmation, refund and receipt-style **service communication**
  (ARCHITECTURE.md §4.6.1);
- donor privacy, optional signed-in donation history where genuinely in scope, and operator
  filtering, reconciliation and export — with **redacted logs**.

> **A browser redirect never proves payment success.** Success comes from the provider's
> verified server-side state, never from the URL a donor lands on.

**Money follows §19.6.** And nothing here introduces ecommerce: **no cart, no order, no
shipping, no inventory, no subscription engine, and no Gift Aid or tax-receipt jurisdiction
logic.**

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
| **ContactInquiry and Fatwa Question** | A contact form is not a route into the religious ruling pipeline (§7.5, §12) |
| **ContactInquiry/Feedback and a support conversation** | Unauthenticated public correspondence vs an authenticated Messaging thread (§7.5, §15.5) |
| **Support conversation and a ticketing system** | Support is a conversation type, not a second message store (§15.5) |
| **NewsletterSubscriber and User** | Marketing consent is never a side effect of registering (§14.5) |
| **Account setup and personalisation onboarding** | Different owners, different states, different phases (§4.2, §14.1) |
| **Account locale and content language** | An account preference vs a property of the content (§4.2, §6.3) |
| **Native slug history and LegacyMapping** | Runtime renames are context-owned; legacy source URLs are Migration-owned (§19.7) |
| **Authoritative state and derived work** | Search, cache and sitemap are rebuilt, not authoritative (ARCHITECTURE.md §8.5) |

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

**Audit actor and target identifiers are historical evidence, not relational references**, and
are outside the polymorphic-reference prohibition (§6.2.1).

### 19.4 Referential integrity

**Enforceable database-level integrity is a Phase 0A requirement**, not an implementation
preference. Wherever the prior revision proposed `targetType + targetId` **as a relational
domain reference**, typed relationships are required instead (§6.2, §7.3, §14.2). The
historical `AuditLog` identifiers are not such a reference and are explicitly permitted
(§6.2.1).

### 19.5 Time, dates and timezones

A platform with classes, events, reminders and three locales cannot treat time casually.

- **Authoritative instants are stored in UTC.** Security-relevant timestamps are
  **server-authoritative** and never taken from a client.
- A user's scheduling preference is an **IANA timezone identifier**, not an offset — an offset
  is wrong twice a year.
- **Events and classes preserve the timezone they were scheduled in**, because the intended
  local time is the fact, not the instant alone.
- **Daylight-saving behaviour is explicit**, and **ambiguous or non-existent local times**
  across a transition are handled deliberately rather than by whatever the library defaults to.
- **A date-only fact is not a fake midnight UTC timestamp.** A publication date, a birth year
  or an issue date is a date, and storing it as an instant shifts it across a timezone.
- Display is **locale-aware** across en/ur/ar, including duration formatting.
- **Rescheduling updates whatever was already scheduled against the old time** — a moved class
  does not fire yesterday's reminder (ARCHITECTURE.md §8.5).

### 19.6 Money

- **ISO currency codes**, always stored with the amount.
- An **exact representation**: integer minor units, or another exact database-safe decimal
  representation chosen by the owning payment phase. **Binary floating point is never used for
  money.**
- **Not every currency has two decimal places.** No code assumes it does.
- Provider-specific unit conversion lives **inside the provider adapter**, never in domain code.
- Sensible bounds are enforced, and **a refund may never exceed the captured or settled
  amount**.

### 19.7 Native slug history

> **A context that owns a resource with an editable public canonical slug owns that resource's
> slug history**, from the first phase in which the slug becomes editable.

Slugs are permanent and never reused; changing one creates a **301** from the previous slug
(ROUTE_MAP.md §1.4, §9.7). That behaviour is **native to the owning context** and is delivered
in the same phase as the editable slug — it is not deferred, and it does not wait for
Migration.

> **`LegacyMapping` is Migration-owned and maps *legacy source* URLs** (§16.1). It is **not**
> the platform's runtime slug-history mechanism. Using it as one would make every domain's
> ordinary rename depend on the Migration context, invert the dependency rules, and leave
> pre-migration renames with no redirect at all.

### 19.8 Concurrency on material mutations

Two operators acting on the same record is normal, and last-write-wins silently destroys one
of them.

**Material operator mutations carry expected-version or expected-state conflict handling**,
at minimum across: editorial revisions · Quran and Hadith administrative edits · Fatwa review
and publication · taxonomy changes · role and permission grants · high-value administrative
records · booking confirmation · financial state transitions · and migration promotion and
rollback.

**Rules:**

- **Approval binds to a specific reviewed revision.** Approving "the article" approves the
  version that was read.
- **An edit after approval invalidates or supersedes that approval**, according to the owner's
  workflow — so newly edited content cannot ride an old approval into publication.
- **Stale publish, stale unpublish/archive, and stale permission or grant updates are
  rejected**, not applied.
- **Booking confirmation prevents race conflicts**; two confirmations of one slot cannot both
  succeed.
- **Payment and refund transitions validate current state** before applying.
- **Migration rollback verifies the target has not materially diverged** since publication
  (MIGRATION_STRATEGY.md §7.2).
- **Bulk actions report per-item conflicts** rather than partially succeeding in silence.

**Last-write-wins is acceptable only for deliberately low-consequence preferences** — a
display setting, a collapsed panel. **No collaborative realtime editing is introduced.**

**A refusal and a failure to serialise are different answers and are never reported as the
same one.** "The invariant says no" is authoritative and final; "this transaction could not be
serialised well enough to ask" is transient, may be retried within a bounded number of
attempts, and is reported as a generic unavailability. Collapsing the second into the first
tells an operator that a rule forbids what they asked for when no rule was ever evaluated.

**A transaction that a cross-record invariant will test takes that invariant's serialisation
point before its first protected write**, not afterwards. An invariant enforced after the write
has already taken its locks makes two well-behaved transactions acquire the same two resources
in opposite orders, which is a deadlock rather than a decision.
