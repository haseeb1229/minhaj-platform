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
| 9 | Research & Publications | 8, **17** |
| 10 | Media: Video | 5, 6, **17** |
| 11 | Media: Audio | **7**, 10 |
| 12 | Media: Galleries | 7, 10 |
| 13 | News | 6, **17** |
| 14 | Events | 6, **12**, 13, **16** |
| 15 | Collections | 6, 8, 10, 13 |
| 16 | Global Network | 6, **13** |
| 17 | Search Foundation | 6, 8 |
| 18 | Quran | **3B**, 5, 7, **17** |
| 19 | Hadith | **3B**, 5, **17** |
| 20 | Fatwa | 2, 5, **17** |
| 21 | Personalisation & Notifications | 2, **10**, 18, 19 |
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

**Phase 14 follows 12, 13 and 16**, because Centres and Galleries must exist before Events
owns relational references to them. 18 and 19 remain independent of each other. **27 never
blocks 26.**

**Search Foundation (17) is now an explicit prerequisite of every searchable domain that
follows it.** Phases 9, 10 and 13 join 18, 19, 20 and 22 in carrying Phase 17 in their
dependency path, because each promises a **search projection** in its own deliverables and
exit criteria (§3), and a projection cannot be delivered before the foundation it projects
into exists. That ordering was previously left to the numeric reading of this table, which is
not a schedule — **the prerequisite is now stated, so the ordering is deterministic rather
than accidental**. Phases 8–13, 15 and 16 remain parallelisable **within** those constraints.

Two further prerequisites are recorded for the same reason — a promised deliverable needs its
target to exist:

- **11 → 7.** Non-Quran audio is storage-backed: AudioTrack has an asset lifecycle, and this
  phase supplies and tests its own Identity-derived authorisation policy against the
  default-deny serving route of Phase 7 (§3).
- **21 → 10.** The My Minhaj contract includes **WatchHistory** and video-backed
  personalisation (DOMAIN_MODEL.md §14.1). A typed reference to Video cannot be delivered
  before Video exists — and **no forward or placeholder foreign key is created to avoid the
  dependency**.

**Deliberately NOT added**, because permission to depend is not evidence of a current need:

| Rejected edge | Why it is not added |
|---|---|
| 21 → 11 | V1 My Minhaj promises **Watch** history. There is no required audio listening-history contract, so Audio is not a prerequisite of Personalisation |
| 21 → 20 | **My Questions is semantically owned by Fatwa** (DOMAIN_MODEL.md §14.4). My Minhaj is incremental Layer-4 composition; Phase 21 owns no Fatwa schema or workflow and composes the surface when Fatwa has delivered it |
| 22 → 10 | Learning **may** depend on Media under the context allowlist (DOMAIN_MODEL.md §3.1), but the allowlist grants permission, not necessity. Phase 22's current schema and deliverables require no Video relation |
| 22 → 16 | Learning **may** depend on Global Network for the same reason, and current Phase-22 deliverables require no Centre relation |

> **If a future concrete Learning schema genuinely requires a Media or Global Network
> relational target, the owning phase adds the required phase prerequisite *before*
> implementing the relation.** No forward foreign key, no placeholder foreign key, and no
> premature target schema — the same rule that ordered 16 before 14.

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
| **Accessibility** | **WCAG 2.2 AA** for delivered surfaces. **Software conformance and content conformance are accepted separately** — where a source supplies no caption, transcript or alternative, the gap is recorded and never fabricated (SECURITY_BASELINE.md §16.3) |
| **Design system** | Every routed surface uses the shared token, component and state contract of ARCHITECTURE.md §13. **No phase invents throw-away styling**, and no phase re-implements the design system |
| **Responsive and motion** | Delivered surfaces work from small phone to wide desktop with **no horizontal overflow**, correct RTL at every breakpoint, and `prefers-reduced-motion` honoured (ARCHITECTURE.md §13.5–§13.6) |
| **User-facing completeness** | A phase that promises a public, admin or user experience is **not complete with backend, API or schema alone**: it delivers a usable professional interface for that experience — responsive, keyboard- and focus-correct, localised with RTL, with its loading/pending, empty, success, error and unavailable states and validation feedback — and **no dead controls or demo-only UI**. An infrastructure-only phase owes no decorative UI |
| **Professional microfeatures** | The plan does not rely on every small feature being enumerated in advance. A microfeature discovered during a phase is classified: a genuine One Minhaj need or an unnecessary generic-product feature; its **semantic owner**; whether the **current** phase or a named **later owning** phase delivers it; and any security, privacy, legal or religious gate. Genuine in-scope needs are delivered, later ones are recorded against their owner, and generic features are not added |
| **Data scale** | Bounded queries and page sizes, deterministic ordering with tie-breakers, relevant indexes, no whole-corpus client filtering, bounded bulk actions (ARCHITECTURE.md §13.9). **A phase claims no scale it has not exercised** |
| **Time and money** | Authoritative instants in UTC, IANA zones for user scheduling, exact non-floating money (DOMAIN_MODEL.md §19.5–§19.6) |
| **Slug history** | A phase that delivers an **editable public canonical slug** delivers that resource's **native slug history and 301 behaviour in the same phase** (DOMAIN_MODEL.md §19.7). It never defers redirects to Migration |
| **Derived work** | Search, cache, sitemap, email and provider effects are **not** described or tested as atomic with the authoritative domain transaction. Where correctness needs them, the phase delivers durable, observable, retryable derived-work intent (ARCHITECTURE.md §8.5) |
| **Concurrency** | Material operator mutations carry expected-version/state conflict handling; stale publish, stale approval and stale grant updates are rejected (DOMAIN_MODEL.md §19.8) |
| **Outbound communication** | A phase that sends mail owns the event and its eligibility, and sends through the shared provider contract — **never a direct provider call from a business context** (ARCHITECTURE.md §4.6.1) |
| **Personal-data disposition** | A phase owning personal data documents and tests its own access, export, retention and disposition behaviour (SECURITY_BASELINE.md §19.1) |
| **Audit** | Domain audit records where required |
| **Logging** | Structured; no secrets, tokens or personal content |
| **Context boundaries** | Dependency rules respected; **violations fail the build; no ESLint exceptions** |
| **Search projection** | Every searchable domain has a projection, filters and tests. A domain delivered **after** Search Foundation adds its own — so **Phase 17 is in its dependency path**. A domain delivered **before** Phase 17 has its projection added in Phase 17 or in a named later step. **Phase 31 proves none is missing** |
| **SEO** | Canonical, `hreflang` and structured data correct for delivered routes |
| **Testing** | Unit, integration, and E2E for critical paths |
| **Licensing awareness** | A phase that introduces a dependency, font, icon set, image, embed or dataset records its licence at introduction (TECH_STACK.md §18) |
| **No AI attribution** | No agent branding, co-author trailers or generated-by notices anywhere |

---

### 3.1 Four gate types — what a phase's completion does and does not mean

A phase is blocked by different kinds of thing, and treating them as one kind produces two
opposite errors: either a religious-authority decision is quietly waived to keep building, or
the entire software roadmap stalls because an external corpus is unavailable. **Neither is
acceptable**, so the gates are named separately.

| Gate type | What it gates | Who closes it |
|---|---|---|
| **Implementation gate** | Whether the software for a phase may be **built and proven** | Engineering prerequisites, plus any external decision that genuinely changes the **required software semantics** |
| **Activation gate** | Whether a delivered capability may be **switched on in production** | The owning external authority |
| **Content-acceptance gate** | Whether **authoritative real content** may be published | Religious or organisational authority |
| **Launch gate** | Whether the platform **goes live on the official origin** | Minhaj-ul-Quran International |

**The rule that follows from this:**

> **A phase dependency is satisfied by the owning phase's approved ENGINEERING
> IMPLEMENTATION EXIT**, unless that dependency itself genuinely requires the external
> production decision.

So downstream *software* is not held hostage to an unavailable official corpus. Equally:

> **An engineering implementation exit is never described as authoritative corpus acceptance,
> religious production approval, safeguarding approval or launch approval.**

A phase may therefore stand at:

```
ENGINEERING IMPLEMENTATION   COMPLETE
AUTHORITATIVE CONTENT        OPEN
PRODUCTION ACTIVATION        BLOCKED
LAUNCH                       GATED
```

and that is an honest, fully reportable state — not a completed phase and not a stalled one.

**This distinction may never be used to weaken religious integrity, safeguarding, security,
licensing, privacy or migration authorisation.** Where an external decision genuinely
determines required behaviour — a guardian-consent rule, an age threshold, a retention rule —
that behaviour remains an **implementation gate** until the decision exists, and the
capability stays **fail-closed** in the meantime (§4, Phases 18–20 and 23–25).

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

**Tests:** Migrations apply and roll back **on a disposable, empty database**; **the
application account cannot UPDATE or DELETE audit rows**; a restore is performed
successfully.

> **The reviewed rollback artifact is a migration-correctness proof, not a production
> rollback procedure.** It is exercised against a disposable database that holds no accepted
> data, where dropping the objects and deleting the history row costs nothing. **A
> destructive reverse script is not automatically a safe production rollback**, and direct
> mutation of migration history is not a routine production recovery step. Future migrations
> against **populated** business schema follow the safety requirements recorded in
> `packages/database/README.md` — reviewed plan, data-preservation strategy, populated
> rehearsal where material, roll-forward plan, restore plan, and compatibility with the
> deployment rollout.

**Exit:** Database tooling proven. Restore proven. No premature business schema. **The
disposable-database proof implies no production rollback semantics.**

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

> **This phase depends on neither Phase 3B nor Phase 21.** Authentication needs neither the
> topic taxonomy nor personalisation. **Account setup** — the account, its verified email, its
> interface locale and timezone, its account-setup state — is owned here. **Personalisation
> onboarding** — interests, goals, learner level, preferred format — is owned by Phase 21
> (DOMAIN_MODEL.md §4.2, §14.1). Merging them would recreate the `2 -> 3 -> 2` cycle that
> splitting the former Phase 3 removed.

**Three dependencies are introduced and compatibility-validated here**, at their genuine point
of introduction (TECH_STACK.md §16.3):

- **Better Auth 1.7.x** — the authentication library.
- **The privileged second-factor mechanism** — TOTP plus single-use recovery codes, proven
  against the chosen Better Auth configuration, Prisma 7.10.0, SQL Server and the accepted
  Identity schema. **No Better Auth API, plugin or schema behaviour is asserted in advance of
  that proof** (SECURITY_BASELINE.md §8.2).
- **Playwright 1.55.x** — this is the first genuinely browser-critical phase
  (ARCHITECTURE.md §13.10).

**Deliverables:** Identity & Access context with internal sub-layering (ARCHITECTURE.md §6.2)
· User, Account, Session, Verification · **email/password** with verification and reset ·
**account email, interface locale, timezone, account status and account-setup state**
(DOMAIN_MODEL.md §4.2) · **the account lifecycle invariants of DOMAIN_MODEL.md §4.6** —
canonical email comparison, race-safe database-enforced uniqueness, signup and email-change
collision handling, verified email change, disable, suspension, reactivation, closure and
later re-registration · session management with revocation · **Permission, Role,
RoleAssignment — the single enforcement path** · **capability projections as derived
read-only views** · `can()` helpers for Server Actions and Route Handlers · **step-up
reauthentication mechanism** · **privileged second-factor enrolment and verification**
(SECURITY_BASELINE.md §8) · **the one-time initial privileged operator bootstrap**
(SECURITY_BASELINE.md §8.3) · sign-in, sign-up, reset and **account-setup** routes ·
**sign-out as a POST action** · CSRF protections · rate limiting via the **RateLimiter
abstraction** · authentication and permission audit logging · **the durable outbound
communication mechanism at its first genuine need** (ARCHITECTURE.md §4.6.1) · **a usable
minimum Account & Security surface** plus the **initial identity administration surfaces**
(ROUTE_MAP.md §5.1) · **the minimum shared visual and interaction foundation** those surfaces
require, taken from the design-system contract rather than invented locally
(ARCHITECTURE.md §13).

> **Identity security capabilities must not exist only as backend services.** If a user can
> change a password, revoke a session, review connected accounts or enrol a second factor in
> the domain layer, they must be able to do it **in the product**. Phase 4 later delivers the
> canonical broad design system and public shell; this phase delivers only the minimum that
> authentication, Account & Security and the privileged entry surfaces genuinely need —
> **built from the shared contract, never as throw-away styling**.

**Explicitly NOT in this phase:** Topic, Language or Tag schema · interests and goals ·
personalisation aggregates · notification preferences · the broad public design system · any
content domain.

**Tests:** Sign-in, verification, reset · session expiry, rotation, revocation ·
**negative permission tests prove denial** · **horizontal privilege escalation fails** ·
**capability projections cannot bypass permission checks** · open redirect attempts rejected ·
**no Class-A browser mutation is performed by GET** (SECURITY_BASELINE.md §7.1) · browser CSRF
protection verified · **authentication callbacks verified against their own protocol contract**
(§7.3) · **verification and reset links render on GET without silently mutating, consume their
token at the confirming action, and reject expired or reused tokens** (§7.4) · rate limiting
effective · no user enumeration.
Additionally: **signup collision under concurrency resolves to exactly one account** ·
**email-change collision is rejected safely** · **a canonical-equivalent address cannot create
a second account** · reset and verification token reuse fails · **account status is enforced
on every authenticated request** · **closure does not restore prior grants or private data on
later re-registration** · **the final usable authentication method cannot be removed** ·
**sessions are revoked after a high-risk security or privilege change** · **privileged
capabilities are refused until the required second factor is enrolled** · **recovery codes are
single-use, and regeneration invalidates the prior set** · **no administrator action silently
disables a second factor to restore privileged access** · **the bootstrap is one-time,
race-safe, audited and unavailable after first success** · **self-elevation fails** · **a
committed security event whose mail delivery fails is retried idempotently without minting a
second verification or reset token**; **a password reset, password change or verified email
change remains durably discoverable for token-free audit/notification reconciliation after a
process crash, without a generic workflow engine or second bearer store** (ARCHITECTURE.md
§4.6.1).

**Exit:** Base authentication and the single authorisation path working, with security tests
passing, **reachable through a usable Account & Security surface**. **Google is not required
for this phase.**

> **Gate status (§3.1).** This phase's **implementation gate** includes the transactional-email
> entry gate above, because verification and reset are unusable without delivery. **Selecting a
> provider does not close it** — it closes on the evidence listed in OPEN_DECISIONS.md §5.1.

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
`robots.txt` · **the pre-adoption indexing posture** (ROUTE_MAP.md §9.5) · **organisational
presentation infrastructure** · **the canonical product design system** (ARCHITECTURE.md §13)
— semantic tokens, tri-script typography, the component and state contract, responsive
breakpoint behaviour, navigation and scroll behaviour, and the motion and reduced-motion rules.

> **Phase 4 owns the canonical broad design system; Phase 2 delivered only the minimum
> foundation its own surfaces needed.** This phase extends that foundation to the full public
> product — it does not replace it, and Phase 2's surfaces are not restyled from scratch.
> Later specialised phases extend it again for readers, media, editorial, religious content,
> learning and administrative complexity. **There is one design system**, and no phase forks
> it (ARCHITECTURE.md §13.1).

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
verified · canonical and `hreflang` correct · **layouts hold from small phone to wide desktop
with no horizontal overflow, in LTR and RTL** · **`prefers-reduced-motion` suppresses
non-essential motion** · **the pre-adoption origin emits `noindex` and is excluded from
submitted sitemaps** · **no Page aggregate, Editorial schema or
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

> **PHASE-2 MAINTENANCE GATE — MUST BE RESOLVED BEFORE PHASE 6 STARTS.** The Phase-5
> actual-diff review confirmed two inherited Identity & Access defects that are outside
> Phase 5 ownership and unchanged by this phase: (1) `changePassword` catches every
> `auth.changePassword` failure and reports `invalid-credentials`, so infrastructure and
> reconciliation failures can be misclassified as a bad current password; (2) the live
> mutual-administrator revocation proof requires exactly one fulfilled transaction, but the
> underlying concurrent SQL path has no deterministic retry/serialization contract for a
> deadlock or lock-victim outcome. Phase 2 maintenance must narrow the password failure
> mapping, make the revocation concurrency outcome deterministic (including bounded retry
> where appropriate), and add regression proofs for both. These are recorded here as a
> hard entry gate; they are not reassigned to Phase 5 and are not evidence that Phase 5 may
> broaden into Identity implementation work.

---

### Phase 6 — Editorial Core
**Entry:** Phases 4 and 5 complete.

**Deliverables:** Article and **Page** aggregates — **Page is introduced here and only here** ·
**shared editorial workflow enforced server-side** · revision history · **separation of duties**
— author cannot approve own work by default · Tiptap for editorial content only ·
**server-side HTML sanitisation** · admin editorial routes and queue · typed topic assignment ·
public article routes · **organisational and legal Page records replacing the non-authoritative
Phase 4 placeholders on the reserved routes** · audit logging · **native slug history and
automatic 301s for the editable canonical slugs introduced here** (DOMAIN_MODEL.md §19.7) ·
**expected-revision concurrency control** for editorial mutations (DOMAIN_MODEL.md §19.8) ·
**durable scheduled publication** (§ below) · the **limited private correspondence area** —
**ContactInquiry** and **Feedback** (DOMAIN_MODEL.md §7.5) with triage, spam disposition,
operator notes, retention and a permission-controlled admin surface.

> **Scheduled publication is owned here, as its first concrete owner.** The schedule is
> durable and cancellable; the executor is bounded; catch-up after downtime is defined; and
> execution **re-checks current state, current approval and current authority** before it
> publishes, so a superseded approval can never publish. Retry is safe. **No generic worker
> platform, queue product or event bus is introduced because scheduling exists**
> (ARCHITECTURE.md §8.5).

> **The correspondence area is not a CRM and not public editorial content.** ContactInquiry
> and Feedback are private records with their own lifecycles; a Fatwa Question remains
> Fatwa-owned and entirely separate (DOMAIN_MODEL.md §12). Ordinary published contact
> *information* stays a **Page**.

> **This phase is the single introduction of the Page aggregate.** Phase 4 delivered
> presentation infrastructure and reserved routes; it created no Page model. Once Page exists,
> organisational and legal content is **published only through this workflow** — there is no
> parallel path and no grandfathered content (OPEN_DECISIONS.md §2.3, §6.1).

**Tests:** Lifecycle transitions enforced server-side · **workflow bypass attempts fail** ·
**XSS payloads sanitised** · negative permission cases · author self-approval blocked ·
`Article` and `BreadcrumbList` structured data valid · **organisational and legal pages are
publishable only through the reviewed workflow** · **exactly one Page aggregate exists in the
system** · **a slug change 301s from the previous slug, and slugs are never reused** · **a
stale-revision publish is rejected** · **two operators editing one record produce a reported
conflict, not a silent overwrite** · **an edit after approval invalidates that approval, and
the scheduled publish then refuses** · **a cancelled schedule does not fire** · **a schedule
whose moment passed during downtime is caught up deliberately, re-checking authority** ·
**ContactInquiry and Feedback are private, rate-limited, permission-gated, and never appear in
public listings, search or caches**.
**Exit:** Content publishable only through the reviewed workflow.

---

**Phase-6 continuity:** Organisational Page facts (§6.1), legal bodies (§2.3), named editorial
grants/team structure (§6.3, §6.5) and correspondence retention (§2.3.1) remain external gates
in OPEN_DECISIONS. No production content or real editorial-team grants are engineering seeds.
Self-approval has no exception path. Storage (7), News/Events/Collections (13–15), Search (17),
live migration (30), formal SEO/accessibility acceptance (32) and performance/operations (34)
remain with their existing owners; Phase 2G remains separately deferred.

Phase-6 local implementation remains unstaged, uncommitted and unpushed pending independent
targeted actual-diff review. The separate whole-baseline architecture milestone still follows
Phase-6 remote-green; the builder run does not consume it.

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
People & Contributors · SalePoint · public library routes · admin management · **a genuinely
usable long-form reading experience for available editions** — edition selection, truthful
language and translation relationships, reader navigation, reflow, accessible reading controls
· **a stable position identifier** that later authenticated reading position can attach to ·
**rights-aware download availability** · **an explicit unavailable-edition state** · large PDF
and file handling through the Phase 7 StorageService, **with this phase's own Identity-derived
authorisation policy where an edition is not public** (§3).

> **PRODUCT_SCOPE.md §2.1 promises readable access, not a catalogue card.** This phase does not
> end at metadata pages. A visitor who reaches a Work must be able to **read what is genuinely
> available**, and to see honestly when an edition is not available to them — rights, not a
> missing feature, are the only acceptable reason a download is absent.

> **The position identifier is a seam, not a feature.** Phase 8 defines a stable way to name a
> location in an edition; **Phase 21 later owns the authenticated reading position and history**
> that uses it (DOMAIN_MODEL.md §14.1). Phase 8 stores no per-user state.

**Tests:** **A Work with multiple Editions in multiple languages is modelled correctly** ·
**localized metadata is distinguishable from a genuine translated Edition** · contributors
resolve to `/people/{slug}` · `Book` structured data only where genuine ISBN and author exist ·
**a long-form edition is readable, navigable by keyboard and reflows at 200% zoom** · **the
position identifier is stable across reloads and reading-preference changes** · **a
rights-restricted edition offers no download and says so honestly** · **an unavailable edition
renders an explicit state rather than an error or an empty page** · **no per-user reading state
is stored in this phase**.
**Exit:** Library modelled without conflating localisation and translation, **and genuinely
readable** — not a metadata-only catalogue.

---

### Phase 9 — Research & Publications
**Entry:** Phases 8 and **17** complete.

> **Phase 17 is a prerequisite** because this phase is searchable and promises a **search
> projection** (§3). Stating it makes the integration deterministic rather than dependent on
> the order the phases happen to run in.

**Deliverables:** Research, ResearchPaper, Publication, Magazine, MagazineIssue, Encyclopedia ·
public routes · admin management · **search projection, filters, publication and removal
behaviour, rebuild behaviour and visibility rules** · native slug history for the editable
canonical slugs introduced here.
**Tests:** Issue hierarchy navigation · contributor references · **unpublished and archived
records never appear in search** · **a withdrawn record leaves the index and the listings** ·
standing requirements.
**Exit:** Scholarly and periodical content complete **and searchable**.

**Phase-9 continuity — decisions made while delivering, recorded here rather than left in
review history:**

- **Six aggregates, six tables.** Each has its own slug namespace and typed label, contributor
  and topic relations; Research and ResearchPaper also own ordered citations. They share value
  shapes (a label, a credit, a citation, date facts), never a table. Research and ResearchPaper
  are independent — neither is the other's parent — and a paper alone records where it appeared
  and its own DOI. No MagazineArticle, PublicationIssue or EncyclopediaEntry exists: an
  encyclopedia's structure is its readable document (DOMAIN_MODEL.md §10.2).
- **Content.** Titles and summaries are localized descriptive metadata; the text's own language
  is a Taxonomy reference. Abstracts, institutional context, venues and citations are bounded
  plain text; long-form text is the Library's existing semantic reader document. A citation is
  its text plus, only where known, an HTTPS address and a DOI — nothing is looked up. Publication
  dates are SQL `date` values that agree with their year.
- **Lifecycle and visibility.** Draft, published, archived. An issue is public only while its
  Magazine is; a published Magazine with no published issue says so.
- **Slugs.** An issue's slug and (volume, number) are unique within its Magazine, and an issue
  cannot move to another Magazine — the composite key of its slug reservations refuses it. A
  former Magazine slug with a former issue slug resolves to the current address in one 301.
- **Search.** Each aggregate is its own kind and scope. A Magazine's change requests each of its
  issues in the same transaction, and an issue's stamp includes its Magazine's version. A
  record's own text is matched only in its content language; citations are not matched.
- **Permissions.** `library.read` and `library.administer` cover the six; there is no
  `research.*` or `magazine.*` key.
- **Not delivered, and not owed by this phase:** files and downloads for these aggregates
  (Phase-9 records are read as text; a file relation arrives with the owner that needs one, through
  Storage); a contributor filter on the Phase-9 listings (no surface consumes one); cross-type
  facets on `/library/topics`, `/library/languages` and `/library/authors`, which remain Work
  browses and say so, while `/library/resources` and `/topics/{slug}` include every delivered type.

---

### Phases 10–12 — Media, split into three slices

**Phase 10 enters from 5, 6 and 17** — Video is searchable and delivers its projection
deterministically. **Phase 11 enters from 7 and 10** — non-Quran audio is storage-backed and
supplies its own Identity-derived authorisation policy against the Phase 7 default-deny serving
route (§3). **Phase 12 enters from 7 and 10**, unchanged.

| Phase | Slice | Deliverables | Key tests |
|---|---|---|---|
| **10** | **Video** | Video with provider metadata, Series, Playlist, speaker references, embed components, **CSP provider allowlist**, **the third-party embed privacy contract** (ARCHITECTURE.md §4.7.1), public watch routes, **search projection and filters**, native slug history | Embeds render; **no video files hosted**; `VideoObject` structured data valid; a video belongs to one Series but many Playlists; **a removed or failed provider item degrades to an accessible fallback, never a broken frame**; **no non-essential provider tracking loads before the privacy posture allows it**; **unpublished video never appears in search** |
| **11** | **Audio** | AudioTrack, AudioSeries — **non-Quran audio only**, `/listen` routes, **storage-backed asset lifecycle through Phase 7 with this phase's own authorisation policy**, search projection, native slug history | **No AudioTrack can duplicate a Quran Recitation** (DOMAIN_MODEL.md §8.1); **a private or unpublished audio asset is unreachable without an explicit allow decision**; the player is keyboard-operable with no autoplay with sound |
| **12** | **Galleries** | Photo, Gallery, GalleryItem and the historical archive. **No Event relationship is created here** — Event does not yet exist | Asset handling via Phase 7, **with this phase's own authorisation policy where assets are private**; accessibility of image content; **no forward reference to Event exists** |

> **Captions and transcripts are surfaced where the source genuinely supplies them, and are
> never fabricated** (SECURITY_BASELINE.md §16.2–§16.3). A missing transcript is recorded as
> missing, not invented.

**Phase-10 continuity — decisions made while delivering, recorded here rather than left in
review history:**

- **Three aggregates, no more.** Video, Series and Playlist (DOMAIN_MODEL.md §11). A
  **programme is a Series of kind `program`**, not a Program aggregate; the curated Watch views
  (`lectures`, `events`, `highlights`, `interviews`, `documentaries`) are a Video's optional
  **format**, not Lecture/Interview/Documentary entities and not an Event reference.
- **One canonical address per Series.** The kind picks `/watch/series/{slug}` or
  `/watch/programs/{slug}`; the other family and every former slug answer one 301 to the current
  address, across a kind change and a rename together.
- **Provider input.** An operator supplies a provider and its video identifier or one of that
  provider's ordinary HTTPS watch addresses, reduced to `provider + providerVideoId`; every
  other scheme, host, credential, port, extra path and Vimeo private-link hash is refused. No
  provider API or credential exists, and nothing fetches provider metadata at render.
- **Availability** is an operator-recorded fact, orthogonal to publication: a known-unavailable
  Video keeps its page and offers the provider link instead of a player.
- **Embed privacy and CSP** as recorded in ARCHITECTURE.md §4.7.1 — click-to-load, privacy-enhanced
  hosts, no painted provider thumbnail, frame allowance only on the two player routes.
- **`VideoObject`** is emitted only when the title, the provider's thumbnail and the provider's
  publication date are all known and the Video is available; otherwise none is emitted.
- **Search** gains the `video` kind only. Its documents carry title, description, content
  language, topics, year and — only in the content language — an organisation-held transcript;
  no provider identifier, address, availability or speaker name.
- **Permissions.** `media.read` and `media.administer`, bundled into Platform Administrator; no
  per-entity or publish key. Admin surfaces delivered: `/admin/media/{videos|series|playlists}`.
- **Composition.** Videos appear on `/topics/{slug}` and on a speaker's `/people/{slug}` through
  Media's public reader; `/watch/speakers` browses People with public Videos and each detail
  301s to the profile. The Explore lectures view remains reserved: no data identifies its
  subject.
- **Not delivered, and not owed by this phase:** audio, photos, galleries and `/listen`
  (Phases 11–12); Quran, Hadith and Event relationships (their owners); watch history
  (Phase 21); automatic provider availability or metadata refresh.

**Phase-11 continuity — decisions made while delivering, recorded here rather than left in
review history:**

- **Two aggregates, non-Quran only.** AudioTrack and AudioSeries (DOMAIN_MODEL.md §11); an
  AudioSeries is not the Video `Series`. Nothing can describe a recitation, and
  `/listen/recitations` has no route until Quran ships its catalogue.
- **Two independent allows.** A track's bytes are served on `/assets/media/audio/{track}/{asset}`
  only when Media's policy allows (the exact asset recorded on that track, the track
  published) AND Storage's custody allows (clean, bytes present). The administrator's preview,
  `/assets/media/previews/audio/{track}/{asset}`, needs a live `media.administer` and still only
  serves the recorded asset. There is no download purpose.
- **One large browser upload, and the global cap unchanged.** An audio file is uploaded as a
  raw streamed body to `POST /api/admin/media/audio/{id}/asset` — a Class-A Route Handler with
  explicit anti-CSRF (SECURITY_BASELINE.md §7.1, §10.1) — and never through a Server Action,
  whose body cap stays global and unraised. MP3 (`audio/mpeg`) is the one accepted format,
  recognised from its bytes; the per-file ceiling is a technical bound equal to Storage's
  default (64 MiB). A file the scanner cannot clear is held in quarantine and not attached.
- **Seeking is a single `bytes=` Range**, answered 206 or 416 only after both allows; anything
  else is served whole (ARCHITECTURE.md §4.2).
- **The player is the browser's own** `<audio controls preload="none">`: keyboard-operable, no
  autoplay, nothing fetched before play. No cover art is invented; rows carry a first-party
  audio mark. No `AudioObject` is claimed (ROUTE_MAP.md §9.6); pages carry `BreadcrumbList`.
- **Search** gains the `audio` kind only; its documents carry what a Video's do and nothing
  about the file. An AudioSeries is not a kind.
- **Permissions.** No new key: `media.read` and `media.administer` govern audio, and their
  descriptions now say so. Admin surfaces: `/admin/media/audio` and `/admin/media/audio/series`.
- **Composition.** Audio appears on `/topics/{slug}` and on a speaker's `/people/{slug}` through
  Media's public reader; the Watch landing links to Listen. There is no `/listen/speakers`.
- **Recovery is SQL and bytes.** The populated SQL rehearsal carries audio rows; the storage
  rehearsal restores the database and the storage root together and proves checksums, the
  policy and the Search rebuild on the restored pair.
- **Not delivered, and not owed by this phase:** photos and galleries (Phase 12); Quran
  recitations (Phase 18); any listening history; transcoding, waveform, duration detection or
  speech-to-text; audio downloads; a second audio format.

**Phase-12 continuity — decisions made while delivering, recorded here rather than left in
review history:**

- **Three shapes and no Event.** Photo, Gallery and GalleryItem (DOMAIN_MODEL.md §11). A
  Gallery exists independently; no column, table or code path references an Event, Centre or
  Collection, and no Gallery has a kind. The typed Event↔Gallery association is Phase 14's.
  People and Topics are not attached to photographs: no current contract needs them, and no
  person is ever inferred from an image.
- **A Photo has no page.** ROUTE_MAP.md §3.9 names none, so a Photo has no slug and no sitemap
  URL; it is seen in `/media/photos`, the archive and its Galleries, and opens in an accessible
  viewer — the browser's own modal `<dialog>`, labelled previous and next, arrow keys that
  follow the reading direction, focus returned on close, nothing that moves on its own.
- **Two independent allows, as for audio.** An image is served on
  `/assets/media/photos/{photo}/{asset}` only when Media's policy allows (the exact asset
  recorded on that Photo, the Photo published) AND Storage's custody allows. The preview,
  `/assets/media/previews/photos/{photo}/{asset}`, needs a live `media.administer`. There is no
  download purpose, and `/media/downloads` has no route.
- **Withdrawal is immediate.** Public images are `private, no-cache` with the stored checksum as
  their validator; a `304` is sent only after both decisions, so an archived Photo stops being
  shown even by a browser that holds it. No image optimiser or remote image host is used.
- **Still images only, validated and cleaned by Storage.** JPEG and PNG, recognised from their
  bytes, structurally whole, within 40 megapixels and 16,384 pixels a side, at most 16 MiB; the
  stored and served bytes carry no EXIF, XMP, IPTC, comment, embedded thumbnail or trailing
  data — only the orientation survives (ARCHITECTURE.md §4.2). The pixels are never decoded on
  the server and never re-encoded. The upload is `POST /api/admin/media/photos/{id}/asset`, on
  the Phase-11 pattern, with its own per-account budget; the global Server Action cap is
  unchanged.
- **No derivatives.** The image an operator uploads is the image a visitor receives: grids load
  it lazily, bounded to one page of twenty-four, with its recorded dimensions so nothing shifts.
  A smaller display rendition would need a server-side image decoder, a dependency review and a
  derived-work lifecycle; it is a performance decision recorded against Phase 34.
- **Words are never generated.** Alternative text and a caption per locale, a credit and a date
  are what an operator writes; a missing alternative is shown as missing, never invented or
  passed off as decorative, and the administration filters for it. A date is a year, a month and
  year, or a full date — never a record's creation time.
- **Galleries.** At most 240 Photos, ordered, duplicate-free, changed by named changes under the
  expected version; the cover is the first public Photo in the order; a published Gallery is
  listed, and in the `galleries` sitemap segment, only while it holds a public Photo. Removing
  membership never removes a Photo, and nothing deletes a Photo or its Asset.
- **The archive** is `/media/archive?year=&month=` over published Photos whose date is known.
- **Search is unchanged.** No `photo` or `gallery` kind: Phase 12 does not carry Phase 17 in its
  dependency path, and Phase 31 reconciles the final searchable inventory.
- **Permissions.** No new key: `media.read` and `media.administer`, re-described. Admin
  surfaces: `/admin/media/photos` and `/admin/media/galleries`. Until News & Events and
  Collections ship their entry points (INFORMATION_ARCHITECTURE.md §2.2), the Watch landing links
  the photograph surfaces.
- **Recovery is SQL and bytes**, rehearsed together; no derived image exists to rebuild.
- **Not delivered, and not owed by this phase:** Event galleries (Phase 14); photo downloads;
  display derivatives (Phase 34's decision); any other image format; face, object or location
  recognition; generated captions or alternative text; legacy photograph migration (Phase 30).

---

### Phases 13–15 — News, Events, Collections, split for verification

| Phase | Deliverables | Key tests |
|---|---|---|
| **13 News** | NewsArticle, PressRelease, Statement, MediaCoverage; archive; public routes; **search projection and filters**; native slug history. **Enters from 6 and 17**, because News is searchable and delivers its projection deterministically | `NewsArticle` structured data; `?sort=latest` is a query, **not a path**; **unpublished and archived news never appears in search**; **a slug change 301s** |
| **14 Events** | Event, EventSchedule; **typed Centre references — Global Network (16) is already delivered**; **the typed Event↔Gallery association, owned here because both targets now exist** | `Event` structured data with genuine date and location; **the Centre reference is a real foreign key, not a placeholder**; **Events owns no Gallery schema and Galleries owns no Event schema**; **no polymorphic placeholder is used to dodge ownership** |
| **15 Collections** | Collection with **typed item membership**; curated mixed-type sets. **Membership types cover only the content types delivered by this phase's prerequisites**; a later domain adds its own membership type when it arrives | **Deleting a Collection deletes no content**; **no polymorphic references**; item integrity enforced; **no membership type is pre-created for a domain that does not yet exist** |

**Phase-13 continuity — decisions made while delivering, recorded here rather than left in
review history:**

- **Four Editorial aggregates, one workflow.** NewsArticle, PressRelease, Statement and
  MediaCoverage each have the Article's own tables (DOMAIN_MODEL.md §7.2.2); Article, Page and
  News share one set of workflow persistence rules and one service, so no second News workflow
  exists. A Statement names its issuing authority per translation; a MediaCoverage record its
  outlet and, where known, an HTTPS source and date.
- **Permissions.** No new key: `content.read` and `content.author` are re-described to name the
  News families. Admin surfaces: `/admin/editorial/{news|press-releases|statements|media-coverage}`,
  and the shared review queue lists all six workflow-governed aggregates.
- **Scheduling.** The Phase-6 executor, extended: at most 25 due records of each of the six
  aggregates per sweep, authority re-checked, catch-up after downtime, duplicate execution
  harmless.
- **Public.** `/news` is the News and Events entry point — the latest NewsArticles
  (`?sort=latest` is the only order and canonical to `/news`), the other three families, the News
  archive and the Phase-12 photograph surfaces, which the Watch landing no longer links. The
  archive is `/news/archive?year=&month=` over all four families by UTC publication instant.
  Cards are text — type, date, headline, summary, byline, topics — with no image. A coverage
  record's source is a described outbound link, never an embed or a redirect.
- **Slugs.** Each family its own history, one-hop 301 through the request proxy, locale kept.
  The static `/news` siblings are reserved words a NewsArticle slug can never hold, and the proxy
  passes over them before any lookup.
- **Search.** Four kinds and scopes — `news-article`, `press-release`, `statement`,
  `media-coverage` — so the type filter tells them apart. Documents carry title, summary, body
  text, a Statement's issuer and a coverage record's outlet, never its source address; each
  family's current target is resolved from Editorial's published predicate.
- **SEO.** `NewsArticle` JSON-LD for a NewsArticle, a press release and a statement — headline,
  language, address, genuine dates and, except for a statement, credited People; never an image,
  publisher or logo. MediaCoverage claims no article (BreadcrumbList only). The `news` sitemap
  segment lists published detail URLs in the languages each genuinely has.
- **Topic hub.** `/topics/{slug}` shows the latest published News of every family on the topic
  from Editorial's own read. A People profile shows no News panel: Editorial exposes no
  contributor facet for Articles either.
- **Recovery is SQL.** The populated rehearsal and a Search-after-restore proof cover all four
  families; Search rebuilds from the restored Editorial owner.
- **Not delivered, and not owed by this phase:** Centre-scoped News (Phase 16); Events and
  Event↔Gallery (Phase 14); Collections (Phase 15); the newsletter (Phase 21); RSS (no accepted
  feed composition exists yet); News images (an explicit Storage/Media dependency decision);
  popularity, view counts or featured News.

**Phase-14 continuity — decisions made while delivering, recorded here rather than left in
review history:**

- **One new same-level edge, Editorial → Media** (DOMAIN_MODEL.md §3.2; ARCHITECTURE.md
  §6.1.1), because an Event owns its typed association to Media-owned Galleries. The reverse is
  prohibited and mechanically refused; Editorial asks Media's reference interface and reads no
  Media table, Media holds no Event schema, and Editorial → Global Network now also serves
  Events.
- **Model.** Event is its own Editorial aggregate with the Article's shape of tables. Its zone,
  occurrences (`EventSchedule`), optional Centre and ordered Galleries (`EventGallery`, at most
  twelve) are immutable revision state, so retiming, moving or re-photographing an Event is an
  ordinary edit that needs fresh review and is audited as its own fact (DOMAIN_MODEL.md §7.2.3).
  Contributors and Topics follow the shared pattern; no venue text, coordinates, image,
  organiser, price, registration, recurrence rule or livestream exists.
- **Time.** One to twelve occurrences, each the intended local wall-clock time in one IANA zone
  plus the UTC instant the server derived from it. A skipped local time is refused; a repeated
  one is refused until the editor chooses the earlier or later instant; an end is strictly after
  its start. The occurrence schedule is never the publication schedule.
- **Permissions.** No new key: `content.read` and `content.author` are re-described to name
  Events. Admin surface: `/admin/editorial/events`; the shared review queue and the scheduled
  executor (25 due records of each of the seven aggregates per sweep) include Events.
- **Public.** `/events` lists upcoming Events by default (ongoing ones first) and `?when=past`
  the held ones; `?country=`, `?city=` and `?centre=` narrow through Global to Centres
  physically there and never widen; an unknown filter is refused, an over-broad one reported.
  All are canonical to `/events` and absent from sitemaps. An Event page shows its occurrences
  in their local time and zone, its public Centre and locality, its topics and contributors, and
  links its photographs. `/events/{slug}/gallery` is a `noindex` navigational view over the
  Event's listed Galleries, each linking to its own canonical `/media/galleries/{slug}`. Local
  Events are `/global/centres/{slug}/events` and a section on each Centre page; `/news` links
  Events; the topic hub shows a topic's upcoming (else past) Events.
- **Slugs.** Native Event slug history, one-hop 301 through the request proxy, locale kept; a
  former slug with the `/gallery` suffix resolves to the current gallery view in one hop.
- **SEO.** `Event` JSON-LD only with a genuine location — a public physical Centre with a City
  or an address — one `Event` per occurrence, local times with offsets; otherwise
  BreadcrumbList alone. The `events` sitemap segment lists published Events in their genuine
  languages.
- **Search unchanged.** Phase 14 enters from 6, 12, 13 and 16, not 17: no Event kind, scope,
  filter or indexing intent. Phase 31 reconciles the final searchable inventory.
- **Recovery is SQL.** The populated rehearsal covers a published Event with translations,
  a renamed slug, occurrences across a daylight-saving change, a Centre reference and a Gallery
  association.
- **Content gate open.** Engineering completion is not authoritative Event content; no real
  Event is seeded, and OPEN_DECISIONS.md §6.2 still governs real Centre data.
- **Not delivered, and not owed by this phase:** Collections (Phase 15); Event search (a recorded
  later step; Phase 31 proves completeness); registration, RSVP, ticketing, booking, attendance,
  reminders, calendar export or integration, maps, geocoding and livestream links (no accepted
  decision); real or legacy Event import (Phase 30, under written authorisation); an Event lead
  image (an explicit Storage/Media decision); an Events panel on People profiles (Editorial
  exposes no contributor facet, as for News).

**Phase-15 continuity — decisions made while delivering, recorded here rather than left in
review history:**

- **One new same-level edge, Editorial → Library** (DOMAIN_MODEL.md §3.2; ARCHITECTURE.md
  §6.1.1), because a Collection holds typed Work members; and the Phase-14 **Editorial → Media**
  edge now also serves Collection → Video. Both reverses are prohibited and mechanically
  refused. Editorial's own code imports neither owner: Layer 4 asks Library's and Media's public
  reference reads (`workReferences`/`workChoices`, `videoReferences`/`videoChoices` — public
  records only, identity, slug and titles) and reads none of their tables.
- **Model.** Collection is its own Editorial aggregate with the Article's shape of tables and the
  shared workflow; it is not Personalisation's `PrivateCollection` and shares nothing with it.
  Its ordered members are immutable revision state (`CollectionItem`), so changing membership or
  order is an ordinary edit that needs fresh review and is audited as its own fact
  (DOMAIN_MODEL.md §7.3.1).
- **Member inventory — exactly the prerequisites' content records:** Article (6); NewsArticle,
  PressRelease, Statement and MediaCoverage (13); Work (8); Video (10). Not members: Page,
  Edition, BookTranslation, Series, Playlist, and every type outside the dependency path —
  Event, Photo, Gallery, audio, Phase-9 research and publications, Quran, Hadith, Fatwa,
  Learning, Centres, People and private collections. No column is reserved for any of them.
- **One typed member per place, one order for all types.** Seven nullable, non-cascading,
  foreign-keyed columns; a CHECK that exactly one is set; the position as the primary key, so
  no two members of any types share a place; a filtered unique index per column so no record
  appears twice; positions 0–99, so at most **100 members** (one page, one bounded owner read per
  type); and 51156 — a current revision always has a member, so an empty set is never reviewed,
  scheduled or published. No `targetType + targetId` exists.
- **Choosing is asking the owner.** A newly added member must be public now under its owner's
  predicate; a member the current revision already holds may be kept. No author learns of
  another owner's draft through a Collection, and `content.author` is no route into Library or
  Media drafts.
- **Withdrawal.** Target and Collection lifecycles are independent: a withdrawn member is
  omitted from the public page with nothing of it shown, the rest keep their order, and a
  Collection with no public member left says so; nothing auto-archives. Archiving a Collection
  or removing a member changes no target.
- **Permissions.** No new key: `content.read` and `content.author` are re-described to name
  Collections. Admin surface: `/admin/editorial/collections`, with keyboard-operable move
  controls and server-bounded, human-labelled choices; the shared review queue and the scheduled
  executor (25 due records of each of the eight aggregates per sweep) include Collections.
- **Public.** `/collections` (newest published first, bounded pages) and `/collections/{slug}`,
  whose members are resolved in one bounded read per owner and link to their owners' canonical
  addresses. `/news` links Collections and the topic hub lists a topic's Collections. Cards
  carry the Collection's own words only — no image, count or popularity.
- **Not activated, deliberately:** `/library/collections` (no truthful deterministic filter
  exists without reading across owners) and `/explore/shaykh-ul-islam/collections` (no
  deterministic, non-hard-coded Person association); both stay unlinked.
- **Slugs.** Native Collection slug history, one-hop 301 through the request proxy, locale kept.
- **SEO.** Canonical, genuine `hreflang` and `BreadcrumbList` only — no `ItemList`,
  `CollectionPage` or other invented type. The `collections` sitemap segment lists published
  Collections at their current slug in their genuine languages.
- **Search unchanged.** Phase 15 enters from 6, 8, 10 and 13, not 17: no Collection kind, scope,
  filter or indexing intent. Phase 31 reconciles the final searchable inventory.
- **Recovery is SQL.** The populated rehearsal covers a published Collection with translations,
  topics, contributors, a renamed slug and mixed members in a defined order, and a Collection in
  the workflow; Collections own no bytes and no search projection.
- **Content gate open.** Engineering completion is not authoritative Collection content; no real
  or legacy Collection is seeded or imported (Phase 30, under written authorisation).
- **Not delivered, and not owed by this phase:** Collection search (Phase 31 proves
  completeness); members of later domains (each adds its own column when it arrives); private
  saved collections (Phase 21); featured or popular Collections; Collection images.

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

**Phase-16 continuity — decisions made while delivering, recorded here rather than left in
review history:**

- **One new same-level edge, Editorial → Global Network** (DOMAIN_MODEL.md §3.2; ARCHITECTURE.md
  §6.1.1), because a NewsArticle — and in Phase 14 an Event — names a Global-owned Centre. The
  reverse is prohibited and mechanically refused; Editorial asks Global's reference interface
  and reads no Global table, and Global reads no Editorial table.
- **Model.** Country (ISO 3166-1 alpha-2 code as its canonical identity), Region, City,
  Centre, CentreContact and the typed served-City relation, with localised name rows. The
  same-Country rule is composite foreign keys; one locality fact per Centre; explicit virtual
  Centres; exact optional coordinates; a Region or City never changes Country, while a City may
  move between Regions of its Country and its Centres follow (DOMAIN_MODEL.md §17.1.1).
- **Permissions.** `global.read` and `global.administer`, in the protected bundle with the
  same session and step-up revocation every bundle extension performs. No per-level, publish,
  contact or import key. The Media keys' TypeScript descriptions were re-aligned with the
  Phase-12 migration's wording (photographs and galleries); no Media key or behaviour changed.
- **Public.** `/global`, Find a Centre (Country, then a Region or a City — a City includes the
  Centres serving it, once each), Countries, a Country's Regions and direct Cities, Region and
  City pages, Centres, a Centre with its facts, contacts and latest centre-scoped News, its
  `news` and display-only `contact` pages, and the Pakistan structure — a view of the Pakistan
  Country (ISO `PK`) canonical to that Country's page, never a second Pakistan model. Everything
  public sits under public ancestors only; an empty directory says so. No map, geolocation,
  distance sort or Events link.
- **Slugs.** Every level is renamable with native history and one-hop 301s through the request
  proxy; a nested Region or City address with a former Country slug, a former child slug or
  both resolves in ONE hop. The `centres` sitemap segment lists public Centres; Country,
  Region and City pages are reached by links and §9.4 names no segment for them.
- **Centre-scoped News.** The NewsArticle **revision** carries one nullable, non-cascading
  `centreId`; existing revisions name none. Choosing or changing it is an ordinary edit that
  returns the record to draft, clears approval and schedule, and is audited
  (`editorial.news-article.centre-changed`). An editor may choose a Centre that is not archived;
  an already-named Centre is kept truthfully if it is archived later. Archiving a Centre changes
  no News, and a News page shows the Centre only while Global says it is public.
- **Search unchanged.** Phase 16 enters from 6 and 13, not 17: no Global kind, scope or filter,
  and no Centre words in News documents. A Global projection, if ever wanted, is a recorded
  later step; Phase 31 proves completeness.
- **Recovery is SQL.** The populated rehearsal covers a Country with and without Regions,
  direct and regional Cities, a physical and a virtual Centre with contacts and served Cities,
  renamed slugs, exact coordinates and a centre-scoped NewsArticle.
- **Content gate open.** OPEN_DECISIONS.md §6.2 is unchanged: no real Country, Centre or contact
  is seeded, and engineering completion is not authoritative directory acceptance.
- **Not delivered, and not owed by this phase:** Centre Events and Local Events (Phase 14); a
  Global search projection; bulk or legacy import (Phase 30, under written authorisation); maps,
  geocoding or geolocation; opening hours, bookings, staff directories or per-centre forms.

---

### Phase 17 — Search Foundation
**Entry:** Phases 6 and 8 complete.

**Deliverables:** **`SearchService` abstraction** · **SQL Server FTS proof** · **durable
derived-work indexing driven by publication** (ARCHITECTURE.md §8.5) · filters by type, topic,
language, date · search UI · rate limiting · `noindex` on search routes · **rebuild and
reconciliation tooling** · **an operator-visible view of indexing lag and failures**.

**The initial searchable inventory is stated, not inferred.** These domains already exist by
this phase's prerequisites, and each gets its projection here:

| Domain | Delivered by | What search exposes |
|---|---|---|
| **Taxonomy — Topics** | Phase 3B | Topic names and descriptions per locale, as navigable results into `/topics/{slug}` |
| **People & Contributors** | Phase 5 | Person and profile records, as results into `/people/{slug}` |
| **Editorial** | Phase 6 | Article and published Page records |
| **Library** | Phase 8 | Work, Edition and BookTranslation records |

Every later searchable domain adds **its own** projection, filters, publication and removal
behaviour, rebuild behaviour, visibility rules and tests, and therefore carries **Phase 17 in
its dependency path** (§3). **Phase 31 proves none is missing.**

> **Indexing is derived work, not part of the authoritative transaction.** The owning domain's
> publication state commits in its own database transaction; the search projection is updated
> through **durable, observable, retryable derived-work intent**. **SQL Server FTS is never
> described as atomically committed with authoritative publication state** — FTS population is
> asynchronous by nature, and claiming otherwise would be false and would hide exactly the
> staleness window that the security rule below exists to handle.

**Tests:** Results across **every domain in the initial inventory above** · **Arabic and Urdu
tokenisation validated with real content** · filters combine · **unpublished content never
appears** · injection attempts fail · expensive-query protection · **a withdrawn or unpublished
record is not disclosed from a stale index — current visibility is enforced before any
sensitive or withdrawn payload is returned** · **a failed indexing attempt is visible and
retried, not silently lost** · **a rebuild reproduces the index from authoritative state**.
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

**Phase-17 continuity — decisions made while delivering, recorded here rather than left in
review history:**

- **Engine.** SQL Server FTS runs on the repository's pinned image (`docker/sqlserver/`,
  TECH_STACK.md §10, §18.3); the official images lack FTS. Local and CI build it; the migration
  fails closed without FTS. The Arabic/Urdu tokenisation gate is **passed and recorded**
  (TECH_STACK.md §10), including one known limitation (Arabic-yeh vs Urdu-yeh).
- **Mechanism.** Durable intent, generation-checked settlement, leases, bounded retry,
  rebuild, reconciliation and the per-page, per-kind visibility recheck are described in
  ARCHITECTURE.md §4.3. The derived projection's `kind + id` pairs are the narrow exception
  recorded in DOMAIN_MODEL.md §6.2.1.
- **Topic hub delivered here.** `/topics` and `/topics/{slug}` had no delivering phase, and a
  Topic result must be navigable (the inventory table above). The hub composes only owners
  that exist — the Topic, its subtopics, Library books on it, and search within it — and
  **each later domain adds its own section when it ships**; nothing renders for a domain that
  has not (ROUTE_MAP.md §5.1, §5.2). Topic slugs are immutable, so no slug history is owed.
- **Throttling.** `/search` is throttled by the request proxy, which sends a throttled client
  to the static `/search/limited` state, because the results page is a public content route
  and may reach no header or secret (SECURITY_BASELINE.md §15.2). GET and HEAD are metered
  alike, and a limiter that cannot answer refuses the query (fail closed, as every other
  limiter on the platform does).
- **What the initial projections deliberately do not contain**, each with its owner if it is
  ever wanted: **Edition reader text** (Library: in-book full-text search needs reader-position
  deep links, a Library extension, not a Phase-17 deliverable); **contributor names inside Work
  documents** (a person is found as a Person result; putting names into Works would make every
  People edit re-project Library); **Articles listed by topic on the hub** (Editorial exposes
  no by-topic listing; search within the topic covers them until Editorial adds one).
- **Not delivered, and not owed by this phase:** `/api/search/*` suggestions and typeahead
  (ROUTE_MAP.md §8 names the category; no delivered surface consumes it, so it arrives with
  the first one that does); search analytics or history (none is authorised — PRODUCT_SCOPE.md
  and Phase 21 own any personal history); multi-instance execution is safe by lease, but a
  shared rate-limit strategy remains the §3.5.1 prerequisite for scaling out.
- **Every later searchable domain** (Phases 9, 10, 11, 13, 18, 19, 20, 22, …) adds its own
  kind, projection, intent in its own transactions, visibility resolver, filters and tests,
  exactly as the four initial owners do — never a pre-created kind. **Phase 31** proves none is
  missing.

**After Search Foundation**, implementation continues in the order the dependency graph (§2)
and the current gates allow. Phase 2G remains separately deferred.

---

### Phase 18 — Quran

**Entry — implementation gate (§3.1):** Phases 3B, 5, 7 and **17** complete.

**Activation and content-acceptance gates — OPEN:** authoritative Quran text source and
encoding · approved translations, tafsir works and reciters · applicable rights and attribution
· authoritative corpus acceptance (OPEN_DECISIONS.md §1.1, §1.2, §2.4).

> **Engineering implementation may proceed before the corpus exists; publication of real
> scripture may not.** The software is built and proven against **controlled, unmistakably
> non-authoritative fixtures** sufficient to establish schema and invariants, Surah/Ayah/Juz
> relationships, translation, tafsir and recitation layering, reader UX, accessibility,
> canonical citation references, permissions, step-up security, audit behaviour, the search
> projection, and the **import-validation and mismatch-blocking mechanics**.
>
> **Fixtures are never represented as Quranic scripture.** No generated or placeholder text is
> presented as the Quran, in the product, in seeds, in tests or in a demonstration. The
> character-level verification mechanism is proven **as a mechanism**; it is exercised against
> the real corpus only once an authoritative source has been supplied.
>
> **Completing the engineering implementation satisfies this phase's downstream *software*
> dependencies** (Phase 21). It is **not** corpus acceptance, and it is **never** described as
> "Quran corpus approved". **Real Quran corpus publication and production activation remain
> blocked** until the gates above are satisfied, and launch acceptance for Quran requires their
> actual closure.

> **Phase 17 is a prerequisite** because this phase's deliverables and exit criteria include a
> **search projection** (§3). A projection cannot be delivered before the Search Foundation it
> projects into exists.

**Deliverables:** Surah, Ayah, Juz · Translation, Transliteration, Tafsir as **separate layered
works** · **Recitation and RecitationSegment — owned by Quran** · TajweedRule · reader with
preference selection · indexes and Quran search · **canonical citation URLs** · related
material via topics · **admin surfaces with `quran.editCanonical` and step-up
reauthentication** · full audit logging · search projection.

**Engineering tests:** **character-level verification and mismatch blocking are proven against
controlled, unmistakably non-authoritative fixtures** · multiple translations coexist with
**none privileged** · **Arabic renders correctly in all
three locales** · citation URLs stable, preferences as query parameters · **canonical edit
requires the permission AND step-up, and writes an audit record** · **no automated publication
path exists** · **no Media AudioTrack duplicates a Recitation** · **Quran reader accessibility
criteria met** (SECURITY_BASELINE.md §16.2).
**Exit — engineering implementation:** the Quran experience is complete, secure, accessible and
searchable in three locales, with the **verification mechanism proven** and no automated
publication path in existence.

**Activation / content-acceptance evidence:** the authoritative source is supplied and the real
Arabic corpus passes **character-by-character** verification; the approved layered works
and reciters are confirmed, and rights and attribution are settled. **Text integrity is never
assumed correct**, and engineering completion never substitutes for that acceptance.

---

**Phase-18 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
ENGINEERING IMPLEMENTATION   COMPLETE (this phase)
AUTHORITATIVE CORPUS         NOT SUPPLIED — OPEN_DECISIONS.md §1.1
APPROVED LAYERED WORKS       NOT SUPPLIED — §1.2
RIGHTS / ATTRIBUTION         OPEN — §2.4
PRODUCTION ACTIVATION        BLOCKED until those close
```

- **No Quran content exists in the repository or in any migrated database.** No Surah, Ayah,
  name, count, Juz boundary, translation, tafsir, transliteration or recitation is seeded, and no
  text was generated. Every proof uses controlled, unmistakably non-authoritative sentinel
  fixtures (`NON_QURAN_FIXTURE_…`), and every page that shows one says so.
- **Model** (DOMAIN_MODEL.md §8.3). The citation is the identity: `(surahNumber, ayahNumber)`;
  Surah and Juz are numbers; a Juz's range is derived. Registered sources (`fixture` or
  `approved`, immutable, owner/operator-only) carry their own exact text; the corpus is public
  only while the operator's single `QuranActivation` row exists, which refuses an incomplete
  corpus and an approved activation over fixture text. Layered works — Translation,
  Transliteration, Tafsir (same-Surah ranges, never overlapping), Recitation (a People reciter,
  Storage-backed segments) and TajweedRule — are separate aggregates, public only while the corpus
  is active, the work is published and it names a registered source.
- **One canonical write path.** The application principal holds no write on canonical, source or
  activation tables. Corpus acceptance copies the registered source's own rows after the database
  compares the candidate byte for byte; correction replaces one Ayah with a source's text under
  the expected version, only when the operator's reviewed text is that text exactly. Both are
  procedures that re-check, in SQL, a live `quran.editCanonical` assignment and an unexpired
  `quran-canonical-edit` step-up grant bound to a live session. Every version (1 included) is an
  immutable revision; every verification, passed or failed, is immutable content-free evidence;
  the generic audit never holds text. No bulk edit, no import UI and no automated publication path
  exist. The import interface Phase 30 will call is `acceptCorpus`; Phase 18 contacts no source.
- **Verification is exact**: code points in the verifier, UTF-16 bytes in the database; no
  trimming, normalisation form, folding, tashkeel removal or yeh substitution; fatal UTF-8
  transport decoding that keeps a byte-order mark as a difference; bounded, content-free reports.
- **Permissions.** `quran.read`, `quran.administer` (layered works, recitation audio, tajweed,
  Surah display names, Ayah topics — never canonical text) and `quran.editCanonical`, in the
  protected bundle with the same session and step-up revocation every bundle extension performs.
  **One new step-up purpose, `quran-canonical-edit`** (SECURITY_BASELINE.md §8.1 names canonical
  Quran edits as their own operation); no other purpose authorises it. No per-work, publish or
  import key; no `content.*`, `library.*`, `media.*` key or profile confers Quran authority.
- **Slugs are immutable.** Translation, Transliteration, Tafsir, Recitation and TajweedRule slugs
  are chosen once (the column refuses UPDATE; a CHECK fixes their grammar), so no slug history is
  owed (DOMAIN_MODEL.md §19.7). Surah, Ayah and Juz addresses are numbers.
- **Public.** `/quran`, `/quran/read` (an anonymous entry form — no session and no progress;
  Phase 21 owns reading progress), Surah index and view, the canonical Ayah citation, Juz index and
  paged view, `/quran/search` (`noindex`, throttled like `/search`), translations, tafsir,
  transliteration, tajweed, recitations and a reciter's recitations (the Person slug), the
  `/quran/topics/{slug}` filtered view (canonical → `/topics/{slug}`), and `/listen/recitations`
  — a Layer-4 projection of Quran's public reader, canonical → `/quran/recitations`, absent while
  no corpus is active. Reading preferences (`translation`, `transliteration`, `tafsir`,
  `reciter`, `size`) are validated query parameters: an unknown value is reported, never
  broadened, and canonical URLs exclude them. Players are native, never autoplay, offer no download
  and appear only for segments Storage can serve. **States:** inactive → an honest unavailable
  state on section pages and 404 for named resources; fixture mode → a banner on every page,
  `noindex`, no sitemap; approved mode → canonical, indexable routes and the `quran` sitemap segment
  of Ayah citations. Structured data is `BreadcrumbList` only.
- **Related material.** `/quran/books`, `/quran/videos` and `/quran/research` are activated:
  each is the owner's own public by-topic read for the migration-seeded `quran` topic, canonical to
  the owner's collection. `/quran/articles` stays absent (Editorial exposes no by-topic Article
  read), and `/quran/courses` and `/quran/teachers` stay absent and unlinked (Learning has not
  shipped; no deterministic teacher relation exists). The topic hub gains a bounded Quran section.
- **Admin.** `/admin/quran/{surahs,ayat,translations,transliterations,tafsir,recitations,tajweed}`
  — `tajweed` is added to ROUTE_MAP.md §7. Canonical text is read-only; the purpose-built correction
  flow (plain right-to-left text field, never Tiptap) appears only to `quran.editCanonical` holders
  after a `quran-canonical-edit` step-up. Recitation audio uploads through
  `POST /api/admin/quran/recitations/{id}/segments/{segmentId}/asset`, the streamed Class-A pattern
  of Phase 11.
- **Search.** Kind and scope `quran-ayah`, one scope per Ayah (identity `"{surah}:{ayah}"`): the
  canonical Arabic and one document per language of public translation and transliteration text,
  so one Ayah is one result and a translation is never labelled as the Arabic. Tafsir bodies are
  not indexed. Nothing is indexed while the corpus is inactive; activation is an operator act, so
  its projection arrives through reconciliation. The Arabic-yeh vs Urdu-yeh limitation recorded in
  TECH_STACK.md §10 applies unchanged.
- **Recovery is SQL plus bytes.** The populated rehearsal covers fixture sources, a canonical corpus
  with history and evidence, a correction, every layered work, a recitation segment's Asset
  relation, topics, display names and search intent.
- **Content gate open.** OPEN_DECISIONS.md §1.1, §1.2 and §2.4 are unchanged. Engineering
  completion is never "Quran corpus approved", and Phase 21's software dependency on Phase 18 is
  satisfied by this engineering exit alone (§3.1).
- **Not delivered, and not owed by this phase:** a real corpus or layered work (external gates);
  source adapters and live import (Phase 30); downloads (§2.4); reading progress, bookmarks and
  notes (Phase 21); Surah-level topic assignment; tafsir search; time-offset recitation segments.

---

### Phase 19 — Hadith

**Entry — implementation gate (§3.1):** Phases 3B, 5 and **17** complete.

**Activation and content-acceptance gates — OPEN:** authoritative collections and editions ·
reference-numbering policy · **grading authority** · chain and source policy · content rights
and attribution · required scholarly acceptance (OPEN_DECISIONS.md §1.3, §1.6, §2.4).

> **Engineering implementation may proceed against controlled, unmistakably non-authoritative
> fixtures**, sufficient to prove the Collection -> Book -> Chapter -> Hadith hierarchy, source,
> edition and reference identity, translation and commentary structure, **sourced** grading and
> chain fields, permissions, step-up security, audit, search, and the source-conflict
> escalation mechanics.
>
> **Fixtures are never represented as genuine Hadith, and no scholarly grading is invented and
> presented as real.** The platform stores what an authority provides; a fixture proves the
> field exists and is audited, never that a grading is true.
>
> **Completing the engineering implementation satisfies this phase's downstream *software*
> dependencies** (Phase 21). It is **not** described as "Hadith corpus approved". Production
> corpus activation and publication remain blocked until the gates above close.

> **Reference identity must not silently collide.** The same apparent reference number can
> denote different narrations across collections, across editions of one collection, and across
> source systems. Identity is therefore modelled so that a Hadith reference is qualified by its
> **collection, edition and source system** — a bare number is never a platform-wide key
> (DOMAIN_MODEL.md §9).

> **Phase 17 is a prerequisite** for the same reason as Phase 18: this phase promises a
> **search projection** in its deliverables and exit criteria.

**Deliverables:** Collection → Book → Chapter → Hadith · translations and commentary as
separate records · **gradings and chains as sourced data** · sciences content · browse, search,
topic views · **canonical citation URLs** · admin with `hadith.editCanonical` and step-up ·
audit logging · search projection.

**Tests:** Hierarchy navigation · **gradings and chains stored exactly as sourced, never
inferred or generated** · source reference numbers preserved · translations separate ·
**elevated permission plus step-up required** · **Hadith is not merged with Quran anywhere**.
**Exit — engineering implementation:** Hadith is browsable, searchable, permission-protected
and audited, with sourced-data fields proven and conflicts escalated rather than resolved.

**Exit — production activation:** reached only when authoritative collections and editions, the
reference-numbering policy, the grading authority and the applicable rights are confirmed, and
the real corpus has been reviewed. **Engineering completion is not scholarly acceptance.**

---

### Phase 20 — Fatwa

**Entry — implementation gate (§3.1):** Phases 2, 5 and **17** complete.

**Activation and content-acceptance gates — OPEN:** named authorised scholars · the approved
role and grant process · organisational Fatwa workflow authority · real publication approval
(OPEN_DECISIONS.md §1.4, §6.3).

> **Engineering implementation may proceed against clearly synthetic questions, rulings and
> test identities**, sufficient to prove the private Question workflow, triage, assignment,
> review, `fatwa.publish` enforcement, step-up, anonymisation, correction and revision
> behaviour, audit, exclusion of private and unpublished material from search, the absence of
> any bypass path, and the absence of any AI ruling-generation path.
>
> **Synthetic material is never represented as a genuine Fatwa** anywhere — product, seed,
> fixture or demonstration.
>
> **Real `fatwa.publish` grants and real Fatwa publication remain blocked** until the gates
> above close. Completing the engineering implementation satisfies downstream *software*
> dependencies; it is **never** described as "Fatwa authority approved".

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
**Exit — engineering implementation:** **Fatwa publication is provably restricted to holders of
`fatwa.publish` with step-up**, every bypass path is proven closed, and private questions are
proven private.

**Exit — production activation:** the highest-consequence acceptance in this plan. Real grants
are issued only to **named individuals approved by Minhaj**, and real publication begins only
then. **Signed off by Minhaj** — an engineering exit never substitutes for that signature.

---

### Phase 21 — Personalisation & Notifications
**Entry:** Phases 2, **10**, 18, 19 complete.

> **Why Phase 10 is a prerequisite.** This phase delivers **WatchHistory** and video-backed
> personalisation, which hold **typed references** to Video (DOMAIN_MODEL.md §14.1–§14.2). A
> typed reference cannot precede its target, and **no forward or placeholder foreign key is
> created to avoid the dependency**.
>
> **Phase 11 and Phase 20 are deliberately not prerequisites.** V1 promises Watch history, not
> an audio listening-history contract; and **My Questions is owned by Fatwa**, composed here
> only once Fatwa has delivered it (DOMAIN_MODEL.md §14.4).

**Deliverables:** The **Personalisation & Notifications context** (DOMAIN_MODEL.md §14) —
Bookmark, Note, SavedItem, PrivateCollection, ReadingHistory, WatchHistory, ReadingProgress,
NotificationPreference, Notification · **NewsletterSubscriber with the double opt-in lifecycle**
(DOMAIN_MODEL.md §14.5) · **typed references to content** · the My Minhaj routes this context
owns (ROUTE_MAP.md §5.1) · **personalisation onboarding** — interests and goals — which is
**distinct from Phase 2 account setup** · notification and privacy settings · data export ·
**this context's part of account closure**, coordinated by Layer 4 rather than owned here
(SECURITY_BASELINE.md §19.1).

**Tests:** **All queries scoped to the requesting user** · **horizontal privilege escalation
fails** · **closing an account disposes of this context's records according to policy** ·
**archiving referenced content leaves the typed reference valid and renders as
unavailable/archived** · **during a hard purge this context removes, anonymises or tombstones
its own records through its own public service, idempotently and resumably — no broken foreign
key is left, and no persistence capability crosses a context boundary**
(DOMAIN_MODEL.md §14.3) · **an interrupted purge is safely resumed and the target stays
non-public until it completes** · **public pages still render fully signed out** ·
**cache-leakage: no personalisation in the public tree** · export works · **newsletter
submission alone does not create a subscription; confirmation does** · **a replayed or expired
confirmation link does not activate a subscription** · **account creation does not subscribe
the account** · **unsubscribe works without signing in** · **a marketing unsubscribe does not
suppress security or account-service mail**.
**Exit:** Personalisation working with **defined ownership, privacy and disposition rules** and
no reduction in public access.

---

### Phase 22 — Learning: courses & paths
**Entry:** Phases 5, 6 and **17** complete — **Phase 17 because this phase promises a search
projection** (§3).
**Deliverables:** Course, CourseModule, Lesson, LearningPath, Enrolment, Progress · public
catalogue · **My Learning and course progress** (ROUTE_MAP.md §5.1) · admin management ·
**TrialClassRequest creation and booking-request semantics** · search projection · native slug
history for the catalogue's editable canonical slugs.

> **This phase creates the request; Phase 23 confirms it.** Requesting a trial class is a
> Learning-owned act that needs no teacher assignment to exist. **Conflict-safe confirmation,
> scheduling and the ClassSession itself belong to Phase 23**, where availability and current
> teaching assignments exist.

> **No Media or Global Network prerequisite is added here.** The context allowlist permits
> Learning to depend on both (DOMAIN_MODEL.md §3.1), but permission to depend is not evidence
> of a current need, and this phase's schema requires neither a Video nor a Centre relation. If
> a future concrete Learning schema requires one, **that phase adds the prerequisite before
> implementing the relation** — never a forward or placeholder foreign key.

**Tests:** Catalogue browsable **without an account** · enrolment requires authentication ·
progress scoped per user · **Enrolment and Booking remain distinct** · **unpublished courses
never appear in the catalogue or in search** · **no Video or Centre foreign key exists in this
phase's schema**.
**Exit:** Courses browsable publicly; enrolment, progress and trial requests working.

---

### Phase 23 — Teacher Experience & Live Classes

**Entry — implementation gate (§3.1):** Phase 22 complete.

**Activation gates — OPEN:** the **under-18 safeguarding decision** (OPEN_DECISIONS.md §2.1)
and confirmation that **the organisation and its teachers can legitimately create and use
Google Meet meetings** (§5.3).

> **Safeguarding is an external authority, legal and product-policy decision, and it is not
> pre-empted here.** But the absence of a final policy does not prevent building the
> **policy-independent, default-deny mechanics** that any policy will require. Engineering may
> implement and test: current teaching-assignment checks · enrolment and relationship checks ·
> default-deny access · participant authorisation · private meeting-URL handling · attendance
> mechanics · teacher revocation behaviour · class and session data protection · and the
> absence of accidental public disclosure.
>
> **Until a safeguarding policy explicitly permits otherwise**, and as a **fail-closed
> pre-policy state** rather than a permanent product decision:
>
> - **under-18-specific production capability remains disabled**;
> - **student-to-student messaging remains disabled** (Phase 24);
> - **no guardian-consent rule, age threshold, vetting policy, one-to-one minor communication
>   rule or special minor-retention rule is invented** by engineering.
>
> **This does not declare the platform adults-only.** When the policy arrives, any behaviour it
> genuinely requires becomes an **implementation gate** for that behaviour, and must be
> implemented and tested **before** the corresponding production capability is activated.
>
> **The safeguarding production gate is not closed by this phase's engineering exit.**

> **Google OAuth / Calendar / Meet API credentials are NOT a prerequisite for this phase.**
> Within the current V1 delivery plan, Google OAuth application credentials are required for
> Google sign-in (Phase 2G) and are not required for the manual Google Meet URL flow.
> V1 stores a manually entered Meet URL: a teacher or administrator creates the meeting in
> Google themselves and pastes the link. The application validates and stores a string — it
> never calls a Google API. Automatic Calendar/Meet provisioning remains deferred; **any
> future explicitly approved Google API integration will have its own credential
> requirements.**

**Deliverables:** Teacher area routes gated by a **current `teaching.perform` assignment** ·
students, courses, calendar, resources · Availability · **conflict-safe booking confirmation**
of the trial requests created in Phase 22 · **ClassSession**, attendance, **cancellation,
reschedule and completion** · no-show handling where the accepted workflow genuinely uses it ·
**teacher replacement and revocation** · **My Classes and My Teachers**, with class detail and
history (ROUTE_MAP.md §5.1) · **class reminders** through the shared communication contract
(ARCHITECTURE.md §4.6.1) · **ClassSession storing `meetingProvider` and `meetingUrl`, entered
manually** · **provider/URL consistency validation and HTTPS `meet.google.com` allowlist** ·
`MeetingProvider` abstraction.

> **Manual Google Meet remains the V1 mechanism, and no Google Calendar or Meet API integration
> is introduced.** The application validates and stores a string; it never calls a Google API.
> Reminder scheduling and rescheduling **update the reminders that were already scheduled** —
> a rescheduled class does not fire the old reminder (DOMAIN_MODEL.md §19.5).

**Tests:** **A teacher can access only their currently assigned students** · **a revoked
assignment immediately removes access** · attendance permission-enforced · **meeting URLs are
exposed only to authorised participants** · **meeting URLs never appear in public caches or
logs** · a non-Meet or non-HTTPS URL is rejected for the Google Meet provider · **a
TeacherProfile without a RoleAssignment grants nothing**.
Additionally: **two confirmations of the same slot cannot both succeed** · **a cancelled or
rescheduled class updates its reminders** · **a replaced teacher loses access and the
replacement gains it** · **student-to-student messaging and under-18-specific capability remain
disabled in the pre-policy state**.

**Exit — engineering implementation:** Teachers run classes with manually entered, validated
Meet links, under current-assignment authorisation and default-deny access. **No recording. No
automated provisioning.**

**Exit — production activation:** reached only when the safeguarding policy exists, any
behaviour it genuinely requires has been implemented and tested, and the organisation's Meet
capability is confirmed.

---

### Phase 24 — Messaging: domain & shared server services

**Entry — implementation gate (§3.1):** Phases 2, **7**, 22 and 23 complete.

**Activation gate — OPEN:** the **under-18 safeguarding decision** (OPEN_DECISIONS.md §2.1),
and the **student-to-student messaging policy** (§2.5). The default-deny mechanics below may be
built and proven; the policy-dependent capability stays **disabled** until the policy exists,
exactly as in Phase 23.

> **Phase 7 is an explicit prerequisite** because message attachments are storage-backed. This
> phase supplies and tests the **Identity-derived authorisation policy** for attachment serving
> against the default-deny route delivered in Phase 7 (§3). **Storage ownership does not move
> into Messaging** — Messaging consumes the StorageService abstraction.

**Deliverables:** Messaging context — Conversation, Participant, Message, ReadState,
Attachment, **Block, Report**, moderation · **Messaging-owned application services hosted in
`packages/server-core`** so one implementation serves both processes — **Messaging remains the
semantic owner** (ARCHITECTURE.md §3.1) · **current-relationship authorisation** · attachment handling via
Phase 7 · **non-realtime messaging fully working through the web application** · attachment
retention policy · moderation evidence access controls · **conversation list and detail,
pagination, durable ordering, unread and read state, and reconnect catch-up** · **idempotent
send and retry keyed by a client-supplied operation identifier**, so a retried send creates one
message · **the account-closure policy for shared conversations** (SECURITY_BASELINE.md §19.1)
· **authenticated support conversations** — the `Messages -> Support` surface of
INFORMATION_ARCHITECTURE.md §5, delivered as a **support conversation type owned by Messaging**
(DOMAIN_MODEL.md §15.5).

> **Support reuses Messaging; it does not become a second system.** Conversation, Participant,
> Message, ReadState, attachment security and the blocking and reporting rules are the same
> ones. **No support-ticket or CRM bounded context is created.** Operator participation is
> permission-controlled, sensitive support access is audited, and **one user can never read
> another user's support conversation**. This is distinct from the unauthenticated `/contact`
> and `/feedback` correspondence workflows, which are Editorial-owned (DOMAIN_MODEL.md §7.5).

**Tests:** **Authorisation validates the current relationship, not historical membership** —
negative tests for **unrelated teacher, former teacher, revoked assignment, blocked user,
unauthorised student, removed class/course membership** · **messages persist before any
broadcast** · blocking prevents initiation and continuation · moderation evidence access
restricted and audited · **student↔student disabled by default**.
Additionally: **the current-relationship check protects history and attachment access, not
only sending** · **a retried send with the same operation identifier produces exactly one
message** · **a user cannot read another user's support conversation** · **closing an account
follows the documented shared-conversation policy rather than silently destroying another
participant's history**.

**Exit — engineering implementation:** Messaging works **without any realtime process**, with
relationship authorisation proven and student-to-student messaging **disabled by default**.

**Exit — production activation:** reached when the safeguarding and student-to-student policies
exist and any behaviour they require has been implemented and tested.

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
**Deliverables:** MembershipType, Membership, MembershipApplication · **the full applicant
lifecycle** — application, review and decision, status, and withdrawal or closure where
appropriate · public membership information routes · **applicant-facing status at
`/my/membership`** (ROUTE_MAP.md §5.1) · operator management with permission checks ·
**application and status service communication** through the shared contract
(ARCHITECTURE.md §4.6.1).
**Tests:** Application lifecycle transitions enforced server-side · permission enforcement ·
**an applicant sees only their own application** · **the phase completes with no payment
provider selected and no payment code path** · service communication is delivered durably.
**Exit:** Membership functional and **independent of Donations**. **Payment remains
irrelevant to this phase** — an unresolved provider never blocks membership.

---

### Phase 27 — Donations
**Entry — implementation gate (§3.1):** Phase 2 complete. **May be deferred indefinitely
without blocking anything.** A sandbox adapter may be selected and proven during this phase;
the production merchant/provider account is a separate activation gate (OPEN_DECISIONS.md §5.4).
**Deliverables:** DonationCampaign and Donation behind the `PaymentProvider` abstraction ·
public donate routes · **anonymous donation and optional user-linked donation** · a
**server-created, immutable expected amount and currency** for each attempt · the **full
provider-neutral state lifecycle** — pending, succeeded, failed, cancelled, expired where the
provider requires it, refunded, partially refunded where supported, and disputed or charged
back where the provider requires it · **duplicate-submission prevention** · provider
transaction and event identifiers, **scoped to the provider account and environment** ·
**webhook handling with signature verification, idempotency, replay resistance, durable event
deduplication and out-of-order event handling** · **reconciliation for ambiguous, delayed or
missing events** · confirmation and refund service communication · donor privacy · optional
signed-in donation history at `/my/donations` where that is genuinely in scope · admin
filtering, reconciliation and export · redacted logs.

> **A browser redirect never proves payment success.** Success is established from the
> provider's verified server-side state, not from the URL the donor lands on.

> **No provider is selected by this baseline**, and none is selected by this correction. Money
> follows DOMAIN_MODEL.md §19.6: ISO currency codes, an exact non-floating representation, no
> assumption that every currency has two decimal places, and refunds that cannot exceed the
> captured amount.

> **Nothing here introduces ecommerce.** There is no cart, no order, no shipping, no inventory,
> no subscription engine, and no Gift Aid or tax-receipt jurisdiction logic.
**Tests:** **Signature verification rejects forged webhooks** · **duplicate delivery produces
one effect** · **replayed events rejected** · **amount, currency and status verified
server-side** · **no card or payment credential data stored** · no payment data in logs.
Additionally: **a duplicate submission produces one donation** · **out-of-order provider events
converge on the correct final state** · **an ambiguous or missing event is reconciled rather
than assumed successful** · **a refund cannot exceed the captured amount**.

**Exit — engineering implementation:** Donations functional with verified webhooks, a complete
provider-neutral lifecycle, and no sensitive data stored. **Sandbox provider integration is
sufficient to prove the software.**

**Exit — production activation:** requires the organisation's own merchant and provider account
readiness, which is **separately gated** (OPEN_DECISIONS.md §5.4).

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
area · `scripts/migration/` adapter tooling structure · **bounded batches, checkpoints and
resumability for large sources** · **parser and adapter version provenance on every staged
record** · **classification of source disappearance** (MIGRATION_STRATEGY.md §5.3) · **the
reviewed promotion manifest** used to move an accepted corpus from staging to production
(MIGRATION_STRATEGY.md §10.1.1).

**Tests:** **Interrupted runs resume correctly** · **re-running produces no duplicates** ·
**raw snapshots are immutable and render inertly** · **staged content is not publicly
reachable or indexable** · **imported XSS payloads sanitised before storage** · **SSRF and DNS
rebinding attempts blocked, including post-redirect revalidation** · **ordinary 4xx are not
retried; `Retry-After` respected** · **reconciliation arithmetic balances** · **a publish
manifest can be rolled back** · **link rewriting works and unresolved links are reported** ·
**publication goes through target domain interfaces, not table writes** · **a source that stops
returning a record is classified, not treated as deletion evidence** · **an executable legacy
export is restored and inspected only in an isolated source environment, and never becomes the
target schema** · **an interrupted promotion resumes without duplicating** · **identical bytes
do not merge two assets whose rights, provenance, owner or visibility differ**.
**Exit:** Framework proven **against controlled fixtures — never against a live Minhaj site**.
**No real legacy source has been contacted and no real asset copied.**

---

### Phase 30 — Source Adapters & Initial Migration
**Entry:** Phase 29 complete. All target domains have reached their **engineering
implementation exit** (§3.1). Staging available.

> **Engineering completeness of a target domain is what this phase needs in order to *run*.**
> It is not permission to publish that domain's authoritative content: religious publication
> still requires its own domain approval, and **migration publication authority never
> substitutes for scholarly review** (MIGRATION_STRATEGY.md §8.4).

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
audit · RTL QA across **every** page in Urdu and Arabic · Arabic and Urdu typography review ·
**the assembled UX acceptance pass** across the design system, responsive behaviour, navigation
and motion contracts (ARCHITECTURE.md §13) · **a recorded content-conformance register**
listing every place where an authoritative source supplies no caption, transcript or accessible
alternative.

> **Software conformance and content conformance are accepted separately** (C22,
> SECURITY_BASELINE.md §16.3). This phase may accept **WCAG 2.2 AA for the software** while
> recording that specific content lacks source-supplied alternatives. **No unqualified
> whole-product conformance claim is made while those gaps remain**, and **no alternative is
> ever fabricated to close one.**
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
**step-up coverage verified across all privileged operations** · **independent re-assurance of
the privileged second-factor requirement and of the initial-operator bootstrap** — that the
bootstrap is genuinely unavailable after first use, that no administrator path silently
disables a second factor, and that no permanent break-glass account or hidden master factor
exists (SECURITY_BASELINE.md §8) · audit coverage verified, **including that audit payloads
are minimised rather than carrying full sensitive record snapshots** (SECURITY_BASELINE.md
§13.4) · logging redaction verified · secrets audit · dependency vulnerability scan ·
**verification that the pre-adoption indexing posture is still in force if the platform has not
yet launched officially** · **penetration testing of SECURITY_BASELINE.md §20**.

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
· SQL Server production setup · **backup automation with tested restores** · **backup of the
authoritative storage volume alongside the database** · monitoring, alerting and log
aggregation · deployment runbook · **the complete recovery procedure of ARCHITECTURE.md §10.4**
· **rollback procedure** · incident response · **the Level A system-handover material of
ARCHITECTURE.md §10.5**.

> **A successful SQL restore with missing authoritative assets is not a successful platform
> recovery.** Recovery is verified across **both** authoritative stores, with derived state
> rebuilt rather than restored, and with **external provider effects reconciled before anything
> is replayed** (ARCHITECTURE.md §10.4).

**Tests:** Deployment to production-shaped staging · **restore verified across database and
authoritative assets together** · **restored access controls and least-privilege mappings
verified** · **already-completed external effects are not blindly replayed after a restore** ·
**derived search, cache and sitemap state rebuilds from authoritative state** · **rollback
verified** · alerts fire correctly · **a web deployment does not destructively drop realtime
connections** · performance targets met on low-bandwidth mobile.
**Exit:** Deployable, monitored, backed up, with a **proven** rollback and a **proven complete
recovery** — not a database-only one.

---

### Phase 35 — Launch: Delta Migration & Cutover
**Entry:** Phases 30, 31, 32, 33, 34 complete. **Organisational go-live approval. DNS and
legacy hosting access arranged.** **Cutover rollback runbook written and rehearsed.**

**Deliverables:** Delta migration **with unchanged review requirements** · **promotion of the
accepted corpus from staging to production through the reviewed promotion manifest**
(MIGRATION_STRATEGY.md §10.1.1) · final URL mapping verification · **301 redirects live** ·
legacy domain cutover per organisational decision · unmapped-URL logging · **the transition to
official-origin indexing** — `noindex` lifted, canonical URLs moved to the official origin and
sitemaps submitted **only at this point** (PRODUCT_SCOPE.md, *Product status and acceptance*) ·
post-launch monitoring.

> **The indexing transition is one server-only setting, and this is its name.** Phase 4 delivered
> the control as **`PUBLIC_INDEXING_ENABLED`**, which defaults to `false` and fails closed: while
> it is off, every page emits `noindex`, `robots.txt` disallows the whole site, no canonical or
> `hreflang` is emitted and the sitemap routes answer 404. Turning it on at the official origin —
> together with `AUTH_BASE_URL`, the single application origin canonical URLs are built from — is
> what performs this transition. **It is an environment and launch-state control, not a product
> mode**, and the application is not reduced in any way while it is off. The public shell is
> statically rendered, so the value is read at build time: the transition is a deliberate
> rebuild and redeploy, not a runtime toggle.

> **Staging acceptance is not production promotion.** Promotion carries provenance, review
> integrity and checksums forward, and **excludes staging test accounts, known-password users,
> development credentials and unrelated staging configuration**. A defined source cutoff,
> protection of new production writes, and a named rollback owner are settled before cutover.

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
8. **The phase's gate status is stated honestly** (§3.1) — an engineering implementation exit
   is reported as exactly that, and never as content acceptance, activation or launch approval

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
| **Religious review capacity is the bottleneck** | Sequenced so review begins early on lower-risk content; reviewer tooling in Phase 29; **no fixed deadline, precisely because this cannot be rushed**. **Engineering is not blocked by it**: Phases 18–20 reach an engineering implementation exit against non-authoritative fixtures, while corpus acceptance and production activation stay open (§3.1) |
| **An unavailable authoritative corpus stalls the whole roadmap** | The four gate types (§3.1) separate *building* from *activating* and *publishing*, so downstream software proceeds while religious acceptance remains genuinely open — **without ever describing engineering completion as religious approval** |
| Migration reveals unanticipated structures | Raw preservation permits reparsing without refetching; adapters isolated per source |
| **Arabic/Urdu search quality inadequate** | Assessed in Phase 17 and re-validated in Phase 31; the abstraction keeps replacement cheap |
| Scope pressure to recombine phases | Boundaries follow dependency and risk; **vertical slices exist so verification stays possible** |
| **Safeguarding decision arrives late** | Gates the **activation** of Phases 23–25; **all other work proceeds**, and those phases may still build **policy-independent, default-deny mechanics**. Under-18 capability and student-to-student messaging stay **disabled in the fail-closed pre-policy state**, and any behaviour the eventual policy requires is implemented and tested **before** activation; raised early in OPEN_DECISIONS.md |
| **Payment provider unresolved** | Gates only Phase 27; **Membership is independent** |
| Single-instance realtime becomes a constraint | Known, bounded, documented; the RateLimiter and realtime abstractions permit a shared store later |
| External decisions block phases | Tracked in OPEN_DECISIONS.md with the phases each gates |
| **Unprovisioned production SQL stalls foundation work** | **Phase 1 runs on local Developer edition; only Phases 28 and 34 need external instances** |
| **Migration authorisation delays framework work** | **Phase 29 is fixture-only; authorisation gates Phase 30 alone** |
| **Google credential delays block live classes** | **The manual Meet flow needs no application API credential; within the current V1 plan only Google sign-in (Phase 2G) requires them. A future approved Google API integration would carry its own requirements** |
| ~~**The transactional email provider gate is the earliest broadly-blocking external decision**~~ **CLOSED ON EVIDENCE** | It gated Phase 2 and therefore everything downstream of Phase 2, including 3B, 4, 5, 6 and 29. The **development / pre-adoption** sending gate is now closed on demonstrated evidence — verified sender domain, DKIM, sending/SPF configuration, DMARC, a restricted sender credential and a successful controlled real-inbox delivery. **Official adopter-controlled production email remains a separate later activation** (OPEN_DECISIONS.md §5.1) |
| Opportunistic dependency upgrades destabilise work | Versioning policy: **stop, investigate, report** — never automatic substitution |
