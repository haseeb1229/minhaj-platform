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
| **3A** | **Localisation Foundation** *(locale routing · next-intl · RTL)* | **0B** |
| 2 | Identity & Access: base authentication | 1, **3A** |
| 2G | Google OAuth *(separately gated)* | 2 |
| **3B** | **Taxonomy** *(canonical topics · protected taxonomy administration)* | 1, **2**, **3A** |
| 4 | Public Shell & Organisational Presentation | **3B** |
| 5 | People & Contributors | 2, **3B** |
| 6 | Editorial Core: articles, pages, workflow | 4, 5 |
| 7 | Storage Foundation *(infrastructure only)* | 1 |
| 8 | Library: works, editions, translations | 5, 6, 7 |
| 9 | Research & Publications | 8 |
| 10 | Media: Video | 5, 6 |
| 11 | Media: Audio | 10 |
| 12 | Media: Galleries | 7, 10 |
| 13 | News | 6 |
| 14 | Events | 6, **12**, 13, **16** |
| 15 | Collections | 6, 8, 10, 13 |
| 16 | Global Network | 6, **13** |
| 17 | Search Foundation | 6, 8 |
| 18 | Quran | **3B**, 5, 7, **17** |
| 19 | Hadith | **3B**, 5, **17** |
| 20 | Fatwa | 2, 5, **17** |
| 21 | Personalisation & Notifications | 2, 18, 19 |
| 22 | Learning: courses & paths | 5, 6, **17** |
| 23 | Teacher Experience & Live Classes | 22, **safeguarding decision** *(manual Meet flow — no Google API credential required)* |
| 24 | Messaging: domain & shared server services | 2, **7**, 22, 23, **safeguarding decision** |
| 25 | Messaging: realtime runtime | 24 |
| 26 | Membership | 2, 5, 16 |
| 27 | Donations *(separate; may be deferred)* | 2 |
| 28 | Staging Foundation | 1, 7 |
| 29 | Migration & Provenance Framework *(fixtures only)* | 1, **2**, **3B**, 28 |
| 30 | Source Adapters & Initial Migration | 29, all target domains, **written source authorisation** |
| 31 | Search Completeness Validation | 17, **30**, all searchable domains |
| 32 | SEO & Accessibility Acceptance | all in-scope public domains, **30** *(legacy-redirect acceptance only)* |
| 33 | Security Hardening & Final Assurance | 0B, 1, 2, 2G, 3A, 3B, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29 |
| 34 | Performance & Operations | 32, 33 |
| 35 | Launch: Delta Migration & Cutover | 30, 31, 32, 33, 34 |

**Reading the table — a phase number is an identifier, not a sequence.**

> **A phase number is a stable identifier, not a guaranteed execution sequence. The "Depends on"
> column is authoritative for execution ordering.** Neither the numeric order of the phases nor
> the row order of this table determines when a phase runs.

Consequently **a valid topological schedule may complete a higher-numbered prerequisite before a
lower-numbered dependent phase.** The worked example is **Phase 16 → Phase 14**: Global Network
(16) must complete before Events (14), because Events owns a relational Centre reference and
Centres must exist first. That is a legitimate, executable dependency, not a numbering defect —
and the roadmap is **not** renumbered to make the arrows point one way.

Row order in this table is a readability aid only. The former Phase 3 is split into
**3A — Localisation Foundation** and **3B — Taxonomy**; the number 3 is retained rather than
renumbering the roadmap. **3A enters from 0B, carries no database dependency, and may be
delivered in parallel with Phase 1.**

Phases 8–13, 15 and 16 remain largely parallelisable; **Phase 14 follows 12, 13 and 16**,
because Centres and Galleries must exist before Events owns relational references to them.
18 and 19 remain independent of each other. **27 never blocks 26.**

**The in-scope feature-delivery set — Phase 33 dependency rule.** Its required baseline
prerequisites are the literal tokens in its `Depends on` cell. It has one separately defined
conditional prerequisite:

> **Conditional dependency:** if and only if Donations is in the approved launch scope, add
> **Phase 27** as a prerequisite of Phase 33; otherwise add nothing.
>
> The unconditional cell is a **positive enumeration** and contains no conditional prose, so a
> scheduler can parse its baseline tokens literally and apply the single rule above separately.
> **Phase 33 itself, Phase 34 and Phase 35** are absent, as are the migration-execution and
> acceptance phases **30, 31 and 32**, which are ordered against Phase 35 by their own rows.
> **Phase 33 therefore has no self-edge and no forward edge**, and the graph stays acyclic on a
> literal reading whether or not the conditional edge from 27 is present.

An explicitly approved deferral — Donations (Phase 27) being the recorded example — is outside
that set and **never silently becomes a mandatory launch dependency**. Narrowing *which phases
are counted* does **not** weaken the security or operations acceptance applied to any phase that
*is* in scope, and every phase in the set has already passed its own security exit criteria (§3)
before Phase 33 begins.

---

## 3. Standing requirements — every phase

Exit criteria for **all** feature phases, not a later sweep:

| Requirement | Standard |
|---|---|
| **Permission enforcement** | Server-side, with **negative tests proving denial** |
| **Capability semantics** | Projections never bypass permission checks; **a profile alone grants nothing** |
| **Input validation** | Zod for application-owned inputs at every trust boundary; server-side authoritative. Opaque provider/library protocol material follows its configured protocol implementation (SECURITY_BASELINE.md §7, §9.1) |
| **Mutation safety** | **Four protocol security classes** (SECURITY_BASELINE.md §7). **Class A** browser mutations: server-side authorisation, Origin/Host validation, framework-appropriate CSRF controls, **no state-changing GET**. **Classes B, C and D** — signed machine callbacks, authentication/OAuth callbacks, emailed verification/reset links — are asserted against their own protocol contracts, **not** against browser CSRF; **that is not a CSRF bypass** |
| **Cache boundary** | **Cache-leakage tests**: no session-derived data in shared cache entries |
| **Public access** | Public routes render fully with **no session** |
| **Referential integrity** | Typed relationships; **no polymorphic `targetType + targetId` as a relational domain reference**. **Historical audit identifiers are outside this rule** and are not changed (DOMAIN_MODEL.md §6.2.1) |
| **Localisation** | Works in en/ur/ar; **RTL verified**. Any phase delivering routed surfaces therefore has **Phase 3A in its dependency path** |
| **Private asset serving** | Any phase serving private assets **supplies and tests its own Identity-derived authorisation policy** for the default-deny serving route delivered in Phase 7 |
| **Accessibility** | **WCAG 2.2 AA** for delivered surfaces |
| **Audit** | Domain audit records where required |
| **Logging** | Structured; no secrets, tokens or personal content |
| **Context boundaries** | Dependency rules respected; **violations fail the build; no ESLint exceptions** |
| **Search projection** | Every searchable domain has a projection, filters and tests. A domain delivered **after** Search Foundation adds its own — so **Phase 17 is in its dependency path**. A domain delivered **before** Phase 17 has its projection added in Phase 17 or in a named later step. **Phase 31 proves none is missing** |
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
- **Compatibility verification of the dependencies actually introduced in this phase**
  (TECH_STACK.md §16.3). Deferred locked dependencies are validated in their owning phase,
  when they are genuinely introduced — not proven here in advance.

**NOT in this phase:** `apps/realtime` · Socket.IO · Motion · React Hook Form · Tiptap ·
Playwright browsers · any domain schema.

**Tests:** App starts; CI passes; **a deliberate boundary violation fails the build**;
**a deliberate same-level import outside the allowlist fails the build**; **importing
`packages/server-core` into a client bundle fails the build**; **boundary rules require no
exceptions**; strict mode clean.
**Exit:** CI green. Boundary enforcement demonstrated. **The dependencies introduced in this
phase** verified to install and build together, or a discrepancy reported for architecture
decision. **No deferred dependency is claimed to have been validated here.**

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
**Entry:** Phases 1 and **3A** complete. **Email provider available** (OPEN_DECISIONS.md §5.1)
— **this remains the Phase 2 entry gate and is not relaxed.**
**Google OAuth application credentials are NOT required for this phase** — within the current
V1 delivery plan they are required for Google sign-in (Phase 2G).

> **Why Phase 3A is a prerequisite.** This phase delivers routed authentication surfaces, and
> the standing requirements (§3) require them to work in en/ur/ar with **RTL verified**. The
> localisation foundation must therefore already exist. **This is not a taxonomy dependency** —
> Phase 3B (Taxonomy) depends on *this* phase, and the split is what keeps the graph acyclic.

**Better Auth 1.7.x is introduced and compatibility-validated here**, at its genuine point of
introduction (TECH_STACK.md §16.3).

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
**no Class-A browser mutation is performed by GET** (SECURITY_BASELINE.md §7.1) · browser CSRF
protection verified · **authentication callbacks verified against their own protocol contract**
(§7.3) · **verification and reset links render on GET without silently mutating, consume their
token at the confirming action, and reject expired or reused tokens** (§7.4) · rate limiting
effective · no user enumeration.
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

### Phase 3A — Localisation Foundation
**Entry:** Phase 0B complete. **No database dependency** — this phase may be delivered in
parallel with Phase 1.

> **Why the former Phase 3 is split.** Phase 2 must deliver authentication routes in en/ur/ar
> with RTL verified (§3), so the localisation foundation has to precede Phase 2. The other half
> of the former Phase 3 — **protected taxonomy administration** — cannot precede Identity.
> Leaving them combined would require `2 → 3 → 2`. Splitting removes that cycle. **The number 3
> is retained; the roadmap is not renumbered.**

**Deliverables:** **next-intl 4.14.x introduced here — its owning point**, and
**compatibility-validated at this genuine introduction** (TECH_STACK.md §16.3) · `/{locale}`
routing with `en`, `ur`, `ar` **always present** (ROUTE_MAP.md §1.1) · locale resolution and the
`/` → resolved-locale **307** · route-preserving locale switching (ROUTE_MAP.md §1.3) ·
**RTL route infrastructure and foundation** — logical CSS properties throughout, `dir` derived
from locale, correct mixed-direction handling · locale-aware layout primitives · the lint rule
blocking physical-direction utilities in layout code.

**Explicitly NOT:** Topic, Language or Tag schema · taxonomy administration · any content
domain · any content-translation modelling (that is domain data — DOMAIN_MODEL.md §19.1).

**Tests:** All three locales route correctly · **RTL verified for Urdu and Arabic** ·
mixed-direction content renders correctly · locale switch preserves route and parameters ·
**a physical-direction utility in layout code fails lint** · `/` resolves per ROUTE_MAP.md §1.1.
**Exit:** Locale routing and RTL proven **before any phase is required to deliver en/ur/ar
routes**. **There is exactly one localisation implementation, and no later phase re-implements
it.**

---

### Phase 3B — Taxonomy
**Entry:** Phases 1, 2 and 3A complete.

> **Why Phase 2 is a prerequisite.** This phase delivers **protected taxonomy administration**,
> which requires the single authorisation enforcement path (DOMAIN_MODEL.md §4.4) and the
> standing negative permission tests of §3. **Administration of the canonical taxonomy cannot
> precede Identity.**

**Deliverables:** Topic aggregate — hierarchical, locale-aware, stable slugs · **typed topic
assignment strategy with database-enforced integrity** (DOMAIN_MODEL.md §6.2) · Language
reference data, **distinct from interface locale** · Tag · canonical topic seed data ·
**admin taxonomy management, permission-checked server-side**.

**Canonical taxonomy domain ownership is unchanged.** Taxonomy remains the single owning context
(DOMAIN_MODEL.md §6); no localisation concern moves into it, and no taxonomy concern moves into
Phase 3A. **No premature taxonomy business schema is created for later owners.**

**Tests:** Hierarchy and locale fallback · **deleting a target cannot orphan a topic
assignment** · taxonomy administration enforces permissions with **negative tests proving
denial** · locale-aware topic names render correctly in all three locales, **RTL included**.
**Exit:** Taxonomy usable by every later context with **enforceable integrity**, and its
administration protected.

---

### Phase 4 — Public Shell & Organisational Presentation
**Entry:** Phase 3B complete.

**Deliverables:** Root layout · header with utility and primary navigation · mega-menu
framework · footer · home-shell composition · Explore route shells · 404 and error surfaces ·
**anonymous cached public tree with the session boundary enforced** · security headers and base
CSP · **`hreflang`, canonical and `x-default` emission** · sitemap index skeleton ·
`robots.txt` · **organisational presentation infrastructure**.

> **No Page business aggregate is introduced here.** The editorial **Page** aggregate — with its
> mandatory review workflow, revisions, publish permissions and audit — is introduced **exactly
> once, in Phase 6**.
>
> **Phase 4 configuration is shell material only, and the boundary is drawn by substance, not by
> storage mechanism.** Calling something "configuration" does not make it presentation.
>
> **Phase 4 configuration MAY contain only:**
>
> - navigation labels
> - footer labels
> - menu labels
> - route labels and titles where appropriate
> - UI chrome
> - empty-state and status copy
> - **non-authoritative placeholders**
> - route metadata required for shell behaviour
>
> **Phase 4 MUST NOT contain or publish as configuration:**
>
> - legal document bodies
> - substantive terms, privacy or policy bodies
> - **canonical organisational facts**
> - organisational page bodies
> - editorial content of any kind
> - anything that would otherwise belong to the **Page** aggregate
> - **any substantive material intended to survive as production content instead of entering
>   the Phase 6 workflow**
>
> Accordingly:
>
> - **Substantive organisational and legal content remains gated on Phase 6.** It is not
>   delivered early in another form.
> - **The Phase 6 Page workflow — revisions, review permissions, sanitisation and audit — is the
>   only production publication route** for that content. There is no second route, informal or
>   otherwise.
> - **Reserving a route in Phase 4 does not authorise substantive publication on it.**
> - **Placeholders are replaced, never migrated.** A Phase 4 placeholder is discarded when the
>   genuine Page record is authored; it is never promoted, imported or carried forward into an
>   informal configuration CMS.
> - **No new content model is created** by any of the above.
>
> Publication of canonical organisational facts and legal documents is therefore owned by
> **Phase 6**, not this phase (OPEN_DECISIONS.md §2.3, §6.1). Phase 4 reserves the routes and
> nothing more.

**Tests:** Navigation in three locales · **full keyboard navigation and visible focus** ·
screen reader landmarks · **WCAG 2.2 AA for delivered surfaces** · **pages render with no
session** · **cache-leakage test: no session state in the public tree** · security headers
verified · canonical and `hreflang` correct · **no Page aggregate, Editorial schema or
publishing workflow is created in this phase** · **no substantive organisational or legal body
content exists in shell configuration** — reserved routes carry a non-authoritative placeholder
or a clear "not yet published" state, never a published body.
**Exit:** Public shell navigable, accessible and correctly cached in three locales, signed out,
**with no editorial Page aggregate introduced, no substantive content published as
configuration, and no route around the Phase 6 workflow created**.

---

### Phase 5 — People & Contributors
**Entry:** Phases 2 and 3B complete.
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

**Deliverables:** Article and **Page** aggregates — **Page is introduced here and only here** ·
**shared editorial workflow enforced server-side** · revision history · **separation of duties**
— author cannot approve own work by default · Tiptap for editorial content only ·
**server-side HTML sanitisation** · admin editorial routes and queue · typed topic assignment ·
public article routes · **organisational and legal Page records replacing the non-authoritative
Phase 4 placeholders on the reserved routes** · audit logging.

> **This phase is the single introduction of the Page aggregate.** Phase 4 delivered
> presentation infrastructure and reserved routes; it created no Page model. Once Page exists,
> organisational and legal content is **published only through this workflow** — there is no
> parallel path and no grandfathered content (OPEN_DECISIONS.md §2.3, §6.1).

**Tests:** Lifecycle transitions enforced server-side · **workflow bypass attempts fail** ·
**XSS payloads sanitised** · negative permission cases · author self-approval blocked ·
`Article` and `BreadcrumbList` structured data valid · **organisational and legal pages are
publishable only through the reviewed workflow** · **exactly one Page aggregate exists in the
system**.
**Exit:** Content publishable only through the reviewed workflow.

---

### Phase 7 — Storage Foundation
**Entry:** Phase 1 complete. **Separate from Library. Infrastructure only — no Identity
dependency.**

> **Why this phase does not depend on Identity.** Storage is required by Phase 28 (Staging) and
> by domains that are not otherwise Identity-gated. Making the storage foundation depend on
> Phase 2 would propagate Phase 2's external email gate (OPEN_DECISIONS.md §5.1) into staging
> for no architectural reason. Instead the **authorisation mechanism** is delivered here,
> **default-deny**, and the **Identity-derived policy** is supplied by each Identity-aware
> consuming phase (§3). **Nothing is weakened: an asset is unreachable unless an explicit allow
> decision is returned.**

**Deliverables:** **StorageService abstraction** with filesystem adapter · Asset model with
checksums · **upload validation: type, size, content sniffing** · **quarantine before
publication** · **malware scanning integration point** (provider selected here, not in 0A) ·
server-generated storage keys · **path-traversal protection** · **authorisation-checking serving
routes built on an injected authorisation-decision port that denies by default**.

**Explicitly NOT:** the Identity-derived authorisation policy itself, and any authenticated
serving composition. Those belong to the Identity-aware consuming phases (§3).

**Tests:** Disallowed types rejected · **content sniffing catches a mislabelled file** ·
**quarantined files are unreachable until cleared** · **path traversal via filename fails** ·
**large files are not database BLOBs** · **the serving route denies by default** — proven with a
test policy, **no asset is reachable without an explicit allow decision**, and **a deny decision
is not overridable by request input**.
**Exit:** Storage usable by every later domain, with quarantine, scanning and **default-deny
serving** proven. **Private asset authorisation is enforced at the serving route from this phase
onward; each consuming phase supplies and tests its real policy** (§3).

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
| **12** | **Galleries** | Photo, Gallery, GalleryItem and the historical archive. **No Event relationship is created here** — Event does not yet exist | Asset handling via Phase 7, **with this phase's own authorisation policy where assets are private**; accessibility of image content; **no forward reference to Event exists** |

---

### Phases 13–15 — News, Events, Collections, split for verification

| Phase | Deliverables | Key tests |
|---|---|---|
| **13 News** | NewsArticle, PressRelease, Statement, MediaCoverage; archive; public routes | `NewsArticle` structured data; `?sort=latest` is a query, **not a path** |
| **14 Events** | Event, EventSchedule; **typed Centre references — Global Network (16) is already delivered**; **the typed Event↔Gallery association, owned here because both targets now exist** | `Event` structured data with genuine date and location; **the Centre reference is a real foreign key, not a placeholder**; **Events owns no Gallery schema and Galleries owns no Event schema**; **no polymorphic placeholder is used to dodge ownership** |
| **15 Collections** | Collection with **typed item membership**; curated mixed-type sets. **Membership types cover only the content types delivered by this phase's prerequisites**; a later domain adds its own membership type when it arrives | **Deleting a Collection deletes no content**; **no polymorphic references**; item integrity enforced; **no membership type is pre-created for a domain that does not yet exist** |

---

### Phase 16 — Global Network
**Entry:** Phases 6 and 13 complete.

> **Why Phase 13 is a prerequisite.** Centre-scoped news uses the **News** model with a Centre
> reference rather than a parallel per-centre content system (DOMAIN_MODEL.md §17.1). That is a
> relational reference to a model that must already exist.

**Deliverables:** Country, Region, City, Centre, CentreContact with **flexible/nullable
parentage** · Centre addresses and coordinates · Find a Centre · **centre-scoped news**.

> **Centre-scoped events are delivered by Phase 14**, which is where Event is introduced and
> where the typed Centre reference is owned. **Global Network creates no Event schema, and
> Events pre-creates no Global Network schema.** Centres exist first; Events then owns the
> relational Centre reference — the ordering is what removes the impossible forward reference.

**Tests:** **A country with no regions is supported** · **a virtual centre with no city is
supported** · a centre serving multiple areas is representable · centre news uses the News
model with a reference, **not a parallel system** · **no Event schema is created in this
phase**.
**Exit:** Global network modelled without a rigid chain, **and delivered before any domain that
owns a relational Centre reference**.

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

> **This phase does not claim product-wide search completeness.** Every searchable domain
> delivered **after** this phase adds its own projection, filters and tests, and therefore
> carries **Phase 17 in its dependency path** (§3). A searchable domain **already delivered**
> when Search Foundation completes has its projection added here or in a recorded follow-on
> step. Completeness is validated in Phase 31 — and **Search Foundation is never pulled earlier
> merely because a consuming phase carries a higher number**.

---

### Phase 18 — Quran
**Entry:** Phases 3B, 5, 7 and **17** complete. **Authoritative Quran text source available**
(OPEN_DECISIONS.md).

> **Phase 17 is a prerequisite** because this phase's deliverables and exit criteria include a
> **search projection** (§3). A projection cannot be delivered before the Search Foundation it
> projects into exists.

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
**Entry:** Phases 3B, 5 and **17** complete. **Authoritative Hadith sources and grading
authority confirmed** (OPEN_DECISIONS.md).

> **Phase 17 is a prerequisite** for the same reason as Phase 18: this phase promises a
> **search projection** in its deliverables and exit criteria.

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
**Entry:** Phases 2, 5 and **17** complete. **Authorised Fatwa scholars identified and
`fatwa.publish` grants approved by Minhaj** (OPEN_DECISIONS.md).

> **Phase 17 is a prerequisite** because this phase promises a **search projection**. The
> projection must additionally prove that **unpublished rulings and private questions never
> appear in any index** (§3, SECURITY_BASELINE.md §6).

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
**Entry:** Phases 5, 6 and **17** complete — **Phase 17 because this phase promises a search
projection** (§3).
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
**Entry:** Phases 2, **7**, 22, 23 complete. **⚠ Safeguarding decision received.**

> **Phase 7 is an explicit prerequisite** because message attachments are storage-backed. This
> phase supplies and tests the **Identity-derived authorisation policy** for attachment serving
> against the default-deny route delivered in Phase 7 (§3). **Storage ownership does not move
> into Messaging** — Messaging consumes the StorageService abstraction.

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
**Entry:** Phases 1, **2**, 3B, 28 complete.

> **Written source authorisation is NOT required for this phase.** All work here uses **local,
> synthetic or previously approved test fixtures**, with **no live legacy-source access of any
> kind**. Authorisation is mandatory before Phase 30 (OPEN_DECISIONS.md §3.1). **Adding the
> Identity dependency below introduces no live-source access whatsoever.**

> **Why Phase 2 is a prerequisite.** This phase delivers **protected migration administration**
> — the admin migration area, the `migration.publish` permission and its **step-up
> reauthentication** (SECURITY_BASELINE.md §8). Protected administration requires the single
> authorisation enforcement path, so Identity must exist. It follows that this phase inherits
> Phase 2's transactional-email entry gate (OPEN_DECISIONS.md §5.1); it does **not** inherit any
> source-authorisation requirement.

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
**Entry:** Phase 17, **Phase 30**, and every in-scope searchable domain complete.

> **Why Phase 30 is a prerequisite.** This phase re-validates tokenisation quality **against the
> full migrated corpus at real volume**. That corpus does not exist until initial migration has
> been executed, reviewed and published. **Search Foundation (Phase 17) and search completeness
> against the final migrated corpus are different things** and are not interchangeable.
**Deliverables:** Final all-domain indexing verification · cross-domain relevance review ·
**Arabic and Urdu quality re-validated against the full migrated corpus**.
**Tests:** **Every searchable domain is represented** · filters work across all types ·
**unpublished, staged and private content never appears** · tokenisation quality acceptable
against real content at full volume.
**Exit:** Product-wide search completeness **demonstrated, not claimed**.

---

### Phase 32 — SEO & Accessibility Acceptance
**Entry:** All **in-scope** public domains complete, **and Phase 30 complete for the
legacy-redirect portion of acceptance**.

> **Two different things are distinguished here.**
>
> - **Incremental, per-domain SEO** — canonical, `hreflang` and structured data correct for the
>   routes a phase delivers — is a **standing requirement of every owning phase** (§3), verified
>   as that phase completes. It is not deferred to this phase.
> - **Final migration and legacy-redirect acceptance** is verified here, and **cannot precede
>   the existence of the canonical legacy URL mapping**. `LegacyMapping` rows are produced by
>   migration publication (DOMAIN_MODEL.md §16.1, MIGRATION_STRATEGY.md §9.1), so the
>   legacy-301 acceptance criteria below require **Phase 30**.
>
> The non-redirect acceptance criteria — canonical correctness, `hreflang`, sitemaps, structured
> data, `noindex`, WCAG 2.2 AA and RTL QA — depend only on the in-scope public domains.
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
**Entry:** Every phase in the **in-scope feature-delivery set** (§2) complete — **0B, 1, 2, 2G,
3A, 3B, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28,
29**, plus **27 only where Donations is in the approved launch scope** — **each having already
passed its own security exit criteria**.

> **The set is bounded, and bounded deliberately.** It **excludes Phase 33 itself, Phase 34 and
> Phase 35** — a phase cannot be its own prerequisite, and final assurance cannot wait on the
> operations and launch phases that follow it. It also excludes the migration-execution and
> acceptance phases **30, 31 and 32**, which are sequenced against Phase 35 by their own entry
> criteria rather than through this one.
>
> **"All" means all in-scope.** A phase whose deferral has been explicitly approved — Donations
> (Phase 27) is the recorded example — is **outside the launch scope and does not block this
> phase**. This narrows *which phases are counted*; it **does not weaken the security or
> operations acceptance applied to any phase that is in scope**, and a deferral that has not
> been explicitly approved is not a deferral.

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

> **Launch scope is the approved in-scope phase set.** An explicitly approved deferral, such as
> Donations (Phase 27), is not a launch prerequisite and never becomes one by implication.

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
| **The transactional email provider gate is the earliest broadly-blocking external decision** | It gates Phase 2 and therefore everything downstream of Phase 2, including 3B, 4, 5, 6 and 29. **Phases 0B, 1, 3A and 7 proceed without it**; raise it alongside the religious-authority and safeguarding items (OPEN_DECISIONS.md §5.1, §9) |
| Opportunistic dependency upgrades destabilise work | Versioning policy: **stop, investigate, report** — never automatic substitution |
