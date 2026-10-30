# Domain Model — One Minhaj Platform

**Status:** Living canonical baseline for the current accepted repository. Updated in the same
task as any accepted change that directly affects it (DELIVERY_PLAN.md §5.1).
**Origin:** Phase 0A Architecture Freeze, revised after independent architecture audit, and
revised continuously through the delivered phases.
**Document type:** Conceptual domain model. Conceptual sections remain conceptual; "As delivered"
sections record the accepted implementation of each owning phase. This document is not itself a
schema, migration or code.

This document describes bounded contexts, aggregates and relationships at a conceptual
level. Field lists are indicative of intent, not a schema specification. Physical modelling
belongs to the implementation phase of each owning slice: the physical schema lives in
`packages/database/prisma/schema.prisma` and its migrations, introduced by each owning phase.

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
| Editorial | Layer 0; Identity & Access; People & Contributors; Taxonomy; **Global Network**; **Media**; **Library** *(same-level edges — see §3.2)* |
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
  Global-owned Centre by typed identity (§17.1), and since Phase 14 an Event does the same.
  Editorial asks only Global's public reference interface; Global never imports Editorial, and a
  Centre page composing both is Layer 4 (§3.3).
- **Editorial depends on Media** because an Event owns its typed association to Media-owned
  Galleries (§7.2.3, Phase 14) and, since Phase 15, a Collection holds typed Video members
  (§7.3). Editorial asks only Media's public interfaces; Media never imports Editorial and holds
  no Event or Collection schema, and an Event's gallery view or a Collection page composing both
  is Layer 4 (§3.3).
- **Editorial depends on Library** because a Collection holds typed Work members (§7.3, Phase
  15). Editorial asks only Library's public Work reference reads whether a Work is public and
  what it is called now; Library never imports Editorial and holds no Collection schema, and a
  Collection page composing both is Layer 4 (§3.3).
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
| **Editorial → Global Network** | A NewsArticle revision — and, since Phase 14, an Event revision — carries a typed reference to a **Centre**, which Global Network owns (§17.1). Editorial asks Global's public reference interface whether a Centre may be chosen; it never reads Global's tables, and no Global data is copied into Editorial | **`Global Network → Editorial` is prohibited**: Global persistence never reads Editorial tables, and a Centre page composes Global's Centre with Editorial's own bounded centre-News and centre-Event reads at Layer 4 |
| **Editorial → Media** | Phase 14: an Event revision owns its typed, ordered association to **Galleries**, which Media owns (§7.2.3, §11). Since Phase 15 a Collection revision also holds typed **Video** members (§7.3). Editorial asks Media's public interfaces whether a Gallery may be associated or a Video is published and what it is called now; it never reads Media's tables, and no Gallery or Video data is copied into Editorial | **`Media → Editorial` is prohibited**: Media holds no Event or Collection column, table or code; an Event's gallery view and a Collection page compose Editorial's record with Media's public answers at Layer 4 |
| **Editorial → Library** | Phase 15: a Collection revision holds typed **Work** members, which Library owns (§7.3, §10.1). Editorial asks Library's public Work reference reads whether a Work is public now and what it is called; it never reads Library's tables, and no Work data is copied into Editorial | **`Library → Editorial` is prohibited**: Library holds no Collection column, table or code, and a Collection page composes Editorial's Collection with Library's public Works at Layer 4 |

**Rules:**
- **No implicit lateral imports.** A same-level dependency exists only if listed here, and
  only in the listed direction.
- **Acyclicity is preserved** by directedness: because `Learning → Messaging`,
  `Global Network → Editorial`, `Media → Editorial` and `Library → Editorial` are prohibited,
  no pair can form a cycle.
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

**Portrait (Phase 30-R).** *Historical, superseded:* Phase 5 deliberately gave a Person no
image, asset or URL until a phase owned profile media. Since the owner decision of 2026-10-29
(OPEN_DECISIONS.md §3.7) a Person may name ONE public **portrait** — a NO ACTION key to a stored
Storage `Asset` with its measured box and an optional credit — set through People's audited
`setPortrait` (`people.administer`), accepted only when Storage answers the asset is a servable
JPEG or PNG, and served only by People's own route while the Person is published. Never an
avatar URL, a remote reference or anything inferred from a face.

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
aggregate per sweep (Article, Page, since Phase 13 the four News families, since Phase 14
Event and since Phase 15 Collection), rechecking
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
- **One optional lead image, never a gallery (Phase 30-R).** *Historical, superseded:* at
  Phase 13 News had no image at all, and a lead image was reserved as an explicit dependency
  decision. The owner took that decision on 2026-10-29 (OPEN_DECISIONS.md §3.7): a NewsArticle
  or PressRelease **revision** — like an Article's and a Page's — may name ONE lead image, a NO
  ACTION key to a stored Storage `Asset` with its measured width and height and an optional
  credit, and each translation carries its alternative text (`leadAlt`). Choosing or changing it
  is an ordinary reviewed edit. Editorial accepts an asset only when Storage answers it is a
  servable JPEG or PNG (`servableImages`), and serves the bytes only through its own route while
  the record is published. Statement and MediaCoverage never carry one; still no Photo,
  Gallery, separate image table or remote image address.
- **No forward reference.** No Event, Centre, Collection or newsletter relation; centre-scoped
  News is Phase 16's Centre reference on these records.
- **No engagement state.** No view count, popularity score or featured flag; "latest" is the
  publication-instant order.
- **The archive and topic timelines read genuine publication instants** (UTC year and month),
  never a record's creation time, across all four families. *Since Phase 30-R* that instant is
  the root's **`chronologyAt`**: the published revision's **source publication date**
  (`sourcePublishedOn`, the original date a migrated record's source states, at UTC midnight)
  when it has one, else its first publication here. It is set by the workflow at publication
  and exists exactly when the record has been published (a CHECK); `publishedAt` remains the
  workflow fact. A migrated record is therefore never dated to its migration or approval.
- **Issuer and source changes are audited as their own events**, and no audit row carries a
  title, body, authoring document, issuer or source address.

#### 7.2.3 Event and EventSchedule — as delivered (Phase 14)

Event is an Editorial aggregate of its own — **not a News family, not a Global record and not a
Gallery** (§18: an Event occurs; News reports on it). It has the Article's shape of tables —
record, immutable revisions, revision translations, typed Topic (`EventTopic`) and Person
references, permanent slug reservations — and the same workflow, keys and edit-invalidates-approval
rule as every other workflow-governed aggregate. No `event.*` permission exists.

**What an Event owns is revision state.** Each revision carries:

| Fact | Shape |
|---|---|
| **Zone** | One IANA zone name for the revision, stored in the runtime's canonical spelling. `UTC` is accepted; an offset (`+05:00`), an abbreviation (`GMT`, `EST`) and `Etc/GMT±N` are refused, by the contract and by a SQL CHECK |
| **EventSchedule** | One to twelve occurrences, each the **intended local wall-clock start** and, optionally, end in that zone — the fact — and the UTC instants the server derived from them when the revision was written. Whole minutes; an end is strictly after its start; two occurrences never start at the same instant. A date-only occurrence is not modelled, so no date is ever faked as midnight UTC |
| **Centre** | One nullable, non-cascading reference to a Global-owned Centre (§17.1) — an Event need not belong to a Centre |
| **Galleries** | Up to twelve ordered, duplicate-free, non-cascading references to Media-owned Galleries (`EventGallery`), **owned by Editorial** |

**EventSchedule is not independently mutable.** Its rows are immutable with their revision, so
retiming an Event, changing its zone, moving it to another Centre or changing its Galleries is an
ordinary edit: a new revision, back to draft, approval and any publication schedule cleared, fresh
independent review — and each such change is audited as its own fact (`schedule-changed`,
`centre-changed`, `galleries-changed`) with no time, zone or name in the audit row. A current
revision without an occurrence is refused by the database (51146), so no Event is ever scheduled
or published without a genuine schedule. **The occurrence schedule is not the publication
schedule**: the shared workflow's "publish this revision at that instant" is unchanged.

**Daylight saving is never guessed.** A local time a zone skips (spring forward) is refused as
non-existent; one it repeats (fall back) is refused as ambiguous until the editor says which of
the two instants is meant. Resolution uses the runtime's own IANA data on the server; the browser
is never an authority.

**Upcoming, ongoing, past** are defined once: an Event is upcoming while some occurrence has not
ended (its end, or its start when it has none), ongoing while one has started and not ended, and
past only when every occurrence has ended. Ongoing Events are listed with the upcoming ones.
Classification uses the server's clock on each request.

**Location is the Centre's, never copied.** An Event names no venue text, coordinates or address;
where it is held is what Global says about its public Centre at render time. Geography filters
resolve, through Global, to the public Centres **physically** in a Country or City — never those
merely serving it, and never a virtual Centre — and Editorial matches the Event's own Centre
against them.

**Independent lifecycles.** Archiving a Centre or a Gallery changes no Event: a re-save may keep
the Centre or Galleries the current revision already names, but neither may be newly chosen once
archived; the public Event stays published, and the withdrawn Centre or Gallery is simply not
shown. Archiving an Event archives no Centre and no Gallery, and removing an association removes
no Gallery.

**Not searchable yet.** Phase 14 enters from 6, 12, 13 and 16, not 17, and its deliverables
promise no projection — the same posture as Phases 12 and 16 — so Events have no Search kind,
scope, filter or indexing intent; Phase 31 reconciles the final searchable inventory.

### 7.3 Collection — typed membership

A curated, ordered, described set that may contain items of **mixed type**: historical
tours, letters, campaigns, conferences, the terrorism-Fatwa material, Al-Hidayah material.

**CollectionItem membership uses typed relationships, not `targetType + targetId`**, for
exactly the reason given in §6.2.

**Rules:**
- A Collection **never owns content**; it references existing records. Deleting a Collection
  never deletes the material it curated.
- Editorial Collections are **distinct from a user's private saved collections** (§11).

#### 7.3.1 Collection — as delivered (Phase 15)

Collection is an Editorial aggregate of its own with the Article's shape of tables — record,
immutable revisions, revision translations (title, summary, SEO words and a sanitised body
describing the set), typed Topic (`CollectionTopic`) and Person (`CollectionContributor`)
references and permanent slug reservations — and the same workflow, keys and
edit-invalidates-approval rule as every other workflow-governed aggregate. No `collection.*`
permission exists, and no table, flag or code path is shared with Personalisation's future
`PrivateCollection`.

**The member inventory is exactly the prerequisites' content records** (DELIVERY_PLAN.md Phase
15: 6, 8, 10 and 13):

| Member type | Owner | Why it is a member |
|---|---|---|
| **Article** | Editorial (Phase 6) | Long-form written material — letters, essays, campaign writing |
| **NewsArticle · PressRelease · Statement · MediaCoverage** | Editorial (Phase 13) | The campaign, conference and statement archives §7.3 names are made of exactly these four families; each is a distinct aggregate with its own canonical page, so each has its own column |
| **Work** | Library (Phase 8) | The canonical book (`/library/books/{slug}`) |
| **Video** | Media (Phase 10) | The canonical watchable unit (`/watch/videos/{slug}`) |

**Deliberately not members:** a **Page** (organisational, legal and utility destinations, not
curated material); an **Edition** or **BookTranslation** (a manifestation of the Work that is the
canonical book); a **Series** or **Playlist** (already groupings of Videos); and every type no
prerequisite delivered — Event, Photo, Gallery, audio, the Phase-9 research and publication
families, Quran, Hadith, Fatwa, Learning, Centres, People and private collections. **A later
domain adds its own member column when it arrives** (DELIVERY_PLAN.md Phase 15); nothing is
reserved for it now.

**One place, one typed member, one order.** Each `CollectionItem` is one place in a revision's
single mixed order — its primary key is (Collection, revision, position) — and holds exactly one
member in one of seven nullable typed columns (`articleId`, `newsArticleId`, `pressReleaseId`,
`statementId`, `mediaCoverageId`, `workId`, `videoId`), each a real foreign key to its
owner's table with **NO ACTION**. The database refuses a place with no member or two (a CHECK
counting the seven), a second member at the same position whatever the types, the same record
twice in one revision (a filtered unique index per column), a position outside 0–99 (so at most
**100 members** — a Collection is read as one page and resolved with one bounded owner read per
type), and a current revision with **no member at all** (51156): an empty set is never reviewed,
scheduled or published. There is no `targetType + targetId`: a type with no column cannot be a
member.

**Membership is revision state.** Adding, removing or reordering a member is an ordinary edit — a
new revision, back to draft, approval and any schedule cleared — and is audited as its own fact
(`members-changed` for a different set, `members-reordered` for the same set in a new order, with
only the member count; `topics-changed`, `contributors-changed`). No audit row carries a title,
body or member title.

**Choosing a member is asking its owner.** A newly added member must be **public now** —
Editorial's own published predicate for Articles and News, Library's public Work predicate, Media's
published Video predicate — so an author never sees, learns of or links another owner's draft, and
`content.author` is no route into Library or Media drafts. A member the current revision already
holds may be kept on re-save whatever its owner says of it now. Editors pick members from bounded,
server-searched, human-labelled choices; the database, not the form, is the final word on order,
duplicates and the bound.

**Independent lifecycles.** Publishing or archiving a Collection publishes or archives nothing it
names; a target's withdrawal changes no Collection. A published Collection whose member is
withdrawn **stays published**: the member is **omitted** from the page — never its title,
summary or address — and the rest keep their order; when none is public any more the page says so
plainly. Nothing auto-archives and nothing is invented. Removing a member, revising or archiving
a Collection deletes and changes no target.

**Not searchable yet.** Phase 15 enters from 6, 8, 10 and 13, not 17, and its deliverables
promise no projection — the same posture as Phases 12, 14 and 16 — so Collections have no Search
kind, scope, filter or indexing intent; Phase 31 reconciles the final searchable inventory.

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
| The binary audio file (a Storage `Asset` per segment, §8.3) | **Storage abstraction** |
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

### 8.3 Quran — as delivered (Phase 18, engineering)

**Engineering implementation only.** No Quran text, translation, tafsir, transliteration,
recitation, Surah name, ayah count or Juz boundary is seeded or written anywhere in the
repository; the authoritative source, the approved layered works and their rights remain open
(OPEN_DECISIONS.md §1.1, §1.2, §2.4). Mechanisms are proven against controlled, unmistakably
non-authoritative fixtures.

**The citation is the identity.** A Surah is its number (1–114), a Juz its number (1–30) and an
Ayah the pair `(surahNumber, ayahNumber)` — the primary key, with no surrogate that could drift
from the citation. An Ayah names its Juz directly; a Juz's range is **derived** from its ayat and
never stored beside them. Hizb, page and sajdah markers are nullable and come only from a source.
Surah display names (`SurahName`, per interface locale) are presentation, not identity, and carry
their own version; no Surah, Ayah or Juz has a slug.

**Sources are registered, never chosen at runtime.** `QuranSource` (with `QuranSourceSurah` and
`QuranSourceAyah`, the source's own structure and exact text) records a source's code, title,
version, encoding (`utf-8`, the one the verifier implements), script and — for an `approved`
source, mandatorily — the external authority's evidence reference. `authority` is `fixture` or
`approved`. Sources are immutable and are written only by the owner/operator principal; the
application principal can read them and nothing else, so **no permission, label or checkbox can
create an authority or turn a fixture into one**.

**Activation is an operator act.** The corpus is public if and only if the single
`QuranActivation` row exists. Its trigger refuses an empty or incomplete corpus — the canonical
ayat must be exactly the activating source's, and every Surah's count must match — and refuses an
`approved` activation while any Ayah's text came from a fixture source. An active corpus is
frozen: no structure is added beneath it. A **fixture** activation exists for disposable proof
environments only: every public Quran page then says it shows non-authoritative engineering
fixture text, is `noindex`, and no sitemap lists it.

**Canonical text has one write path.** The application principal holds SELECT and nothing else
on `Juz`, `Surah` (except its display-name version), `Ayah`, `QuranAyahRevision` and
`QuranVerificationRun`. Canonical writes are two procedures, each of which re-checks in SQL that
the actor holds `quran.editCanonical` through a current assignment of an active role, is active,
and holds an unexpired step-up grant for the `quran-canonical-edit` purpose bound to a live
session of the same account — after the Quran service has already verified the Identity-minted
`PrivilegedActor`:

- **Corpus acceptance** materialises an empty canonical store **by copying the registered
  source's own rows**, after the database compares the candidate corpus to them byte for byte —
  exactly the source's ayat, once each, in the source's Juz, with identical text — and checks the
  source is a complete, contiguous structure. It never replaces or merges into an existing corpus.
- **Ayah correction** replaces one Ayah's text with a registered source's text for that Ayah, under
  the expected version, only if the operator's reviewed text is that source text exactly; a
  fixture source can never displace approved text or enter an approved public corpus.

Every canonical version, version 1 included, is an immutable `QuranAyahRevision` (text, source,
verification run, actor, step-up grant, reason); an Ayah update is refused unless its revision for
the new version exists and the version advances by exactly one. Every verification, passed or
failed, is immutable, content-free `QuranVerificationRun` evidence (counts, first mismatch
reference, code-point offset and reason). The generic audit record names the Ayah, versions,
source and run — never the text, which is held as the domain's own revision record
(SECURITY_BASELINE.md §13.4). There is no bulk canonical edit, no import UI and no automated
publication path.

**Exact comparison.** Verification compares Unicode code points, and the database compares UTF-16
bytes: no trimming, case or accent folding, normalisation form, tashkeel removal, letter or yeh
substitution, or collation equivalence can make two different texts equal. Transport decoding is
fatal UTF-8 that keeps a byte-order mark as a difference; malformed bytes and an undeclared encoding
are refused.

**Layered works are separate aggregates**, each with its own identity, immutable slug, content
Language (Taxonomy), lifecycle (draft, published, archived), version and optional registered
source: `QuranTranslation` + `QuranTranslationText` (one text per work and Ayah) +
`QuranTranslationContributor` (People: translator, editor); `QuranTransliteration` +
`QuranTransliterationText` (sourced text only — never derived from the Arabic); `QuranTafsir` +
`QuranTafsirText` (an entry over one Surah's contiguous range — the Surah is a single column
shared by both ends' foreign keys, so a cross-Surah range is unrepresentable; entries of one work
never overlap) + `QuranTafsirContributor` (author, translator, editor, compiler);
`QuranTajweedRule` + `QuranTajweedRuleText` (plain-text guidance per language — nothing is
annotated onto canonical text). Several coexist and **none is privileged**; a reader chooses.
**A layered work is public only while the corpus is active, it is published, and it names a
registered source** — and beside an approved corpus only an approved source will do. Publishing
therefore needs a source the operator registered, which is why `quran.administer` is not religious
approval. A published work keeps at least one text.

**Recitation is Quran's** (§8.1). `QuranRecitation` names its reciter as a People Person — which
grants nothing — with a style and attribution only where a source supplies them;
`QuranRecitationSegment` is one Storage `Asset` over one Surah's contiguous range (no overlap within
a recitation, a range fixed once created, one Asset per segment, a never-cascading key). A
published recitation always has audio. Media holds no recitation column, table or code;
`/listen/recitations` is a Layer-4 projection of Quran's public reader. Nothing is downloadable.

**Typed topic assignment.** `QuranTopic` targets the **Ayah** — the canonical citation unit —
with real foreign keys to the Ayah and the Topic. Surah-level assignment would be a separate typed
relation if ever needed; none is invented.

**Search.** One kind, `quran-ayah`, one scope per Ayah (a Surah can hold more ayat than a scope
may hold documents), identity `"{surah}:{ayah}"`. An Ayah's documents are its canonical Arabic and
one document per language of its public translation and transliteration texts, so several works
matching never multiply the canonical result and a translation is never presented as the Arabic.
Tafsir bodies are not indexed. Nothing is indexed while the corpus is inactive.

**No Personalisation state.** Reading progress, bookmarks and notes are Phase 21's; nothing here
anticipates them.

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

### 9.1 Hadith — as delivered (Phase 19, engineering)

**Engineering implementation only.** No Hadith text, translation, chain, narrator, grading, grader,
collection, edition, book or chapter is seeded or written anywhere in the repository; the
authoritative collections and editions, the reference-numbering policy, the grading authority, the
chain and source policy and the rights remain open (OPEN_DECISIONS.md §1.3, §1.5, §1.6, §2.4).
Mechanisms are proven against controlled, unmistakably non-authoritative fixtures.

**The source is the identity.** A `Hadith` row is a **source-qualified record**: its identity is
`(collection, source system, edition, source reference)`. `HadithSourceSystem` (`fixture` or
`approved`, with the authority's evidence reference mandatory for `approved`) and `HadithEdition`
(one edition of one collection as one source system carries it) are registered by the
owner/operator only and are immutable. The source reference is the source's own text — kept exactly,
compared by its bytes, refused rather than trimmed when padded or carrying a control character — and
it is unique only within its edition, so the same apparent number coexists in every edition of every
collection without colliding. A bare number is never a key.

**The public citation is a separate, reviewed mapping.** `HadithCitation` `(collection, number)`
names exactly one record, and only a record that declared that number as its intended citation
(`citationNumber`, enforced by a composite foreign key). Variants of one citation — other editions,
other source systems — coexist as further candidates. This reconciles ROUTE_MAP.md's
`/{locale}/hadith/{collectionSlug}/{hadithNumber}` with source-qualified identity: the URL addresses
the mapping, never the source key, and the numbering policy that decides which candidate a number
names is the external authority's (§1.3). A citation is mapped or withdrawn under an expected
version, and every change is an immutable `HadithCitationRevision`.

**Structure is sourced and per edition.** `HadithCollection` is the platform's namespace — a
source-independent slug chosen once (never one of the section's own path words) plus per-locale
display names under their own version. `HadithBook` belongs to one collection AND one edition;
`HadithChapter` to one book; each keeps the source's reference and title exactly and an immutable
slug. Two editions that divide a collection differently keep two structures, never merged by name.
A record sits in a book (and optionally a chapter) of its own edition. Books and chapters are never
Topics.

**Canonical facts have one write path.** The application principal holds SELECT and nothing else on
source, activation and canonical tables (and an UPDATE only of display-name versions). Canonical
writes are procedures, each re-checking in SQL a current `hadith.editCanonical` assignment of an
active role held by an active account and an unexpired step-up grant for the dedicated
`hadith-canonical-edit` purpose bound to a live session, after the Hadith service has verified the
Identity-minted `PrivilegedActor`: create collection, create book, create chapter, write record
(create or correct — every sourced fact of the new version supplied whole, with the evidence it rests
on and, for a correction, a reason), verify record, set citation. Every version, version 1 included,
is an immutable `HadithRevision`; a record update is refused unless its revision for the new version
holds exactly the new facts and the version advances by one. The generic audit names the record,
versions, edition and evidence counts — never the text, chain or grading.

**Gradings and chains are sourced data.** `HadithGrading` is what a named grader said — grader,
label in the grader's own words, label language and the published reference, all four mandatory — for
one version of one record, immutable; there is no grade vocabulary, rank or equivalence, and a
grader is named once per version. The chain is the source's own text (with its language) on the
record; no narrator is parsed, inferred, linked to People or modelled — there is no Narrator table.

**Human verification precedes publication.** `HadithVerification` binds one version of one record,
with evidence, actor and step-up grant. A correction creates a new version that no earlier
verification covers, so a stale verification never authorises changed text.

**Conflicts are escalated, never resolved.** Whenever a record is written the database compares it,
byte for byte, with every other candidate for the same citation: text (and its language), chain,
each shared grader's grading, and — within one edition only, since each edition keeps its own
structure — book and chapter placement. Each disagreement is an immutable `HadithConflict` row naming
both versions and the facets. A citation with conflict evidence cannot be mapped and is not public.
Nothing in the platform resolves a conflict: who decides is OPEN_DECISIONS.md §1.6. Until that
process exists, recorded evidence blocks its citation permanently — even if both candidates are
later corrected to agree, because evidence is never deleted or re-judged by the platform.

**Activation is an operator act.** A collection is public if and only if its `HadithActivation` row
exists. Every activation shares one authority, an empty collection cannot be activated, and every
mapped record's source must share the activation's authority: an `approved` collection refuses
fixture text, and a `fixture` collection refuses approved text, which its non-authoritative notice
would otherwise misdescribe. A citation is public only while its collection is active, it is
mapped, it carries no conflict evidence, its record is verified at its current version, and its
record's source shares the section's authority. Fixture activation exists for disposable proof
environments only.

**Layered records are separate.** `HadithTranslation` (+ contributors: translator, editor) is one
record's translation into one content language; several coexist and none is privileged.
`HadithCommentary` is a commentary work (immutable slug, language, contributors: author, translator,
editor, compiler) with at most one `HadithCommentaryEntry` per record. `HadithScience` is study
material (immutable slug, plain-text title and body per language) — never a canonical record and
never a grading authority. Each is draft, published or archived, administered under
`hadith.administer`, and public only while its parent is public, it is published and it names a
registered source system of the section's own authority. No layered record can expose a hidden
record, and withdrawing a translation never withdraws the record.

**Typed topic assignment.** `HadithTopic` targets the source-qualified record with real foreign keys
to the record and the Topic.

**Search.** One kind, `hadith`, one scope per public citation (identity: the citation's own id): the
record's original text and one document per language of its public translations, so another
edition's variant, a conflicting candidate or a translation never becomes a competing result. Chains,
gradings, commentary and conflict evidence are not indexed. Nothing is indexed while no citation is
public.

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
- **Covers (Phase 30-R).** An Edition's cover — and a MagazineIssue's — is ONE optional NO
  ACTION key to a stored Storage `Asset` with its measured box, accepted only as a servable
  JPEG or PNG, kept when an update omits it and cleared only by an explicit `null`, and served
  by Library's own routes only while the Edition and its Work (or the issue and its Magazine)
  are published. A Work shows the cover of its first published Edition that has one; a
  Magazine its newest public issue's.

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
- For Video, provider metadata is stored and the provider player embedded. **No video files are
  hosted.** Non-Quran audio is not a provider reference: an AudioTrack's file is a storage-backed
  `Asset` (Phase 11, below).
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

**First-party poster (Phase 30-R).** A Video may also name ONE **poster** — a NO ACTION key to a
stored Storage `Asset` with its measured box, accepted only as a servable JPEG or PNG and kept
when an update omits it. It is the organisation's own picture of the video (a migrated one comes
from the source page's own image, never from the provider), served by Media's own route while the
Video is published, so a card or the click-to-load gate shows a real picture with **no provider
request** before the visitor's click. The provider `thumbnailUrl` stays structured-data metadata
only.

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
  no kind: the Event↔Gallery association is Phase 14's, owned there once both ends exist. As
  delivered, it is Editorial's `EventGallery` (§7.2.3); Media still holds no Event column, table
  or code, and answers only its reference and public reads.
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

### 12.1 As delivered (Phase 20 — engineering; no real authority is granted)

The context is built and proven against unmistakably synthetic `NON_FATWA_FIXTURE_*` material.
**No ruling, question, category or activation is seeded, and nobody holds a Fatwa permission**
(OPEN_DECISIONS.md §1.4 and §6.3 stay open). Engineering completion is never "Fatwa authority
approved".

| Aggregate | What it holds — and deliberately does not |
|---|---|
| **FatwaActivation** | An operator-only singleton (`fixture` or `approved`, an `approved` row carrying the organisation's evidence reference). With no row the service accepts no question, publishes nothing and every public Fatwa page says the service is not available. The runtime can read it and nothing else; it is immutable |
| **FatwaCategory** | Immutable slug, one **typed foreign key to a canonical Topic**, position, `active`/`archived`, display names per interface locale. Never deleted; maintained under `fatwa.publish` |
| **FatwaQuestion** | The asker's account (real FK to `User`), the asker's own words, status, category, the current assignee and the workflow facts (who triaged, assigned or declined, and when). **No name, address, phone or contact detail is copied from the account.** Its text is erased at account closure |
| **Fatwa** | One per question: its slug, review state (`drafting`, `in_review`, `returned` or none), the pending revision, the current **published** revision, first publication and withdrawal instants |
| **FatwaRevision** | Every saved draft, **never edited**: title, the **separately written anonymised public question**, the ruling, content language (FK `Language`), category, author, and — for a correction — the public correction reason. The original question is never copied here |
| **FatwaRevisionTopic** | The typed `FatwaTopic` junction of §6.2, per revision, so a correction is reviewed with its topics and history keeps what was published |
| **FatwaPublication** | Each publication of a revision, never edited: sequence, publisher, the step-up grant used, and the published contributor records the publisher's and drafter's accounts were linked to at that moment, if any |
| **FatwaReviewDecision** | A return to the drafter or a withdrawal, never edited; its note is private |
| **FatwaReadTally** | Anonymous reads per ruling per UTC day — a count and nothing else |

**Lifecycle.** The question owns `submitted → triaged → assigned → answered`, and
`declined` or `closed` (account closure) before an answer. Drafting and review are the ruling's:
a save is a new revision and moves it to `drafting`; the assignee submits the exact pending
revision (`in_review`); a `fatwa.publish` holder returns it (`returned`, with a private note) or
publishes it. The canonical §12 lifecycle — submitted, triaged, assigned, drafted, scholar review,
published, declined, returned — is **derived** from those two owners' facts, so it cannot disagree
with them. The asker sees only `received`, `in progress`, `answered`, `declined` or `closed`.
Every transition carries an expected version.

**Stages and keys.** `question.receive` triages: it reads questions still in intake, categorises,
assigns to an account that holds `fatwa.answer` **now** and is not the asker, and declines.
`fatwa.answer` drafts, and only for a question assigned to the actor **now** — a reassigned or
revoked answerer loses access on the next request. `fatwa.publish` reviews, returns, publishes,
corrects and withdraws, each publication and withdrawal behind the dedicated `fatwa-publication`
step-up; it reads a private question only while that question's ruling is under its review. No
key implies another, and none is in the protected Platform Administrator bundle
(SECURITY_BASELINE.md §3.2.1).

**Separation of duties — a fail-closed engineering default, not a Minhaj policy.** The author of a
revision cannot publish that revision, and the asker cannot publish the ruling on their own
question. There is no administrator exception. The organisation's real triage, approval and
sensitive-question escalation process is OPEN_DECISIONS.md §1.4; nothing here pretends to be it.

**Public versus private.** Only a published revision is public, and only its public fields: title,
anonymised public question, ruling, category, topics, language, publication and correction
instants, the visible history of earlier published revisions with their correction reasons, and
attribution to a **published** contributor record where the acting account was linked to one
(§5) — a profile alone grants nothing and is never authority. Anonymisation is a person writing a
separate field; **nothing rewrites, redacts, detects names in or summarises text**, and the
original question never reaches a public page, Search, a sitemap, metadata, a log or an audit
payload.

**Corrections and withdrawal.** A correction is a new revision with a public reason, reviewed
again and published again under fresh step-up; the URL stays the same and earlier versions remain
visible on it. The slug may change while a ruling has never been published and **freezes at first
publication**, so no slug history is owed. Withdrawal (same authority) removes the ruling from public
view and from Search, keeps every revision and keeps the slug reserved; nothing is ever deleted.

**Topics.** A ruling is on Topic T when its current published revision lists T or its category maps
to T. `/fatwa?topic=` and `/fatwa/topics/{slug}` read exactly that; Search projects the same set.

**`sort=popular` — exact semantics.** Anonymous reads over the trailing 30 UTC days, most first; ties
by first publication instant (newest first), then id. A read is counted by a POST the ruling page
sends after it renders — never by a GET — at most once per network address per ruling per 30
minutes, enforced by the platform's existing limiter (which keeps only a keyed digest, until its
window expires). The tally stores no account, address, cookie, fingerprint or user agent and
writes no audit row. `latest` is first publication instant, newest first, with the same tie-break.

**Account closure.** After Identity commits, Fatwa — in its own transaction — erases the private
text of the closed account's questions and closes those not yet answered or declined; published
rulings never held the question and are unaffected. The disposition is idempotent, refuses an
account that is not closed, and a bounded sweep finishes an interrupted closure (§4.6,
SECURITY_BASELINE.md §19.1). No jurisdiction-specific retention period is invented.

**Not delivered, and not owed by Phase 20:** attachments (no Storage dependency), messaging between
asker and scholar (Phase 24), notifications (Phase 21), consent-to-reveal-identity, import of
published rulings (Phase 30 must call the same publication operation), and any real grant.

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

**Class recording is out of scope for V1.** Class metadata and history are in scope, delivered by
Phase 23 (§13.5).

### 13.2 Teaching authorisation

A **TeacherProfile** (owned by People & Contributors) confers **no privilege**. Teaching
requires an auditable **RoleAssignment** granting `teaching.perform`, optionally scoped to
specific courses. Approval creates that assignment; revocation removes it — and revocation
**immediately** affects messaging authorisation (§12.3 of this document's Messaging section).

### 13.3 Enrolment vs Booking

Distinct lifecycles. A trial booking (requested → confirmed → completed/cancelled) precedes
and is independent of course enrolment.

### 13.4 As delivered (Phase 22 — courses and paths; nothing that schedules)

The context's first slice is built and proven against synthetic `NON_LEARNING_FIXTURE_*` material
and `.invalid` accounts; **nothing is seeded** — no Course, path, enrolment or request. It depends on
Layer 0 and, through Layer-4 answers, on People and Taxonomy only: the allowlist's Media, Library and
Global Network edges are **not taken**, because nothing delivered needs a Video, Work, Asset or Centre
relation (DELIVERY_PLAN.md Phase 22). **The Phase 22 / Phase 23 boundary:** ClassSession, Availability,
Attendance and Booking have **no table, column or code**; no meeting provider or address can be
stored; and `teaching.perform` is not catalogued (OPEN_DECISIONS.md §6.3 stays open).

| Aggregate | What it holds — and deliberately does not |
|---|---|
| **Course** | Editable slug with **native slug history** (`CourseSlugHistory`, written by a trigger, never freed), primary locale, lifecycle `draft` / `published` / `archived`, **level** (`beginner`, `intermediate`, `advanced` or not stated) and **format** (`self-paced` or `live`) — Learning's own small catalogue facets, not an external scholarly classification — content language (FK `Language`), typed topics (`CourseTopic`, FK `Topic`), ordered **teachers** (`CourseTeacher`, FK `Person`), the latest publication instant and an expected version. Localised title, summary and description per interface locale. No price, duration, rating, certificate, enrolment cap or enrolment count |
| **CourseModule** / **Lesson** | Ordered modules of a Course and ordered lessons of a module, dense unique positions, localised title and summary; a lesson also has a **plain-text body**. A lesson's key to its module carries the Course, so a lesson can never sit in another Course's module. Bounded: 20 modules, 30 lessons each |
| **LearningPath** | Editable slug with its own slug history, lifecycle, localised words, and an ordered list of distinct Courses (`LearningPathCourse`, at most 30) |
| **Enrolment** | One per account and Course — the account and the instant, nothing copied from the account. Not a booking, a class, a payment or an entitlement |
| **Progress** (`LessonProgress`) | One row per account and **completed lesson**, both keys carrying the Course — to the Enrolment and to the Lesson — so progress can only name a lesson of the Course the person is enrolled on |
| **TrialClassRequest** | The **request side only**: the account, one published `live` Course and the instant; one per account and Course. It reserves no teacher, names no time, creates no booking or class, confers no enrolment and has no confirmed state |

**Publication keeps the public catalogue whole.** Publishing a Course requires a complete syllabus —
at least one module, every module with a lesson, and the primary-locale words on the Course, each
module and each lesson. **While a Course is published its syllabus is frozen**: modules and lessons
change only after returning it to draft, so the public never reads a half-built outline — the
Editorial precedent that an edit withdraws the published representation (§7.2.1), applied to the
outline rather than imported as a workflow. A published path holds at least one Course and only
published Courses, so **a Course cannot leave publication while a published path holds it**; the
operator updates or unpublishes the path first. Each rule is checked by the adapter under the lock it
needs and enforced again by the database (refusals 51270–51277). Normal removal is archiving: a
Course is never deleted, so the Enrolments and Progress on it outlive its withdrawal.

**Teacher attribution grants nothing.** A Course names published People as its teachers for the
public catalogue and the `?teacher=` filter; it is never consulted for any authority, and no
TeacherProfile, attribution or Learning key can reach a learner or a class (§13.2).

**Lessons are read by enrolled learners.** The public Course page shows the description and the
syllabus — module and lesson titles and summaries — and the lesson bodies are read in My Learning by a
person enrolled on the published Course.

**A person's own study.** Enrolling is self-service, requires an account and a Course published now
(decided under a lock the Course's own lifecycle change waits for), and is idempotent. Leaving removes
the person's Enrolment and their Progress on that Course. A lesson is completed only by an explicit
act — never by a page view — idempotently and monotonically: the first instant is kept and nothing
un-completes it. **Course completion is derived** — every current lesson completed. **Path progress
is derived** from the person's own Course Enrolments and Progress; there is no PathEnrolment.
Withdrawing a trial request deletes it. When a Course is archived or returned to draft its learners
keep their Enrolment and Progress, and My Learning says the Course is not currently available.

**Staff see counts, never learners.** `learning.read` and `learning.administer` (ordinary keys in the
protected Platform Administrator bundle) govern the catalogue; the Learning administration shows how
many accounts are enrolled on and have completed each Course and how many trial requests each live
Course holds — never who. No key edits anybody's Progress or confirms a request.

**Search, export and closure.** Published Courses and paths are the `course` and `learning-path`
kinds; a Course document carries its words and public syllabus, never a lesson body. Learning exports
the person's Enrolments, Progress and requests as typed identifiers and, after Identity commits a
closure, deletes them in bounded, idempotent batches (SECURITY_BASELINE.md §19.1.3); a Course or path
is never deleted because an editor's account closed.

**Not delivered, and not owed by Phase 22:** ClassSession, Availability, Attendance, Booking and the
confirmation of a trial request; teacher authority and the teacher area; My Classes and My Teachers;
certificates, assessments, grades, payments and entitlements; under-18 rules (OPEN_DECISIONS.md §2.1
stays open); and any import of real courses (Phase 30). Phase 23 delivered the first group (§13.5).

### 13.5 As delivered (Phase 23 — teacher experience and live classes; engineering only)

The context's second slice is built and proven against synthetic `NON_LEARNING_FIXTURE_*` material
and `.invalid` accounts; **nothing is seeded, nothing is activated and nobody holds `teaching.perform`.**
It adds no dependency edge: Identity answers live authority and People answers public teacher facts
through their public interfaces at Layer 4, and Learning reads neither owner's tables.

**The activation gate is a row, not prose.** `LiveLearningActivation` holds at most one row — `fixture`
or `approved`, the latter only with recorded evidence — written by the owner/operator alone (the
runtime holds SELECT), immutable once written (51280). With no row live learning is OFF: no window,
session or Booking can be inserted and no scheduled session can move, be re-addressed or re-assigned
(51281); closing a session is always allowed. The persistent database holds no row. An `approved` row
records the organisation's decisions under OPEN_DECISIONS.md §2.1, §5.3 and §6.3, which this slice
does not make.

| Aggregate | What it holds — and deliberately does not |
|---|---|
| **CourseTeachingAssignment** (the typed teaching scope) | Course, account and the **exact Identity RoleAssignment** that carried `teaching.perform` when the scope was made, with a grant instant and an optional end. **Current** means `endedAt` is null **and** Identity still reports that assignment live — re-read on every request. One current scope per account and Course (filtered unique key). Made only for a live-format Course under the account's own live assignment (51282); never deleted, so what was taught stays as history that grants nothing. No `scopeType`/`scopeId` |
| **Availability** | One bookable window a teacher offers: UTC instants plus the IANA zone and the wall-clock start and end it was offered in; `open` or `withdrawn`. Fifteen minutes to eight hours; a teacher's open windows never overlap (51283); offered only while activated, by an account holding live `teaching.perform` (51284). A confirmed Booking claims the whole window |
| **ClassSession** | A `course` session or a single-participant `trial`, on a **published live Course under a current scope of that Course** (the composite key carries the Course; 51285). UTC start and end plus the scheduling zone and locals, `scheduled` / `completed` / `cancelled`, an optional reminder instant, the meeting provider and address while scheduled, an expected version. A terminal session never changes or returns to scheduled (51286); one teacher's scheduled sessions never overlap (51287). Rescheduling is a versioned mutation with its audit row, not a state |
| **Booking** | The confirmation of exactly one Phase-22 TrialClassRequest: the request's own learner and Course, one trial session, one window — one per request, one per session, and **one live claim per window** (filtered unique key, the slot two confirmations race for). `confirmed` / `cancelled` / `completed`; must fit its request, session and window exactly (51288). **Distinct from Enrolment: it enrols nobody.** A request a Booking names can no longer be withdrawn by deletion (the key refuses it); cancellation is the Booking's own act |
| **Attendance** | One `present` / `absent` mark per session and participant, by the current teacher or a narrowly justified operator correction; only on a session not cancelled, for a participant eligible now (51289). No note, grade, score or free text — and no `TeacherStudentNote` exists, because no accepted contract defines one |
| **ClassCommunicationIntent** | Learning's durable service-mail intent: purpose, session, recipient account, due instant and idempotency key — never a body, an address or a meeting link. Pending → relayed or abandoned, once (51292) |

**Who is a teacher.** A TeacherProfile, a Course's `CourseTeacher` attribution and a role name grant
nothing. A teacher operation requires, on every request, **both** a live `teaching.perform`
RoleAssignment — catalogued by this phase, externally gated, bundled into no role — **and** a current
typed scope on the exact Course made under one of those assignments. Identity's revocation therefore
wins immediately: the Teacher area, the students, the sessions, the windows and every meeting address
close on the next request, while the scope row remains as safe history. An operator holding
`learning.classes.administer` may scope only an account Identity already reports live and People
reports linked to a published Person with an active TeacherProfile; the operator cannot grant the key.
A scope's end makes its future sessions **replacement-required**: an operator moves each to another
current scope of the same Course (audited old and new), or cancels it.

**Time** follows §19.5: instants in UTC, the scheduling zone and wall-clock times kept beside them, a
wall time the zone skips refused, one it repeats resolved only by an explicit choice, and a moved
class keeping its intended local time.

**The meeting address** is a validated string for the one V1 provider: HTTPS, host exactly
`meet.google.com`, a meeting code, no credential, port, query, fragment, backslash or escape — parsed
by the standard parser after the raw text is checked, canonicalised, and consistent with its provider
(SECURITY_BASELINE.md §11). It is held only while the session is scheduled and is **NULL by CHECK once
completed or cancelled**. It is disclosed by exactly one operation per surface — to the session's
current teacher, to a current participant (a confirmed trial Booking or a current Enrolment on a
published Course), and to `learning.classes.read` — only while activated and the session scheduled,
and it appears in no listing, log, audit row, export or email.

**Reminders and service mail** follow ARCHITECTURE.md §4.6.1: a confirmation, a reschedule, a
cancellation and a reminder commit intents in the same transaction as the class change; the Layer-4
dispatcher relays them through the shared delivery rows after Learning re-checks what is still owed
and Identity resolves each recipient's current address and locale. **No fixed reminder lead is a
product promise:** the scheduler chooses one of 60, 180 or 1,440 minutes, or none, per session; a move
keeps the lead, abandons the old intent and commits a new one, so the old time never fires. A
withdrawn learner, a cancelled Booking, a replaced or revoked teacher and a closed account are owed
nothing at dispatch. Every message links to the person's own private class page, never to the address.

**No-show** is derived, not stored: a trial participant marked `absent` on a completed session — or
unmarked — is the no-show; no Booking state and no subsystem exists for it.

**Public surfaces.** `/learn/live` lists upcoming scheduled sessions on published live Courses under
current scopes, with the Course and the teacher's public People profile, while activated; a `fixture`
activation is shown as a test state. `/learn/teachers` lists accounts holding a current scope on a
published live Course that Identity reports live for `teaching.perform` and People reports with a
published TeacherProfile; `availability=available` means at least one future open, unbooked window.
Neither shows a participant, a window's times, a Booking or an address, and neither is sitemap
material. Catalogue attribution stays what it was: a Course names its teachers whether or not they are
currently operational.

**Export and closure** (SECURITY_BASELINE.md §19.1.4): the person's own Bookings, class participation,
Attendance, windows and scopes by typed identifier; a closed learner's future Bookings and trial
sessions cancelled, their Attendance and intents removed; a closed teacher's current scopes ended,
their windows removed and their future sessions left replacement-required. No ClassSession or scope is
ever deleted, and no other participant's history is touched.

**Not delivered, and not owed by Phase 23:** messaging of any kind, `/teacher/messages`, Google
Calendar or Meet API provisioning, recording, certificates, assessments, grades, payments, teacher
notes on learners, repeat-trial policy, and every policy OPEN_DECISIONS.md §2.1 reserves.

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
| ReadingProgress | The Quran reading position. **Course progress is Learning's** (§13; `/my/progress/courses`, Phase 22) — never this context's |
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

### 14.6 As delivered (Phase 21 — engineering)

The context is built and proven against synthetic `NON_PERSONALISATION_FIXTURE_*` material and
`.invalid` accounts; **nothing is seeded**. It depends on Layer 0 and Identity & Access only — no
content context is imported anywhere in it. Content is held by typed foreign key and resolved at Layer
4 through each owner's public reader (Editorial for Articles, Library for Works, Media for Videos,
Quran for Ayat, Hadith for citations), batched by owner. **OPEN_DECISIONS.md §2.2 stays open**: no
retention period, legal hold, residency rule, statutory deadline or age rule is invented.

**The saveable vocabulary is exactly what INFORMATION_ARCHITECTURE.md §5 promises:** Quran **Ayah**
(by its canonical `(surah, ayah)` identity), Hadith **HadithCitation** (the public citation, never a
source-qualified record), **Article**, **Video** and **Work** (a book). Reading history covers the four
readable kinds; watch history covers Video. Fatwa, News, Events, Audio, Galleries, Courses and Centres
are not saveable; appending one is a typed column and a migration, never a string.

| Aggregate | What it holds — and deliberately does not |
|---|---|
| **SavedItem** | The account's typed anchor on **exactly one** target: one nullable foreign key per kind, a CHECK that exactly one is set (an Ayah takes both its columns or neither), and filtered unique indexes so an account holds a target once. The kind is **inferred from the key that is set** — there is no type column. No title, status or text of the target. It exists only while a bookmark, note or collection membership needs it and is removed in the same transaction as the last one |
| **Bookmark** | The explicit "saved" mark on one SavedItem. Idempotent to add and remove |
| **Note** | A private plain-text annotation on one SavedItem (≤ 2,000 characters, versioned). Never logged, indexed, audited or shown to anyone but its owner |
| **PrivateCollection** / **PrivateCollectionItem** | A person's own titled list (≤ 50 per account, ≤ 200 members, versioned). Members point at the owner's own SavedItems — both keys carry the owner, so a member cannot join someone else's item. One contiguous order, replaced whole under the version that was read. No slug, sharing or public page; distinct from an editorial Collection |
| **ReadingHistory** / **WatchHistory** | **One row per account and target** — first and latest instant, nothing else; not an event stream. Only the newest 500 of each list are kept. **History is off until the person turns it on**; while off nothing is recorded, decided inside the write. Instants are the server's, and a late request never moves a newer instant backwards |
| **QuranReadingProgress** | The account's one Quran position — a typed Ayah, versioned. It moves **only** when the reader chooses "Set as my reading position" under the version they read, so no page view, late beacon or replay can rewind it. No streaks and no completion claims |
| **PersonalisationProfile** / **Interest** / **Goal** | Personalisation onboarding: explicit interests (public areas — Quran, Hadith, Library, Watch, Listen, Fatwa, News & Events, Global Network) and goals, plus the history switch. Optional, skippable, editable later and never a gate. Nothing is inferred from behaviour and nothing sensitive is asked. Learner level and preferred format are **not** collected: no delivered surface uses them. Phase 22 delivered Course level and format as public catalogue filters a visitor chooses on each visit (§13.4), which need no stored preference, so they still are not collected; they arrive only with a surface that genuinely uses a stored preference |
| **NotificationPreference** | A departure from the default for one category on one channel. Category `questions` (updates on the person's own Fatwa questions) on channel `in-app`, **on by default**. There is **no email notification channel**: nothing here is emailed, so no setting can reach Identity's verification, reset or security mail |
| **Notification** | System-generated, one-directional, one account's: a translatable **kind** (`question-answered`, `question-declined`), its category, an optional **same-site path** (a CHECK and the service refuse schemes, hosts, protocol-relative and backslash forms, encoding, queries and dot segments), an idempotency key unique per account, created and read instants. Only the newest 200 are kept. Not a Message: no reply, participant or thread |
| **NewsletterSubscriber** / **NewsletterConsentEvent** | §14.5 as built — below |

**Notification producers.** Producers are Layer 4 and call the context's narrow `produce` service with
the account their owner decided is concerned, a kind, a same-site destination and an idempotency key;
no visitor-facing endpoint can create one. The one producer today is Fatwa: after a decline or a
publication commits, Fatwa's workflow returns the asker's account id (a narrow read added for this) and
Layer 4 notifies them, keyed by question. Only a ruling's FIRST publication names an asker, so a
correction never repeats it, and a failed lookup after the committed decision is logged and never
reported as the decision failing. It is derived work — not
atomic with the decision — and the asker's own question page shows the status regardless.

**The newsletter as built.** One row per address, keyed by an HMAC digest of the address as Identity
compares addresses (`canonicaliseEmail` — trimmed and lower-cased, no provider rewriting), so concurrent
submissions serialise on it. **No relation to `User` exists**: registering never subscribes, and
closing an account never unsubscribes, whatever the address. States are `pending`, `confirmed`,
`unsubscribed`, `expired` (a lapsed confirmation window) and `suppressed` (an operator decision), and a
CHECK fixes what each may hold — only `pending` and `confirmed` keep the address. Each submission
issues two single-purpose link tokens, `HMAC(NEWSLETTER_TOKEN_KEY, purpose | subscriber | generation |
salt)` over fresh random salts; **only their SHA-256 hashes and the salts are stored**, and the
dispatcher re-derives the same link for a retried message, so nothing mints a second token. The
confirmation link works for 48 hours (a security bound, not a retention period) and is consumed once
by a POST whose predicate is the check; resubmission rotates both links. Unsubscribing needs no
account and is idempotent. A suppressed or provider-suppressed address is never written to and cannot
be confirmed, and every submission answers the same whatever the state. Consent evidence — purpose
`newsletter`, notice version, source, locale and instant of every change — is append-only (a trigger
refuses any change). Lapsed confirmations lose their address in a bounded sweep.

**Account closure.** After Identity commits, Layer 4 asks Personalisation — in its own bounded,
idempotent batches — to delete every row of the closed account: saved items with their bookmarks and
notes, collections and members, history, Quran position, onboarding answers, preferences and
notifications. It refuses an account Identity does not report closed. Newsletter subscriptions are not
touched. The closure response says "pending" honestly while any owner's work remains, and a bounded
sweep (with People's and Fatwa's reconciliations) finishes interrupted closures. A later account with
the same address starts empty.

**Hard purge participation (§14.3).** Every typed key to content is `NO ACTION`, so a physical delete
of a referenced Article, Work or Video is refused by the database while any reference remains.
Personalisation offers one **typed** release per target family — Article, Work, Video, Ayah,
HadithCitation — each removing a bounded batch of its own references (collection members, anchors with
their bookmarks and notes, history, Quran position), bumping affected collections' versions and
returning how many remain; zero is the owner's signal to delete. There is no generic `purge(type,
id)`. Ayat and Hadith citations are never physically deleted by their owners (their triggers refuse
it); their releases exist so a future owner-approved purge has the same contract. No owner offers a
hard purge yet, so no purge workflow is wired to a surface.

**Not delivered, and not owed by Phase 21:** course progress and any Course, Lesson or LearningPath
reference (Learning's, delivered in Phase 22 — §13.4); audio listening history; emailed notifications; campaign sending, segmentation
or any marketing automation; saved Fatwa rulings; and any staff access to a person's saved items,
notes, history or notifications — no permission grants it.

---

## 15. Messaging

**Conversation** · **ConversationParticipant** · **Message** · **MessageAttachment** ·
**MessageReadState** · **Block** · **Report** · moderation records.

### 15.1 Single ownership

> **Messaging is the one owner of conversations, participants, message creation,
> authorisation invariants, blocking, and assignment/enrolment checks.**

**Ownership is unaffected by where an implementation is hosted.** Selected Messaging
application services are exported through `packages/server-core` so that both the web process
and the realtime transport (delivered in Phase 25, §15.7) call the same implementation. That
package is a **server-only host and export surface — not a bounded context, not a second domain layer, and
not an owner of any rule** (ARCHITECTURE.md §3.1). **Messaging remains the semantic owner**
and the only place these rules may change.

Hosting follows the admission rule of ARCHITECTURE.md §3.1.3, and a hosted service **never
returns raw persistence capability** to its caller. It persists internally through Messaging's
own persistence port, whose adapter — wherever it is physically implemented — remains owned by
Messaging (ARCHITECTURE.md §3.1.1).

The realtime process (Phase 25) is a **transport, presence and event-delivery adapter**. It does
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

### 15.6 As delivered (Phase 24 — non-realtime messaging; engineering only)

Built and proven against synthetic `NON_MESSAGING_FIXTURE_*` material and `.invalid` accounts;
**nothing is seeded, nothing is activated and nobody holds `messaging.support` or
`messaging.moderate`.** The context's application services live in
`packages/server-core/src/messaging` (ARCHITECTURE.md §3.1.3), its adapter in
`packages/database/src/adapters/messaging`, its contracts in `@minhaj/contracts/messaging`; there is
no `apps/web/src/contexts/messaging`, because every operation depends on the one access decision
the realtime process will also need. It adds no dependency edge: Learning answers the current
relationship through a Learning-owned reader hosted in `server-core/relationships`, Identity answers
live keys and closed accounts at Layer 4, and Messaging reads none of their tables. **Phase 25 adds
a transport over the same services and no table.**

**The activation gate is a row per kind.** `MessagingActivation` holds at most one row for each of
`support`, `teacher-student` and `student-student` — `fixture` or `approved`, the latter only with
its evidence reference — written by the owner/operator alone (the runtime holds SELECT), immutable
(51300). Without its kind's row no conversation of that kind can be created (51302) and no message
written (51303), and the service refuses every read and write of it. The persistent database holds
no row. Student-to-student additionally needs the peer-policy seam, whose production wiring denies
every pair (OPEN_DECISIONS.md §2.5).

| Aggregate | What it holds — and deliberately does not |
|---|---|
| **Conversation** | A controlled `kind`. A **direct** conversation names its Course and its two accounts in binary order (CHECK), one per kind, Course and pair (filtered unique key); a **support** conversation names the person asking, one open at a time (filtered unique key). `open` / `closed` with a reason — `account-closed`, `moderation` or `resolved` (support only) — a never-cleared disposal mark, the last allocated sequence and the activity instant. No relationship type or id, no Course title, no name or address |
| **ConversationParticipant** | Account, role (`teacher`, `learner`, `peer`, `requester`, `support`), joined and left instants. One per account and conversation; one teacher, one learner and one requester; at most one active support claim. Its role must fit the kind and the accounts the conversation names (51301). **History, never authority** |
| **Message** | Sequence, sender, client operation id, plain-text body (≤ 4,000 code points), payload digest, moderation state (`visible` / `withheld`) and the server's instant. Unique `(conversation, sequence)` and `(conversation, sender, operation)`. Written only to an open, activated conversation by a current participant at the sequence just allocated (51303); never rewritten, never returned to view once withheld (51304); removed only by disposal (51305) |
| **MessageAttachment** | A file a participant uploaded into a conversation, recorded **before** its bytes are stored, with the release token they are stored under: `pending` → `ready` (Storage's measured type and size) → `attached` to one of the uploader's own messages at a position 0–3, or `releasing` → removed (51306). JPEG, PNG and PDF only, ≤ 5 MiB, ≤ 4 per message. Its message key carries the conversation. Its Asset is a typed key; nothing cascades |
| **MessageReadState** | One high-water `lastReadSequence` per participant (keyed to the participant), only forward and never past the last message (51307). Unread is derived |
| **MessagingBlock** | Blocker → blocked, directional, never self (CHECK). While either direction exists neither may start or continue a direct conversation with the other; history is untouched. Support is an organisational service, not a peer relation, so blocks do not apply to it |
| **MessagingReport** | A current participant's report of the Conversation or — when `messageId` is set — of that Message, by a composite key that carries the conversation; a controlled reason, the conversation's last sequence at the time, `open` / `resolved`. One open report per reporter and target (51308). No narrative: the reported content is the evidence |
| **MessagingModerationDecision** | The one immutable decision on an open report — `dismiss`, `withhold-message` (message reports only) or `close-conversation` (51309) — with the moderator and the instant. It never edits text, suspends an account or escalates anywhere |

**Current relationship on every read.** Listing, opening, history, catch-up, sending, marking read,
reporting, uploading and every attachment byte request re-decide access from the activation and:
for teacher↔student, Learning's two halves — the teacher's current scope on the Course under a live
`teaching.perform` assignment, and the learner's Enrolment on the published Course — while live
learning is activated; for support, being the requester, or holding `messaging.support` live; for
student↔student, the peer policy. A participant row alone never suffices: a revoked or replaced
teacher, an ended scope and a withdrawn learner are told the conversation has `ended` and shown
nothing of it on the next request. A non-participant, an inactive kind and a missing id answer alike.

**Order, idempotency and catch-up.** The sequence is allocated under the conversation's lock and is
the only order; timestamps are the server's. A retried send with the same operation id returns the
same message; a different payload under that id is refused and changes nothing. History pages
backwards by sequence; catch-up returns exactly the messages after a sequence the reader holds,
bounded — the durable source Phase 25's reconnection will use.

**Support** is a conversation, never a ticket. Staff see the queue's metadata — state, activity,
claimed, awaiting a reply — and opening a conversation's content is a separate, audited act
(`messaging.support.accessed`). Replying needs the claim; claiming and resolving are versioned and
audited. The person sees "Minhaj Support", never a staff identity.

**Moderation** reads only the evidence one report authorises — the reported message and ten either
side within what existed when it was filed, or the last thirty messages of a reported conversation —
each read audited by identifier. A withheld message renders as a neutral placeholder to its
participants and stays whole, immutable evidence.

**Account closure — the terminal-history rule.** Two rules must both hold: a relationship that ENDS
removes access to its history, and closing one account must not silently destroy another person's
history. They are reconciled by one narrow exception, created **only** by a VERIFIED Identity
account closure:

- the closed account loses every access at once (it has no session), and Messaging's disposition
  closes its open conversations as `account-closed`, ends its participation, and removes its read
  state, its blocks and its unsent uploads;
- the **remaining** participant of a closed direct conversation keeps **read-only** access to its
  immutable history and attachments while Identity reports the counterpart closed **and their OWN
  half of the relationship is still current** — a teacher still teaching that Course, a learner
  still enrolled on it. Nothing new can be sent;
- ordinary revocation, scope end, withdrawal, a block or a moderator's closure never create it:
  those answer `ended`;
- nothing about the closed person is copied to keep the history readable — their pseudonymised User
  row is enough — and a new registration with the same address is a new account that reaches
  nothing of the old one;
- a conversation is **disposed** — messages, attachments (released from Storage), read state,
  participants and the conversation — only once every non-support participant has left through
  closure and no report names it. A reported conversation is evidence and is kept; its legal
  retention is OPEN_DECISIONS.md §2.2's. A support conversation of a closed requester is disposed
  on the same terms.

**Export** returns the person's participation, their OWN messages with their text, their
attachments' metadata, their read state, blocks and reports — never another person's message and
never attachment bytes.

**Attachment custody.** Storage keeps only the SHA-256 of a release token Messaging generated
before storing; only that token releases the asset (ARCHITECTURE.md §4.2). A crash between storing
and recording leaves a recorded token, so the bounded sweep releases unsent uploads after 24 hours;
rejected and uncleared uploads are released at once.

**Not delivered, and not owed by Phase 24:** realtime delivery, presence and typing (Phase 25),
message edit, delete or unsend, group or public conversations, calls, email or notification of
messages, an approved student-to-student policy, real support staff or moderators, any strike, ban,
escalation or retention rule, and every policy OPEN_DECISIONS.md §2.1, §2.2, §2.5 and §6.6 reserve.

### 15.7 As delivered (Phase 25 — the realtime transport; no new aggregate)

Phase 25 adds a TRANSPORT and nothing to the model: no aggregate, table, column, key or trigger.
SQL Server remains the only record of a message, its order and its read state.

- **Live delivery is a read.** A message is committed by the Phase-24 send first; what a connected
  person then receives is that committed row read FOR THEM, through the same access decision, at the
  moment of delivery. A transport room is how candidate sockets are found, never authority: a teacher
  whose assignment was revoked, a withdrawn learner, a blocked pair, a closed or moderated
  conversation receive nothing new on the next event.
- **Presence and typing are contact, not data.** Held in the realtime process's memory only,
  per conversation; shown to the other person only while that person could send to the conversation
  now (the send gate, so a blocked pair see neither); typing carries a boolean, never text; both vanish
  on disconnect, on a short expiry and on a restart.
- **Person-facing only.** Teachers, learners and support requesters use the transport; a support
  staff member's reading stays the audited administration surface (§15.5).
- **Recovery is catch-up.** A client that missed anything — a dropped connection, a restarted
  process — asks for the messages after the highest sequence it holds; nothing is lost and nothing is
  delivered twice.

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
| **LegacyMapping** | Original URL and identifier → canonical new URL. **Drives 301 redirects and traceability** — Phase 30 proves each mapping's resolution in staging or a controlled harness; live legacy-domain 301s begin only at the Phase-35 cutover (ROUTE_MAP.md §9.7) |
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

### 16.5 As delivered (Phase 29 — the framework over fixtures; no real source)

Eighteen Migration-owned tables (migration `20261011000000_phase29_migration_provenance`). Every
foreign key is `NO ACTION` — nothing cascades — and there is **no `targetType` / `targetId` pair
anywhere**:

| Aggregate (§16.1) | Tables |
|---|---|
| **LegacySource** | `MigrationSource` (key, authority kind `fixture` \| `authorised`, access method `http` \| `export`, content kind, politeness bounds) · `MigrationSourceHost` (its exact hosts, fixed at creation) |
| **ImportRun** | `MigrationRun` (operator, transform provenance, discovery cursor, lease, reconciliation verdict) · `MigrationRunItem` (one record's outcome in one run) |
| **MigrationStatus** | `MigrationRecord` — the stable identity of one legacy record per (source, external key), its lifecycle status, source observation (`observed`) and any disappearance classification |
| **RawSnapshot** | `MigrationRawSnapshot` |
| **StagedRecord** | `MigrationStagedRecord` (one immutable revision) · `MigrationStagedCategory` · `MigrationStagedLink` · `MigrationTopicMapping` (legacy category → Topic, per source) · `MigrationDuplicateCandidate` |
| **ImportError** | `MigrationError` |
| **AssetProvenance** | `MigrationAssetProvenance` — one row per acquisition |
| **LegacyMapping** | `MigrationLegacyMapping` |
| **PublishManifest** | `MigrationPublishManifest` · `MigrationManifestEntry` |
| **Promotion manifest** (MIGRATION_STRATEGY.md §10.1.1) | `MigrationPromotion` · `MigrationPromotionEntry` |

**MigrationStatus** is `discovered`, `fetched`, `staged`, `rejected`, `errored`, `excluded`,
`approved`, `published`, `merged`; its observation (`observed`) is `present` or `missing`, and a missing record's
disappearance is `withdrawn`, `moved`, `source-error`, `transient-failure`, `access-failure` or
`unresolved` (MIGRATION_STRATEGY.md §5.3).

**Invariants the database holds**, beneath the service's own checks:

- **Raw evidence is append-only and bound to SHA-256.** A CHECK requires a held body to be exactly
  the bytes its `checksum` and `byteSize` name. A snapshot is never deleted or rewritten; the only
  change it accepts is a deliberate **disposal of the body**, which records who, when and why and
  keeps the metadata and checksum.
- **A staged revision is immutable; its review only moves forward.** It begins `pending` at
  version 1 from a snapshot of its own record whose checksum it carries, in a run of its own source;
  its payload, checksums and provenance (adapter, parser, normaliser and code revision) never change;
  only a `valid` revision with no flagged personal data may be `approved`. A later revision of the
  same record supersedes an earlier pending or approved one.
- **One open run per source** (a filtered unique index), held by a lease every checkpoint proves.
- **One active legacy mapping per legacy URL** within a source; a disabled mapping stays as history.
- **One live manifest entry per staged revision** — a revision is `publishing`, `published` or
  `rollback-refused` in at most one manifest, so neither a second manifest nor a resumed one can make
  a second target.
- **Typed target references.** A manifest entry and a legacy mapping name what they made by the
  typed, nullable `videoId` foreign key to Media's `Video` — the SavedItem pattern — and a legacy
  mapping must name exactly one target (today, always a Video).
- **Same record, same source.** Composite keys make every snapshot, staged revision, run item,
  error, acquisition, manifest and legacy mapping provably belong to the same record and source as
  its parent; a staged category or link may name only a topic or legacy mapping of its own source.
- **Fixture authority is fixed at creation.** A `fixture` source carries no authorisation
  reference or date and names only `*.fixture.invalid` hosts; an `authorised` source must carry both.
  Its key, authority kind, access method, content kind and hosts never change.
- **Absence is an observation.** A complete discovery marks unseen records `missing`; records are
  never deleted, and nothing is unpublished or redirected because of absence. A person classifies it.
- **Only hard identity collapses.** A record whose first valid staging carries the same
  `provider:providerVideoId` as an earlier record, in no different language, collapses
  automatically into the earliest (`collapsed`, signal `provider-id` only); a folded-title match is
  only ever an `open` candidate for a person; **a cross-language pair is never merged** (CHECK). A
  merge keeps every legacy address and can be reopened.
- **Identical bytes are not identical rights.** Acquisitions are unique per (source, URL digest,
  checksum); the same bytes may share one stored `Asset`, but each acquisition keeps its own licence,
  rights holder, evidence and visibility, and only `organisation-owned` or `licensed` material a
  person decided may become `public-eligible`.
- **Errors say what happened.** An `access-denied` error is never retry-eligible, and only a
  retry-eligible error may have a retry requested.
- **Manifests and promotions move only forward** (`draft → publishing → published → rolling-back →
  rolled-back`, or `discarded`; a promotion `draft → approved → promoting → promoted`, withdrawable
  until it completes). An entry is added only to a draft and only for an approved revision of the
  manifest's source; a promotion carries only published entries. **Publishing, rolling back and
  approving a promotion are refused by trigger** unless the actor holds `migration.publish` now with a
  live `migration-publication` step-up.

**One content kind (at Phase-29 exit, historical).** `media.video` was then the only kind, because it
was the only one with a Layer-4 publisher; Migration's staged payload is its own shape, translated into
Media's input only at Layer 4 (§16.3). Phase 30 added kinds with their publishers (§16.6).

**Migration & Provenance imports no context.** It depends only on Layer 0: Identity's authority,
Taxonomy's existing Topics, the publication target, Storage and the source adapters all reach it as
ports composed at Layer 4 or by `scripts/migration/` (ARCHITECTURE.md §5.1). No target context and
no other context reaches Migration.

### 16.6 As delivered (Phase 30 — eight kinds, authorised sources, typed targets)

Migration `20261027000000_phase30_source_adapters` adds no table; it widens the Phase-29 ones.

- **Content kinds.** `media.video`, `library.work`, `library.magazine`, `library.magazine-issue`,
  `editorial.news`, `editorial.article` (publishable) and `fatwa.ruling`, `quran.translation`
  (**review-only**) — one closed vocabulary in the source, record and staged-revision CHECKs. Each kind
  has one strict staged-payload schema; rich text is staged as blocks (paragraph, heading 2–4, quote,
  list; bold, italic, link runs), never as markup.
- **Review-only kinds never publish.** A manifest entry names an approved, valid revision of a
  **publishable** kind (trigger 51379), so Fatwa and Quran material — whose owning domains have no
  import path (§8.3, §12.1) — can be reviewed as migration evidence but can never reach a target.
- **Typed targets.** A manifest entry and a legacy mapping name what they made by one typed, nullable
  foreign key per target: `videoId` → Video, `workId` → Work, `magazineId` → Magazine,
  `magazineIssueId` → MagazineIssue, `newsArticleId` → NewsArticle, `articleId` → Article. A
  mapping names **exactly one** and the same one as its entry (51380); an entry's target, stage,
  version and path are written once (51379). Still no `targetType` / `targetId` pair anywhere.
- **Target stage.** An entry records how far the owning domain carried the record: `public`, or
  `in-review` where the domain itself needs a second person — Editorial refuses self-approval, so a
  migrated news item or article is created and submitted into Editorial's review and becomes public
  only by Editorial's own decision.
- **Authorised sources.** `authorised` sources now exist, created only by their own path, inactive,
  carrying the written authorisation reference and date; the CHECK also binds them to a real `https`
  base outside `*.invalid` and to the politeness floor (one request at a time, ≥ 1 s apart), and the
  host trigger (51371) to real host names — never `*.invalid`, a single label or a literal address.
- **Reference resolution.** One migrated record may name another by that record's **legacy URL**
  (a magazine issue names its magazine); it resolves only through an ACTIVE legacy mapping, so a
  reference to something not yet published refuses rather than guesses.
- **Holdings for rollback.** Personalisation answers `workHeld` and `articleHeld` beside
  `videoHeld` (`SavedItem` and `ReadingHistory`); a held Work or Article is never withdrawn
  automatically. No personal table can hold a news item, magazine or issue.

### 16.7 As delivered (Phase 30-R — review completeness: four more kinds, assets, refresh)

Migration `20261030000000_phase30r_review_completeness` adds no table (OPEN_DECISIONS.md §3.7).

- **Four more publishable kinds.** `editorial.press-release` (a PressRelease), `editorial.page` (an
  organisational Page bound to ONE reserved shell route the committed catalogue names; its slug is
  always `page`), `people.person` (a public profile: name, whole biography paragraphs within
  People's bound, portrait) and `global.country` (a Country of the organisation's stated presence,
  its ISO code from a fixed table, never guessed). Typed targets `pressReleaseId`, `pageId`,
  `personId`, `countryId` on entries and mappings — still exactly one per mapping, still no target
  pair. Twelve kinds in all; the two review-only kinds are unchanged.
- **Images in payloads.** A staged payload may name the image its source presents with the record
  — a lead image (news, article, press release, page), a cover (edition, magazine issue), a poster
  (video), a portrait (person) — by canonical `https` URL with the source's own alt text. A target
  records it only as the PUBLIC copy of the rights-cleared acquisition of exactly that URL;
  otherwise the record is published without it.
- **Public copy of an acquisition.** An acquired JPEG or PNG keeps its exact evidence bytes AND a
  metadata-stripped public copy made by Storage's image pipeline; `MigrationAssetProvenance`
  records that copy's asset, checksum and measured box — all of it or none (a CHECK). Only a
  PERSON decides an acquisition `public-eligible`, one by one or in an audited bulk act over a
  run's acquisitions; unknown or third-party rights cannot be.
- **Source hosts have roles.** A `page` host is where discovery, items and links live; an `asset`
  host is an exact first-party host the source's own pages name for their pictures, reached only
  to acquire one. Adding an asset host to a registered source is an audited, append-only act with
  its first-party evidence; a host is still never changed or removed (51371).
- **Refresh entries.** A manifest entry is a `create` or a `refresh`, fixed when the entry is made
  (51379): a refresh carries a newer approved revision of an already-published legacy record into
  the record its ACTIVE legacy mapping names, through the owning domain's own update — Editorial's
  revision and review again, the others staying published — makes no legacy mapping (51380) and is
  never rolled back by migration (a CHECK): what it changed is a person's to undo.
- **Replay.** A run may re-read the source's retained raw snapshots with newer parser and
  normaliser code instead of fetching pages; the same bytes read by newer code are a new revision.

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
- **Centre-scoped Events** (Phase 14) are the same rule applied to the Event revision's own
  nullable `centreId` (§7.2.3); a Centre's Events page lists them while the Centre is public.
- **Not searchable yet.** Phase 16 enters from 6 and 13, not 17; Find a Centre is Global's own
  owner query. A Global search projection, if wanted, is a recorded later step, and Phase 31
  proves completeness (DELIVERY_PLAN.md §3).
- **Countries without Centres (Phase 30-R).** Migration may publish a Country the organisation's
  own site states it is present in (`global.country`) without any Region, City or Centre: no
  authorised source publishes a centre directory with addresses, and none is inferred. Such a
  Country's public page says honestly that no Centre is listed yet.

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

#### 17.2.1 As delivered (Phase 26)

- **MembershipType** is Membership's own public catalogue: `draft → published → archived`,
  and `archived → published` again; **never back to draft once public, never deleted**. Its
  words are translation rows (`MembershipTypeTranslation` — title, summary, description and
  optional joining guidance per locale, plain text). **Publication requires the type's
  primary-locale words** (the database refuses otherwise). A draft is invisible and takes no
  application; an archived type takes no new application and no approval but stays resolvable
  for the records that name it. **No slug and no per-type route** — the public surface is
  `/membership` alone.
- **MembershipApplication** is the signed-in account's request for one type: `submitted →
  under_review → approved | rejected`, and `submitted | under_review → withdrawn`, one version
  at a time; a decided or withdrawn application never changes again, and **no decision happens
  without review**. It holds the applicant account, the type, its status, a withdrawal source
  (`applicant` or `account-closure`) and its instants — **no name, address, contact, age,
  guardian, document, free text, note or upload**, and nothing of the account is copied.
- **Membership** is created **only** by an approval and is `active → closed` (by the member or
  by an operator), never reopened in place and never deleted. It names its **own approved
  application by a composite key carrying the applicant and the type**, so it can belong to no
  other account or type. Re-joining after a closure, a rejection or a withdrawal is a new
  application and, if approved, a new Membership; no waiting period, ban, number, card, expiry,
  renewal or dues exists.
- **Invariants in the database.** At most **one open application** and at most **one active
  Membership** per account and type (filtered unique keys); **exactly one Membership per
  application**; an application only on a published type and never while an active Membership
  of that type exists; a Membership only from an approved application on a published type.
  Every write on an account's records of a type serialises on that account and type before its
  first protected write (§19.8).
- **Approval is one transaction**: the application becomes approved, the Membership is
  created, the audit row and the applicant's service-mail intent are written — or none of them
  are.
- **Service communication** is Membership's `MembershipCommunicationIntent`: one per lifecycle
  point (`membership.application.submitted`, `.under-review`, `.approved`, `.rejected`,
  `.withdrawn`, and `membership.closed`), committed in the transaction that owes it, keyed by
  purpose and record so a retried transition owes nothing twice, and naming exactly the one
  application or Membership it describes by a composite key that carries its recipient
  (ARCHITECTURE.md §4.6.1).
- **Account closure is not resignation.** After Identity closes the account, Membership's
  disposition withdraws its open applications (`account-closure`) and removes its owed mail; an
  **active Membership stays active** under its own lifecycle, its self-service simply ends with
  the account, and a later registration with the same address is a new account that reaches
  nothing old. This is an engineering default, not a retention rule (OPEN_DECISIONS.md §2.2).
- **The permitted edges to People and Global Network are unused.** Nothing in the accepted
  contract names a Person, a Centre or a place for a member, so none is created or referenced:
  a member is not a public contributor, and a Membership is not a Centre affiliation. The
  allowlist row stands; an allowed edge need not be consumed.

### 17.3 Donations

**DonationCampaign** · **Donation**, behind a `PaymentProvider` abstraction. **No production
provider is selected**: Phase 27 proves the lifecycle against one sandbox engineering adapter, which
is not a production selection (OPEN_DECISIONS.md §5.4). **No card or payment credential data is
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

#### 17.3.1 As delivered (Phase 27)

Eight Donations-owned tables (migration `20261010000000_phase27_donations`), with no card,
payment-method, order, cart, invoice, subscription or raw-payload table and no generic target pair:

- **DonationCampaign** `draft → published → archived → published` (never back to draft), with
  **DonationCampaignTranslation** (title, summary, description per locale) and
  **DonationCampaignCurrency** — the server-owned money policy per ISO currency: inclusive exact
  minimum and maximum and up to three suggested exact amounts. Publication needs the primary
  locale's words and at least one currency. No target, progress bar, donor wall, slug or
  per-campaign route.
- **Exact money.** `BIGINT` minor units with the currency and the ISO exponent stored beside every
  amount; a CHECK admits only the allowlisted (currency, exponent) pairs — zero (JPY, KRW), two, and
  three decimals (BHD, JOD, KWD, OMR, TND). Amounts are parsed from decimal text straight into
  `bigint`, never rounded, never through binary floating point; provider units are converted inside
  the provider adapter.
- **Donation** — one payment attempt: the campaign, an optional linked account, the request's
  operation id (unique — a duplicate submission is the same donation) and digest, the status-token
  digest, the immutable expected money, the interface locale and donor-visible label it began with,
  and its provider scope (provider, environment, NON-SECRET account key). Its state is DERIVED from
  monotonic facts — a capture set once and only of exactly the expected amount, a refunded total that
  only grows and never exceeds the capture, a dispute that only moves forward
  (`none → open → won | lost`), and a closure (`failed`, `expired`, `cancelled`) only while nothing
  is captured — by one rule the database re-checks: `pending`, `succeeded`, `failed`, `cancelled`,
  `expired`, `partially_refunded`, `refunded`, `disputed`, `charged_back`. Late or stale provider
  news therefore converges and never regresses verified success; a mismatch of scope, reference,
  currency or amount raises an attention flag and never succeeds.
- **DonationProviderEvent** — durable dedup per (provider, environment, account key, event id),
  keeping identifiers, type, instants, the digest of the verified bytes and the result; never the
  payload.
- **DonationRefund** — a full or partial refund, reserved against the capture under the donation's
  lock, moving only forward (`requested → pending → succeeded | failed`); live refunds can never
  exceed the capture, and the requester must hold `donations.refund` with a live `donation-refund`
  step-up when the row is written.
- **DonationActivation** — one owner-written row; none means giving is unavailable.
- **DonationCommunicationIntent** — durable service mail for LINKED donors only.

**Redirect is not authority.** The provider's return URL is a constant page that reads no query
string; only a verified webhook or a server-to-server read of the provider changes a donation.
Reconciliation of missing, delayed or ambiguous outcomes is a bounded SQL-leased sweep; an ambiguous
create is resolved only under its original idempotency key, never by a second attempt.

**Anonymous and linked.** An anonymous donation holds no personal data and is read through an opaque
status token; a linked donation exists only when an active account starts it from `/my/donations`,
and an anonymous one never links later. After account closure the link is released and the
financial record kept (SECURITY_BASELINE.md §19.1.7). **Donations depends on Layer 0 and Identity
only** — never Membership, which has no payment concept, nor any content context.

**No recurring giving, saved instruments, Gift Aid, tax receipts or production provider** exist;
those remain OPEN_DECISIONS.md §5.4.

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
