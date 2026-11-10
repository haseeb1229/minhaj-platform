# Delivery Plan — One Minhaj Platform

**Status:** Living canonical baseline for the current accepted repository. Updated in the same
task as any accepted change that directly affects it (§5.1).
**Origin:** Phase 0A Architecture Freeze, revised after independent architecture audit, and
revised continuously through the delivered phases.
**Document type:** Delivery plan and phase record. Each phase's entry, deliverables, tests and
exit are its contract; "Delivered" and continuity notes record what each phase actually delivered,
and any status table inside them is a **snapshot at that phase's exit** unless it says otherwise.
Phases 0B–29 are delivered, except Phase 2G, which remains separately deferred. Phase 30 is in
progress in two corpus stages (§4, Phase 30): its migration engineering is delivered; Stage 1A —
the representative real review corpus for pre-adoption staging — has run on staging (165 records
discovered, 134 ordinary records published, 30 religious records staged for qualified review;
MIGRATION_STRATEGY.md §14) and was then materially widened by the Phase 30-R review-completeness
macro — first-party visuals, original source dates, organisational pages, leadership profiles and
countries of presence (§4, Phase 30; MIGRATION_STRATEGY.md §15) — and finished by the Phase 30-RF
gap closure (MIGRATION_STRATEGY.md §16; 501 ordinary records, Stage 1A complete), then extended by
the Phase 30-RD owner decisions — a person's audited clearance of personal-data false positives and
the source's curated archives as Collections (MIGRATION_STRATEGY.md §17; 617 ordinary records),
and corrected by the Phase 30-RV defect-only owner review (MIGRATION_STRATEGY.md §18);
Stage 1B, the full initial corpus, follows Minhaj's review and go-ahead. Phase 31 has not started.
Since then the owner-directed **Rebaseline Program R1 — Flagship Foundation** (an operational
macro, 2026-11-06, not a canonical phase; recorded after Phase 30 in §4) has reset the product's
foundation: the interim One Minhaj identity, unprefixed English URLs, content-aware navigation,
shipped typefaces and one product frame. It was followed by **Rebaseline Program R2 — Full
Ecosystem Completion** (also an operational macro, owner-directed 2026-11-06, recorded after R1 in
§4): every public, My Minhaj, Teacher and Admin surface redesigned on a shared primitive catalogue
and grouped navigation, a comprehensive pre-adoption presentation corpus, a labelled Quran
reference preview and operator-run demonstration data — all for pre-adoption staging only. Stage
1B and Phases 31–35 have not started, and readiness is reported in six separate dimensions, never
as a bare "complete".

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
8. **Commits only when explicitly requested after review** (§6).

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
| 23 | Teacher Experience & Live Classes | 22 · **activation:** safeguarding (OPEN_DECISIONS §2.1), Meet capability (§5.3) *(manual Meet flow — no Google API credential required)* |
| 24 | Messaging: domain & shared server services | 2, **7**, 22, 23 · **activation:** safeguarding (OPEN_DECISIONS §2.1), student↔student (§2.5), support/moderation ownership (§6.6) |
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
| **User-facing completeness** | A phase that promises a public, admin or user experience is **not complete with backend, API or schema alone**: it delivers a usable professional interface for that experience — responsive, keyboard- and focus-correct, localised with RTL, with its loading/pending, empty, success, error and unavailable states and validation feedback — and **no dead controls or demo-only UI**. An infrastructure-only phase owes no decorative UI. (Since Rebaseline R2, pre-adoption staging may hold operator-run synthetic **demonstration data** — environment data made through the ordinary services, never a UI, mode or flag in product code — so this rule is unchanged: OPEN_DECISIONS.md §4.2) |
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

> **Reading the delivered-state records.** Phases 0A–29 have been delivered and are on `main`;
> Phase 2G remains separately deferred. Each phase's entry, deliverables, tests and exit are the
> plan it was delivered against. Each **"Phase-N continuity"** record, and the status block at
> its head, is a **historical snapshot at that phase's exit**: where it describes a later phase
> as not started, or a route or capability as absent until a later owner ships, that later phase
> may since have delivered it — the later phase's own record is authoritative. Statements about
> the phase's own decisions remain current unless a later record changes them.

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
- `apps/web` — Next.js 16.3.3 at introduction (since moved within 16.x by recorded decisions;
  the current pin is in TECH_STACK.md), App Router, TypeScript strict
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
blocking physical-direction utilities in layout code. *(Historical at Phase-3A exit: the
always-present `/en` segment, the cookie/`Accept-Language` resolution and the 307 at `/` are
superseded by Rebaseline R1 (2026-11-06) — English unprefixed, `/en/…` one 301, no locale
cookie, ROUTE_MAP.md §1.1. The single localisation implementation is unchanged in kind.)*

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
*(Historical at Phase-4 exit: its visual values, the utility bar, the twelve-item navigation and
the mega-menu framework are superseded by Rebaseline R1 (2026-11-06) — the owner-approved interim
One Minhaj identity and the content-aware shell; the token structure, the component and state
contract and the behavioural rules stand. See the Rebaseline R1 record after Phase 30.)*

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

> **PHASE-2 MAINTENANCE GATE — HISTORICAL; RESOLVED BEFORE PHASE 6.** *As recorded at
> Phase-5 exit ("MUST BE RESOLVED BEFORE PHASE 6 STARTS"):* The Phase-5
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
>
> **Resolution.** Closed by `84148f9 fix(identity): harden phase 2 maintenance` on
> `fix/phase-2-maintenance-pre-phase-6`, which is an ancestor of `main` and landed before
> Phase 6 (`2a8fa81`). (1) In
> `apps/web/src/contexts/identity-access/application/identity-service.ts`, `changePassword`
> maps a failure through `mapPasswordChangeFailure`: only the structured `invalid-credentials`
> class is reported as such, and every other mechanism, infrastructure or reconciliation
> failure is `unavailable`. (2) In
> `packages/database/src/adapters/identity-access/final-administrator.ts`,
> `withProtectedInvariantMutation` takes the protected invariant lock before the mutation in
> the same transaction, and `classifyProtectedMutationError` separates the semantic refusal
> `51020` from the transient `51021` and `1205`, retried as a whole transaction at most three
> times and then surfaced as `ProtectedMutationUnavailableError`; `authorization.ts` reports
> `final-administrator` only for the semantic refusal, and the service maps exhaustion to
> `unavailable`. **Proofs:** `tests/identity/final-administrator.test.ts` (refusal
> classification and the exhausted-serialisation error, database-free);
> `tests/identity/crash-ordering.integration.test.ts` — *password-change failure
> classification* and *protected-mutation exhaustion classification*; and
> `tests/identity/invariant-concurrency.integration.test.ts` — *repeats the mutual revoke with
> no deadlock and no false refusal* and the *transient serialisation* bounded-retry cases. The
> two integration suites need live SQL: they skip in the database-less `Verify` job and are not
> among the suites the `Database foundation` job runs, so they are local live-SQL proofs.

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

*Historical note, superseded:* when this record was written, the Phase-6 local implementation
was unstaged, uncommitted and unpushed pending independent targeted actual-diff review, and the
separate whole-baseline architecture milestone was to follow Phase-6 remote-green; the builder
run did not consume it. Phase 6 has since been committed and is on `main`
(`2a8fa81 feat: establish phase 6 editorial core`).

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
  `/listen/recitations` has no route until Quran ships its catalogue (Phase 18 has since
  delivered it as a projection of Quran's reader).
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
  the photograph surfaces — superseded at Phase 13, when `/news` took over those links.
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
  Cards are text — type, date, headline, summary, byline, topics — with no image (at Phase-13
  exit; since Phase 30-R a NewsArticle or PressRelease card shows its optional first-party lead
  image, and the date shown and ordered by is the record's source chronology). A coverage
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
  *(At Phase-18 exit; Phase 22 has since delivered `/quran/courses` — `/quran/teachers` stays
  absent.)*
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
  *(At Phase-18 exit. Per-Ayah recitation timing has since been delivered by Quran Part 5 — the
  Rebaseline R2 record below; DOMAIN_MODEL.md §8.5.)*

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

**Phase-19 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
ENGINEERING IMPLEMENTATION        COMPLETE (this phase)
AUTHORITATIVE COLLECTIONS/EDITIONS NOT SUPPLIED — OPEN_DECISIONS.md §1.3
REFERENCE-NUMBERING POLICY        OPEN — §1.3
GRADING AUTHORITY                 OPEN — §1.3
CHAIN / SOURCE POLICY             OPEN — §1.3
RELIGIOUS QA CAPACITY             OPEN — §1.5
CONFLICT DECISION-MAKER           OPEN — §1.6
RIGHTS / ATTRIBUTION              OPEN — §2.4
PRODUCTION ACTIVATION             BLOCKED until those close
```

- **No Hadith content exists in the repository or in any migrated database.** No collection,
  edition, number, text, translation, chain, narrator, grading, grader or commentary is seeded, and
  none was generated. Every proof uses controlled, unmistakably non-authoritative sentinel fixtures
  (`NON_HADITH_FIXTURE_…`), and every page that shows one says so.
- **Model** (DOMAIN_MODEL.md §9.1). Record identity is `(collection, source system, edition, source
  reference)`, the reference exact and unique only within its edition. The public citation
  `(collection, number)` is a separate reviewed mapping to one candidate that declared that number —
  which is how `/hadith/{collectionSlug}/{hadithNumber}` (ROUTE_MAP.md §2.1) coexists with
  source-qualified identity without collapsing editions. Books and chapters are sourced per edition.
  Source systems, editions and activation are owner/operator-only and immutable.
- **One canonical write path.** The application principal holds no write on source, activation or
  canonical tables. Structure, record creation and correction, verification and citation mapping are
  procedures that re-check, in SQL, a live `hadith.editCanonical` assignment and an unexpired
  `hadith-canonical-edit` step-up grant bound to a live session. Every record version (1 included),
  every grading, verification, citation change and conflict is immutable; corrections run under the
  expected version and must change something; the generic audit never holds text.
- **Gradings and chains are sourced.** A grading is grader + label in the grader's own words +
  language + published reference, per record version; no grade vocabulary or equivalence exists. A
  chain is the source's text; **no Narrator aggregate, profile, route, People link or chain graph
  exists** (PRODUCT_SCOPE.md §4.4).
- **Human verification and conflict escalation.** A citation is public only while its collection
  is activated, the citation is mapped, the record is verified at its current version and no conflict
  evidence exists for the citation. Conflicts (text, chain, a shared grader's grading, and structure
  within one edition) are detected by the database byte for byte, recorded immutably and block
  mapping and publication. **No resolution path exists** — OPEN_DECISIONS.md §1.6 names no
  decision-maker, so Phase 19 builds evidence, visibility and blocking only. The consequence is
  deliberate and stated: until that external process exists, one recorded conflict blocks its
  citation permanently, even after both candidates are corrected to agree.
- **One authority per section.** A mapped record's source must share its collection's activation
  authority in both directions — fixture text never enters an approved collection, and approved
  text is never shown under the fixture notice — and the public reader applies the same rule to
  records and to layered translations, commentary and sciences.
- **Permissions.** `hadith.read`, `hadith.administer` (translations, commentary, sciences, display
  names, record topics — never a sourced fact) and `hadith.editCanonical`, in the protected bundle
  with the same session and step-up revocation every bundle extension performs. **One new step-up
  purpose, `hadith-canonical-edit`** — neither `quran-canonical-edit` nor
  `privilege-administration` authorises Hadith, nor the reverse. No publish, grade, chain or
  per-table key; no `quran.*`, `content.*`, `library.*` or `media.*` key or profile confers Hadith
  authority.
- **Exact text.** The exact-text schemas (refuse surrounding whitespace, control characters and
  unpaired surrogates; never trim, fold or normalise) moved to a shared Layer-0 contracts module used
  by Quran and Hadith alike, so neither depends on the other. The database compares UTF-16 bytes.
- **Slugs are immutable** (collection, book, chapter, commentary, science), so no slug history is
  owed (DOMAIN_MODEL.md §19.7). A collection slug may not be one of the section's own path words.
- **Public.** `/hadith`, `/hadith/introduction` (neutral product explanation only), structural
  browsing `/hadith/collections[/{slug}[/books[/{bookSlug}[/chapters/{chapterSlug}]]]]` (books and
  chapters holding public citations; each lists citations linking to the short form), the canonical
  citation `/hadith/{collectionSlug}/{hadithNumber}`, `/hadith/browse`, `/hadith/search` (`noindex`,
  throttled like `/search`), `/hadith/topics/{slug}` (canonical → `/topics/{slug}`),
  `/hadith/sciences[/{slug}]` and `/hadith/commentary`. No deep Hadith detail route exists, so the
  short citation is the only Hadith entity URL. **States:** inactive → an honest unavailable state on
  section pages and 404 for named resources; fixture mode → a non-authoritative notice on every page,
  `noindex`, no sitemap; approved mode → canonical, indexable routes and the `hadith` sitemap segment
  of citations. Structured data is `BreadcrumbList` only, and only in approved mode — no `Article`,
  author, date, rating or any claim about a grading or narrator.
- **Related material.** `/hadith/books`, `/hadith/videos` and `/hadith/research` are activated — each
  the owner's own public by-topic read for the migration-seeded `hadith` topic, canonical to the
  owner's collection. `/hadith/articles` (Editorial exposes no by-topic Article read),
  `/hadith/courses` (Phase 22) and `/hadith/scholars` (no deterministic People–Hadith relation) stay
  absent and unlinked. The topic hub gains a bounded Hadith section. *(At Phase-19 exit; Phase 22
  has since delivered `/hadith/courses` — `/hadith/scholars` stays absent.)*
- **Admin.** `/admin/hadith/{collections,books,chapters,records,commentary,sciences}` — `sciences`
  is added to ROUTE_MAP.md §7. Registered sources, editions and activation are shown read-only.
  Canonical operations (create structure and records, correct, verify, map or withdraw a citation)
  are purpose-built structured forms (plain text fields, never Tiptap) available only to
  `hadith.editCanonical` holders after a `hadith-canonical-edit` step-up. Conflict evidence and the
  competing candidates are shown; there is no resolve action.
- **Search.** Kind and scope `hadith`, one scope per public citation (identity: the citation id):
  the original and one document per public translation language. Results always link to the short
  citation; stale rows are withheld by the current-visibility resolver before return.
- **Recovery** covers sources, editions, structure, records with history and gradings, verification,
  citations, conflicts, every layered record, topics and search intent.
- **Content gates open.** OPEN_DECISIONS.md §1.3, §1.5, §1.6 and §2.4 are unchanged. Engineering
  completion is never "Hadith corpus approved", and Phase 21's software dependency on Phase 19 is
  satisfied by this engineering exit alone (§3.1).
- **Not delivered, and not owed by this phase:** a real corpus (external gates); a conflict
  resolution process (§1.6, Phase 30); source adapters and live import (Phase 30); Narrator
  management; reading progress, bookmarks and notes (Phase 21); Hadith audio, images or downloads.

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

**Phase-20 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
FATWA ENGINEERING IMPLEMENTATION      COMPLETE (this phase)
PRIVATE QUESTION WORKFLOW             COMPLETE AND PROVEN
PUBLIC SEARCH/BROWSE/CORRECTION       COMPLETE AND PROVEN
NO-AI RULING PATH                     PROVEN
REAL AUTHORISED SCHOLARS              NOT APPROVED / NOT GRANTED — OPEN_DECISIONS.md §1.4, §6.3
REAL TRIAGE / ASSIGNMENT / ESCALATION OPEN — §1.4
REAL FATWA PUBLICATION                BLOCKED until those close
```

- **The gated keys are bundled into no role.** `question.receive`, `fatwa.answer` and
  `fatwa.publish` are catalogued but excluded from the protected Platform Administrator bundle
  (SECURITY_BASELINE.md §3.5); the migration bundles, grants and invalidates nothing, and a migrated
  database has no holder of any of them. Real holders arrive only through audited role assignments to
  individuals Minhaj names. Widening a role one holds is now refused as self-elevation.
- **Activation is an operator fact.** No `FatwaActivation` row means no question is captured and
  nothing can be published, whoever holds which key; disposable proofs use a `fixture` activation,
  and an `approved` one must carry the organisation's evidence reference.
- **One publication operation** — a database procedure re-checking `fatwa.publish`, a live
  `fatwa-publication` step-up, activation, the exact revision under review and author/asker
  separation. The future Phase-30 importer must call it; nothing may set a ruling published directly.
- **Separation of duties is a fail-closed engineering default**, not a Minhaj policy: the author of a
  revision and the asker cannot publish it. The real process remains §1.4's.
- **The public question is written by a person** as a separate field; nothing anonymises text.
- **`sort=popular`** is anonymous reads over the trailing 30 UTC days (one per address per ruling per
  30 minutes, counted by a POST after render, through the existing limiter), ties by first
  publication then id — a query over a per-ruling, per-day count with no personal data
  (DOMAIN_MODEL.md §12.1). `latest` is first publication, newest first.
- **The slug freezes at first publication**; corrections stay on the same URL with visible history,
  withdrawal answers 404 and keeps history and the slug.
- **Topics:** a ruling is on a Topic through its current revision's topics or its category's topic.
- **Account closure** erases a closed account's private question text in Fatwa's own transaction;
  published rulings are unaffected.
- **Not delivered, and not owed by this phase:** attachments, asker–scholar messaging (Phase 24),
  notifications (Phase 21), consent-to-reveal-identity, import (Phase 30) and any real grant.
  Phase 21 composes the Fatwa-owned `/my/questions`; it owns no Fatwa schema.

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

**Phase-21 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
PERSONALISATION & NOTIFICATIONS ENGINEERING   COMPLETE (this phase)
SAVED / HISTORY / QURAN PROGRESS              COMPLETE
ONBOARDING (INTERESTS, GOALS)                 COMPLETE
IN-APP NOTIFICATIONS AND PREFERENCES          COMPLETE to the current producer contract
NEWSLETTER DOUBLE OPT-IN                      COMPLETE
EXPORT AND CLOSURE DISPOSITION                COMPLETE
COURSE PROGRESS                               DEFERRED at this exit — since delivered (Phase 22)
APPLICABLE-JURISDICTION POLICY                OPEN — OPEN_DECISIONS.md §2.2
```

- **No content-context dependency.** The context depends on Layer 0 and Identity & Access only;
  content is a typed foreign key resolved at Layer 4 through each owner's public reader
  (DOMAIN_MODEL.md §14.6). The saveable kinds are exactly Ayah, HadithCitation, Article, Video and
  Work. **SavedItem** is the typed anchor; **Bookmark**, **Note** and private-collection membership
  are distinct states over it, so the target is held once and never copied.
- **ReadingProgress is the Quran position only**, moved only by an explicit, versioned "set as my
  reading position". Course progress and `/my/progress/courses` are Phase 22's; no Course, Lesson or
  LearningPath reference exists here.
- **History is off by default** and one row per target; nothing is recorded until the person turns
  it on (SECURITY_BASELINE.md §19.1 — no automatic behavioural tracking).
- **Notifications are in-app only**, with one category (`questions`) produced by Layer 4 after a
  Fatwa decline or publication commits. No notification is emailed, so no preference can touch
  security or account-service mail.
- **The newsletter is independent of User** and double opt-in, with hash-only link tokens derived
  under `NEWSLETTER_TOKEN_KEY`, append-only consent evidence and marketing-scope provider suppression.
  `newsletter.read` and `newsletter.operate` are ordinary keys bundled into Platform Administrator by
  the established revocation convention; neither reaches anyone's saved items, notes or history, and
  no `personalisation.*` staff key exists.
- **Broadcast is not built.** No campaign aggregate, sending, segmentation or automation exists: the
  canonical documents define no campaign owner or contract, so `/admin/communications/newsletter`
  manages subscriber, consent and suppression state only. A future campaign capability is a separate,
  explicitly owned decision.
- **Closure** now coordinates four owners (Identity, People, Fatwa, Personalisation); the response
  reports pending honestly, and a bounded personal-data sweep finishes interrupted closures and
  retires lapsed newsletter confirmations.
- **Not delivered, and not owed by this phase:** course progress (Phase 22), audio listening history,
  emailed notifications, campaign sending, saved Fatwa rulings, and any staff browsing of personal data.

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

**Phase-22 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
LEARNING COURSES/PATHS ENGINEERING            COMPLETE (this phase)
PUBLIC COURSE/PATH CATALOGUE                  COMPLETE
MY LEARNING AND COURSE PROGRESS               COMPLETE
SELF-ENROLMENT                                COMPLETE
TRIAL REQUEST CREATION                        COMPLETE (request side only)
TRIAL CONFIRMATION / SCHEDULING               NOT STARTED at this exit — since delivered (Phase 23)
TEACHER EXPERIENCE, CLASSES, AVAILABILITY     NOT STARTED at this exit — since delivered (Phase 23)
SEARCH PROJECTION                             COMPLETE (`course`, `learning-path`)
SAFEGUARDING / MEET / TEACHER-GRANT GATES      OPEN — OPEN_DECISIONS.md §2.1, §5.3, §6.3
```

- **The schema is the catalogue and a person's own study** (DOMAIN_MODEL.md §13.4): Course with its
  modules and lessons, LearningPath, Enrolment, lesson Progress and the request side of
  TrialClassRequest. No ClassSession, Availability, Attendance or Booking table exists, no column can
  hold a meeting provider or address, and **no Video, Work, Asset or Centre foreign key exists** — the
  allowlist's Media, Library and Global Network edges are not taken.
- **Level and format** are Learning's own controlled facets — `beginner` / `intermediate` /
  `advanced` (or not stated) and `self-paced` / `live` — the smallest vocabulary the catalogue's
  `?level` and `?format` need; they claim no external classification. Only a published `live` Course
  takes a trial-class request.
- **A published Course's syllabus is frozen.** Publication requires a complete syllabus in the primary
  locale; modules and lessons change only in draft, so the public never reads a half-built outline. A
  Course cannot leave publication while a published path holds it. Normal removal is archiving; a
  Course is never deleted, and its learners keep their Enrolment and Progress.
- **Public catalogue, enrolled lessons.** `/learn/courses/{slug}` shows the description and the
  syllabus (module and lesson titles and summaries); lesson bodies are read in My Learning by a person
  enrolled on the published Course. The public tree reads no session: enrolment and trial state reach a
  Course page only through its private island after hydration (`/api/my/learning/*`).
- **Enrolment, trial request and Booking are distinct.** A request enrols nobody and is never shown as
  a scheduled class; confirmation, scheduling and the class itself are Phase 23's, as Booking and
  ClassSession. Withdrawing a request deletes it. No age, guardian, contact or free-text field exists.
- **Progress** is one row per completed lesson, recorded only by the learner's explicit act,
  idempotent and monotonic; **Course completion and path progress are derived** — there is no
  PathEnrolment, certificate, streak or grade.
- **Permissions:** `learning.read` and `learning.administer`, ordinary keys bundled into the protected
  Platform Administrator role by the established revocation convention. Neither is teaching authority,
  neither reveals who is enrolled (the administration shows counts), and no key edits a learner's
  Progress or confirms a request. `teaching.perform`, `learning.publish`, `learning.author` and
  `learning.review` do not exist.
- **Teachers are attribution.** A Course names published People as its teachers; `?teacher=` takes a
  People slug resolved at Layer 4. A TeacherProfile or attribution grants nothing.
- **Search, slugs, SEO.** Published Courses and paths are the `course` and `learning-path` kinds,
  withheld at query time once withdrawn. Course and path slugs have native history: a former slug
  answers one 301 and the Learn route words can never be a slug. Sitemap segments `courses` and
  `learning-paths`; structured data is `BreadcrumbList` only.
- **Quran and Hadith related Course views** `/quran/courses` and `/hadith/courses` are delivered as
  Layer-4 compositions of Learning's public by-topic read for the seeded `quran` / `hadith` Topics;
  Quran and Hadith import nothing of Learning. `/quran/teachers` and `/hadith/scholars` stay absent.
- **Learner level and preferred format are still not collected** — the catalogue filters are chosen
  per visit and need no stored preference, so Personalisation gains no field (DOMAIN_MODEL.md §14.6).
- **Export and closure:** `/api/my/export/learning` returns the person's Learning data as typed
  identifiers; closure now coordinates five owners (Identity, People, Fatwa, Personalisation,
  Learning), and the personal-data sweep finishes interrupted Learning disposition.
- **Not delivered, and not owed by this phase:** `/learn/live`, `/learn/teachers`, `/learn/training`
  and `/learn/resources` (no truthful delivered contract), the teacher area, My Classes and My
  Teachers, `/admin/learning/classes`, trial confirmation, under-18 rules, and any import of real
  courses (Phase 30). *(Phase 23 has since delivered `/learn/live`, `/learn/teachers`, the
  teacher area, My Classes and My Teachers, `/admin/learning/classes` and trial confirmation;
  `/learn/training` and `/learn/resources` remain absent.)*

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

**Phase-23 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
TEACHER EXPERIENCE ENGINEERING                COMPLETE (this phase, policy-independent)
AVAILABILITY / BOOKING / CLASSES / ATTENDANCE COMPLETE
MANUAL GOOGLE MEET VALIDATION                 COMPLETE (string validation only; no API)
CLASS REMINDERS / SERVICE MAIL                COMPLETE (shared communication architecture)
MY CLASSES / MY TEACHERS                      COMPLETE
PUBLIC /learn/live, /learn/teachers           COMPLETE — activation-aware
REAL teaching.perform HOLDERS                 NONE
LIVE-LEARNING ACTIVATION (production)         BLOCKED — no activation row exists
SAFEGUARDING / MEET / TEACHER-GRANT GATES      OPEN — OPEN_DECISIONS.md §2.1, §5.3, §6.3
PHASE 24 MESSAGING                            NOT STARTED at this exit — since delivered (Phase 24)
```

- **Permissions:** `teaching.perform` is catalogued and **externally gated** — bundled into no
  role, held by nobody, grantable only through `permissions.grant` with its step-up and audit;
  `learning.classes.read` and `learning.classes.administer` are ordinary keys bundled into the
  protected role with session invalidation. Phase 22's `learning.read` / `learning.administer`
  are **not** widened: they still show counts and never a learner. No `attendance.*`, `meeting.*`,
  `booking.*` or `availability.*` key exists. No new step-up purpose.
- **Activation is a fail-closed row** (`LiveLearningActivation`, DOMAIN_MODEL.md §13.5): absent by
  default, operator-written, immutable, and enforced by the database on every window, session and
  booking write. Engineering closure records no row; a `fixture` row is test-only and never survives
  a test; an `approved` row is the organisation's later decision.
- **The typed teaching scope** names a Course and the exact live RoleAssignment carrying
  `teaching.perform`; current means not ended AND still live in Identity, re-read every request.
  No scope row means no authority. CourseTeacher attribution grants nothing and is left as it is.
- **Delivered routes:** `/learn/live`, `/learn/teachers` (+ the one-hop `/learn/teachers/{slug}`
  301 to `/people/{slug}`), `/my/classes`, `/my/classes/{id}`, `/my/teachers`, every teacher route
  of ROUTE_MAP.md §6 **except** `/teacher/messages`, `/admin/learning/classes` (with its session,
  scope and new-session views) and trial confirmation on `/admin/learning/trials`. `/learn/training`
  and `/learn/resources` remain absent (no owner contract).
- **Reminder timing** is a per-session choice of 60, 180 or 1,440 minutes or none; no fixed lead is
  promised. A reschedule abandons the old intent and commits a new one.
- **No-show** is derived from an absent or unmarked trial participant on a completed session; no
  Booking state was added.
- **Teacher notes** are not delivered: INFORMATION_ARCHITECTURE.md §6 no longer promises free-form
  notes on a learner, because no accepted contract defines their retention or safeguarding rules.
- **No recording, no Google Calendar/Meet API, no OAuth credential, no messaging, no realtime
  process**, no Storage/Media/Library relation for "materials" (the teacher reads the Course's own
  syllabus and lesson bodies), no under-18 rule of any kind.

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

**Phase-24 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
MESSAGING DOMAIN (non-realtime)               COMPLETE (this phase, policy-independent)
SERVER-CORE MESSAGING + RELATIONSHIPS HOSTS   COMPLETE (one implementation for both processes)
TEACHER↔STUDENT MECHANICS                     COMPLETE — production activation BLOCKED
STUDENT↔STUDENT                               DEFAULT DENY — peer policy refuses every pair
AUTHENTICATED SUPPORT / MODERATION            ENGINEERED — no staff, no activation
ATTACHMENTS                                   COMPLETE — owner-safe Storage release
REAL messaging.support / messaging.moderate   NONE
MESSAGING ACTIVATION (production)             BLOCKED — no activation row exists
SAFEGUARDING / PEER / SUPPORT-OWNERSHIP GATES  OPEN — OPEN_DECISIONS.md §2.1, §2.5, §6.6 (§2.2 for retention)
PHASE 25 REALTIME                             NOT STARTED at this exit — since delivered (Phase 25)
```

- **Where the code lives.** Messaging's application services are hosted in
  `packages/server-core/src/messaging` and Learning's current-relationship answer in
  `packages/server-core/src/relationships` (ARCHITECTURE.md §3.1.3); the adapter is
  `packages/database/src/adapters/messaging`; Layer 4 wiring is `apps/web/src/composition/messaging.ts`.
  No `apps/realtime`, socket, presence, typing state or polling exists.
- **Permissions:** `messaging.support` and `messaging.moderate` are catalogued and **externally
  gated** — bundled into no role, held by nobody, no session invalidated; no `messaging.read` or
  `messaging.administer` exists. Ordinary messaging is authorised by the current relationship alone.
- **Activation is a row per kind** (`MessagingActivation`: `support`, `teacher-student`,
  `student-student`), operator-written, immutable, enforced by the database; engineering closure records
  none. Student-to-student also needs the peer policy, which denies every pair in production.
- **Bounds (engineering, not policy):** 4,000 code points per message; JPEG, PNG or PDF, at most four
  per message and 5 MiB each; history pages of 30, catch-up pages of 50, lists of 25; an unsent upload
  is released after 24 hours.
- **The account-closure terminal-history rule** is canonical in DOMAIN_MODEL.md §15.6: only a verified
  closure lets the remaining participant keep read-only history, and only while their own half of the
  relationship is current; ordinary revocation, withdrawal, a block or a moderator's closure never do.
- **Delivered routes:** `/my/messages`, `/my/messages/{id}`, `/my/messages/support`, `/teacher/messages`,
  `/teacher/messages/{id}`, `/admin/messaging/{support,moderation,reports}` with their detail pages, the
  `/api/messaging/*` catch-up, upload and discard routes, the three `/assets/messaging/*` byte routes and
  `/api/my/export/messaging` (ROUTE_MAP.md §5.1, §6, §7, §8).
- **Not delivered:** realtime delivery (Phase 25), edit/delete/unsend, group or public conversations,
  message email or notification, a learner directory, real support or moderation staff, and every
  policy the open gates reserve.

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

**Phase-25 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
REALTIME TRANSPORT (apps/realtime)             COMPLETE — Socket.IO 4.8.3, WebSocket only
SAME SERVICES                                  COMPLETE — server-core Identity session/authorisation + Messaging
PER-EVENT AND PER-RECIPIENT CURRENT AUTH       COMPLETE
PRESENCE / TYPING                              EPHEMERAL, IN MEMORY, NEVER PERSISTED
NGINX /socket.io/ WEBSOCKET SEAM               COMPLETE — pinned image, proven in CI
NEW TABLE / MIGRATION                          NONE — persistent database unchanged at Phase 24
REDIS / SCALE-OUT                              NONE — single realtime instance
MESSAGING ACTIVATION (production)              BLOCKED — unchanged
SAFEGUARDING / PEER / SUPPORT-OWNERSHIP GATES   OPEN — OPEN_DECISIONS.md §2.1, §2.5, §6.6 (§2.2)
```

- **Composition seam.** `apps/realtime` is the transport only: Socket.IO, the event handlers, the
  per-connection budgets, and ephemeral presence and typing. It reaches nothing but Node, Socket.IO,
  `@minhaj/contracts` and `@minhaj/server-core`, and is handed two composed services. The realtime
  PROCESS's Layer-4 composition root lives in the composition workspace
  (`apps/web/src/composition/realtime.ts`, started by `realtime-main.ts`) and wires the same adapters
  through the same builders the web process uses (`identity-mechanics.ts`, `messaging-wiring.ts`), so
  both processes verify a session and decide a conversation identically (ARCHITECTURE.md §3.6).
- **Events.** `conversation:subscribe`, `conversation:unsubscribe`, `conversation:catch-up`,
  `message:send`, `message:read` and `typing:set` in; `message:created`, `presence:changed` and
  `typing:changed` out — each strict-Zod-validated and acknowledged. Starting a conversation,
  attachments, blocking, reporting, support administration and moderation have no event and stay on
  their audited web paths; support staff do not use the socket at all.
- **Durability.** A send commits through `MessagingService.send` (the same operation-id idempotency)
  before any delivery; a delivery is the committed row read for its recipient. Catch-up from the
  durable sequence is the only recovery; connection-state recovery is off.
- **Bounds.** 64 KiB frames, 20 subscriptions per connection, per-connection budgets per event, a
  6-second typing TTL — engineering bounds, not policy.
- **Degradation.** With the realtime process stopped the web application lists, reads and sends as
  in Phase 24; after a restart clients reconnect with bounded backoff and catch up exactly once.
- **NGINX.** The seam only — HTTP to `web`, `/socket.io/` upgraded to `realtime`, Host and
  forwarding headers set by the proxy. TLS, DNS, full security headers and deployment automation stay
  with Phases 28 and 34.

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

**Phase-26 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
MEMBERSHIP CONTEXT                             COMPLETE — apps/web/src/contexts/membership
PUBLIC MEMBERSHIP INFORMATION (/membership)    COMPLETE — published types only, no session
APPLICANT SELF-SERVICE (/my/membership)        COMPLETE — apply, withdraw, close own Membership
REVIEW AND DECISION (/admin/membership/*)      COMPLETE — membership.read / membership.administer
DURABLE SERVICE COMMUNICATION                  COMPLETE — six transactional purposes, shared dispatcher
EXPORT / ACCOUNT-CLOSURE DISPOSITION           COMPLETE — closure withdraws open applications only
PAYMENT PROVIDER / PAYMENT CODE PATH           NONE — not selected, not needed, refused by test
PEOPLE / GLOBAL NETWORK EDGES                  PERMITTED, UNUSED — no Person, Centre or place named
REAL MEMBERSHIP TYPES / APPLICATIONS           NONE — persistent database holds no Membership rows
JURISDICTION AND RETENTION                     OPEN — OPEN_DECISIONS.md §2.2
PHASE 27 DONATIONS                             NOT STARTED at this exit — since delivered (Phase 27)
```

- **Where the code lives.** The context is `apps/web/src/contexts/membership` (public, applicant,
  admin, account and communication services); its contracts are `@minhaj/contracts/membership`; its
  adapter is `packages/database/src/adapters/membership`; Layer-4 wiring is
  `apps/web/src/composition/membership.ts` and, for the public page, `membership-read.ts`, which
  reaches no Identity. One migration, `20261009000000_phase26_membership`, adds five tables
  (DOMAIN_MODEL.md §17.2.1).
- **Lifecycles.** MembershipType `draft → published → archived → published`, never back to draft;
  application `submitted → under_review → approved | rejected`, `submitted | under_review →
  withdrawn`; Membership `active → closed`. No other status exists — in particular no payment,
  pending-payment or expiry status.
- **Invariants.** One open application and one active Membership per account and type; one
  Membership per application; approval creates the Membership in the same transaction as the
  decision, the audit row and the applicant's intent. An archived type takes no new application
  and no approval (a rejection still may). Re-applying after a closure, rejection or withdrawal is
  allowed; no waiting period exists.
- **Permissions:** `membership.read` (every operator page) and `membership.administer` (every
  operator act) — ordinary keys in the protected Platform Administrator bundle; the migration
  revoked the bundle holders' sessions and step-up grants and wrote one provisioning audit row. No
  review, publish, finance or payment key, no externally gated key and no step-up purpose exist.
  An applicant needs no key: ownership decides.
- **Service communication:** `membership.application.{submitted,under-review,approved,rejected,
  withdrawn}` and `membership.closed`, committed in the transaction that owes them, relayed by the
  shared dispatcher, rendered at send time with a link to `/my/membership` only, transactional
  scope. An account-closure withdrawal owes nothing (ARCHITECTURE.md §4.6.1).
- **Account closure ≠ resignation.** Disposition withdraws open applications (`account-closure`)
  and removes owed mail; an active Membership stays active (SECURITY_BASELINE.md §19.1.6).
- **Not discoverable.** No Search kind, no dynamic sitemap segment, no per-type route; `/membership`
  joins the static `pages` sitemap partition through the shell registry like every other delivered
  utility route, under the unchanged pre-adoption `noindex` posture.
- **Delivered routes:** `/membership`, `/my/membership`, `/admin/membership`,
  `/admin/membership/applications`, `/admin/membership/applications/{id}` and
  `/api/my/export/membership` (ROUTE_MAP.md §3.1, §5.1, §7, §8).
- **Proof that cannot silently skip.** The live-SQL Membership suites run in the `Database
  foundation` job, and `scripts/assert-membership-proofs.mjs` fails the job if any of them skipped.
- **Not delivered:** any fee, dues, payment or donation link; a membership number, card, expiry or
  renewal; an application questionnaire, document upload or operator note; a Person or Centre link
  for members; real MembershipType content, which operators enter.

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

**Phase-27 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
DONATIONS CONTEXT                              COMPLETE — apps/web/src/contexts/donations
PAYMENTPROVIDER ABSTRACTION                    COMPLETE — @minhaj/contracts/donations
SANDBOX ENGINEERING ADAPTER                    STRIPE — NOT PRODUCTION PROVIDER SELECTION
PUBLIC GIVING (/donate)                        COMPLETE — published campaigns, anonymous start, no session
DONOR RETURN / STATUS                          COMPLETE — constant return page, opaque status token
LINKED GIVING (/my/donations)                  COMPLETE — history, linked start, export
OPERATORS (/admin/donations/*)                 COMPLETE — donations.read / donations.administer
REFUNDS                                        COMPLETE — donations.refund (gated, no holder) + donation-refund step-up
WEBHOOK / DEDUP / OUT-OF-ORDER / RECONCILE     COMPLETE — verified, durable, convergent, SQL-leased sweep
DURABLE SERVICE COMMUNICATION                  COMPLETE — three transactional purposes, linked donors only
EXPORT / ACCOUNT-CLOSURE DISPOSITION           COMPLETE — link released, financial history kept
PRODUCTION PROVIDER / MERCHANT / ACTIVATION    OPEN — OPEN_DECISIONS.md §5.4; no activation row exists
RECURRING / SAVED CARDS / GIFT AID / TAX       NONE — not built
REAL CAMPAIGNS / DONATIONS                     NONE — persistent database holds no Donations rows
JURISDICTION AND RETENTION                     OPEN — OPEN_DECISIONS.md §2.2
```

- **Where the code lives.** The context is `apps/web/src/contexts/donations` (public, donor, owner,
  admin, ledger, account and communication services); its contracts, the `PaymentProvider` port
  and exact money are `@minhaj/contracts/donations`; its persistence adapter is
  `packages/database/src/adapters/donations` and its payment adapter
  `packages/database/src/adapters/donations-stripe`, both owned by Donations. Layer-4 wiring is
  `apps/web/src/composition/donations.ts`; the public page reads through `donations-read.ts`, which
  reaches no Identity and no secret. One migration, `20261010000000_phase27_donations`, adds eight
  tables (DOMAIN_MODEL.md §17.3.1).
- **Sandbox, not selection.** Safepay, the preferred candidate, failed required properties of its
  current official material (webhook HMAC over re-serialised parsed JSON, no timestamp, no constant-
  time comparison, no documented refund API); JazzCash has no verifiable public documentation. The
  Stripe sandbox satisfies every required property and is recorded as the engineering adapter only
  (TECH_STACK.md §18.4). CI and the browser suite use a deterministic loopback Stripe-protocol
  simulator with synthetic secrets; the live sandbox proof (`npm run donations:sandbox:proof`) needs
  credentials in ignored local configuration and never runs in CI.
- **Real sandbox evidence.** On 2026-10-19 the adapter was proven against an anonymous sandbox the
  official Stripe CLI provisioned (test mode only): checkout create, read-back, resume and
  cancellation, a captured test payment with partial and full refunds, and a real Stripe-signed webhook
  delivered by `stripe listen --forward-to` to the production build on a disposable database, verified,
  applied once, deduplicated and tamper-refused (SECURITY_BASELINE.md §14). Payment-success and dispute
  events were not driven live; the signed fixtures and the simulator stay the authoritative CI proof.
- **Money.** `bigint` ISO minor units with the stored exponent, parsed from decimal text without
  rounding; zero-, two- and three-decimal currencies are proven. The client requests; the server
  creates the immutable expected amount from the campaign's current policy.
- **Lifecycle.** A donation's state is derived from monotonic facts by one rule the database
  re-checks: `pending`, `succeeded`, `failed`, `cancelled`, `expired`, `partially_refunded`,
  `refunded`, `disputed`, `charged_back`. Out-of-order and duplicate provider news converges; a
  mismatch never succeeds and raises an attention flag.
- **Redirect is not authority.** Success is only a verified webhook followed by a server-to-server
  read, or the reconciliation sweep's read. The return URL is constant, carries no token and reads no
  query string.
- **Idempotency.** A form's operation id makes a duplicate submission the same donation; an
  ambiguous checkout creation is repeated only under its original idempotency key with byte-identical
  parameters; a refund is never repeated and is resolved by finding it at the provider.
- **Activation.** Fail closed: no `DonationActivation` row, no payment. Fixture and sandbox need
  `fixture` authority; production needs `approved` authority with external evidence, which neither
  the runtime nor any Donations key can write.
- **Permissions:** `donations.read` and `donations.administer` — ordinary keys in the protected
  Platform Administrator bundle (the migration revoked the bundle holders' sessions and step-up grants
  and wrote one provisioning audit row); `donations.refund` — externally gated, bundled into no role,
  held by nobody, and every refund also needs the new `donation-refund` step-up, re-checked by the
  database. A donor needs no key.
- **Not discoverable.** No Search kind, no dynamic sitemap segment, no per-campaign route, no
  `Product` or `Offer` structured data; `/donate` joins the static pages partition through the shell
  registry under the unchanged pre-adoption `noindex` posture, and is `noindex` in any non-production
  environment.
- **Delivered routes:** `/donate`, `/donate/return`, `/donate/status/{token}`, `/my/donations`,
  `/admin/donations`, `/admin/donations/{id}`, `/admin/donations/campaigns`,
  `/admin/donations/campaigns/{id}`, `/api/my/export/donations`, `/api/admin/donations/export` and
  `/api/webhooks/stripe` (ROUTE_MAP.md §3.1, §5.1, §7, §8).
- **Proof that cannot silently skip.** The live-SQL Donations suites and the offline protocol suites
  run in the `Database foundation` job, and `scripts/assert-donations-proofs.mjs` fails the job if any
  required file is missing, ran nothing, or skipped a test.
- **Membership untouched.** No Membership file, table or key changed; the Phase-26 guard still refuses
  any payment concept in Membership and any edge between the two.
- **Not delivered:** recurring giving, saved instruments, Gift Aid, tax receipts, donor walls,
  targets or progress bars, an anonymous donor email, real campaign content (operators enter it), a
  production provider or merchant account, and any refund holder.

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

> **Delivered (Phase 28).** The entry gate was satisfied by an explicit owner decision for a
> **developer-controlled pre-adoption staging environment** (OPEN_DECISIONS.md §4.1, §4.2,
> §4.4): `https://minhaj.haseebliaqat.me` on an Azure for Students virtual machine running the
> locked self-hosted shape — pinned NGINX, the production web runtime, realtime, SQL Server 2022
> Developer + FTS and ClamAV — with backups in private Blob storage and images in a private
> registry (ARCHITECTURE.md §10.6). Delivered: the production `runtime` stage of
> `docker/web.Dockerfile` and the `docker/ops.Dockerfile` operations image; `docker/staging/`
> (compose, host scripts, timers) and the staging NGINX template; the protected exact-SHA
> `staging-deploy.yml` workflow (OIDC, private registry, deploy by digest, previous-release
> restore); staging target guards and the `staging:db:*` operator commands (create, migrate,
> provision, seed, backup, restore proof, reset, inspect); the environment gate and whole-site
> `noindex`/`Disallow` (SECURITY_BASELINE.md §21); and SQL **plus** Storage backup with an actual
> isolated restore. **No schema change**: at Phase-28 delivery staging was migrated with the
> accepted history as it then stood — 27 migrations ending at `20261010000000_phase27_donations`
> (Phase 29 later added the 28th). Email was disabled (Phase 30 later enabled transactional
> email for the owner's staging accounts), no payment provider was configured, gated religious, safeguarding and messaging capabilities stay fail-closed, and
> the only seed is one synthetic, non-religious asset. Production hosting, licensing, HA/DR,
> monitoring and the rollback runbook remain **Phase 34**; no Phase 29 work was included.

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

> **Delivered (Phase 29) — FIXTURE-ONLY.** The framework is delivered and proven against synthetic
> fixtures alone. Every source it can register is a `fixture` source naming only
> `*.fixture.invalid` hosts (RFC 6761: `.invalid` never resolves publicly), served by a loopback
> fixture server or by an in-memory synthetic export. **No real legacy source was contacted** — no
> request, `robots.txt`, sitemap, favicon or browser visit — **and no real asset was copied.**
> **Phase 30's per-source written-authorisation gate is unchanged and absolute** (OPEN_DECISIONS.md
> §3.1): the service refuses to register, activate or run any non-fixture source
> (`real-source-not-authorised`), and nothing in Phase 29 records an authorisation.

**Phase-29 continuity — decisions made while delivering, recorded here rather than left in
review history:**

```
MIGRATION & PROVENANCE CONTEXT                 COMPLETE — apps/web/src/contexts/migration-provenance
PORTS, VOCABULARIES, SSRF POLICY               COMPLETE — @minhaj/contracts/migration
PERSISTENCE                                    COMPLETE — 18 Migration* tables, CHECKs, triggers 51370–51384
PIPELINE                                       COMPLETE — bounded, checkpointed, leased, resumable; fixtures only
SAFE FETCH / SSRF / DNS REBINDING              COMPLETE — pinned validated address, re-validated per redirect
RETRY CLASSIFICATION / RETRY-AFTER             COMPLETE — transient only; 401/403 never; long pauses defer
SANITISATION BEFORE STAGING / INERT RAW        COMPLETE — allowlist before storage; escaped preview or attachment
DEDUP / LINKS / TOPICS / RIGHTS / ABSENCE      COMPLETE — human decisions, version-checked and audited
RECONCILIATION                                 COMPLETE — an unbalanced run blocks every manifest of it
REVERSIBLE PUBLICATION                         COMPLETE — Media Video through Media's public service
PROMOTION MANIFEST                             COMPLETE — reviewed, approved, carried into a checksummed bundle
ADMINISTRATION (/admin/migration/*)            COMPLETE — migration.read / migration.administer / migration.publish
MIGRATION.PUBLISH HOLDERS                      NONE — externally gated, bundled into no role (OPEN_DECISIONS.md §3.5)
REAL SOURCES / LIVE INGESTION / REAL ASSETS    NONE — OPEN_DECISIONS.md §3.1 gates Phase 30
CONTENT KINDS BEYOND media.video               NONE — each arrives with its Layer-4 publisher
LEGACY 301 SERVING / SYSTEM REDIRECTS SURFACE  NONE — mapping data exists; 301s go live in Phase 35
PRODUCTION PROMOTION DESTINATION               NONE — Phase 35; the local bundle is Phase 29's destination
RAW SNAPSHOT RETENTION PERIOD                  OPEN — disposal mechanism delivered, no period (OPEN_DECISIONS.md §2.2)
```

- **Where the code lives.** The context is `apps/web/src/contexts/migration-provenance` — source,
  pipeline, decision, raw-evidence, publication, promotion and read services over pure domain rules
  for normalisation, link rewriting, retry and reconciliation. Its vocabularies, bounds, input
  schemas, SSRF address and URL policy, every port and the source-adapter contract are
  `@minhaj/contracts/migration`; its persistence adapter is
  `packages/database/src/adapters/migration-provenance`, owned by Migration. Layer 4 is one wiring
  shared by two roots: `apps/web/src/composition/migration-wiring.ts`, composed by `migration.ts`
  (web) and by the node-runnable `migration-runner.ts` (tooling), with the Media Video target in
  `migration-targets.ts`. The tooling is `scripts/migration/`. One migration,
  `20261011000000_phase29_migration_provenance`, with its rollback script, adds eighteen tables
  (DOMAIN_MODEL.md §16.5).
- **Fixture authority is fixed at creation.** The registration schema has no authority field; the
  database CHECK binds a `fixture` source to no authorisation evidence and to `*.fixture.invalid`
  hosts, and the runtime principal is denied UPDATE of a source's authority, access method, base
  URL and authorisation columns, so a fixture can never become a real source by an edit.
- **One content kind, one real target.** `media.video` only: provider identifiers and words, never
  video bytes. Publication creates a `published` Video through `createMediaService(...).saveVideo`
  under Media's own `media.administer` — a target refusal is final — at the canonical path
  `/watch/videos/{slug}`; rollback saves it `archived` at the recorded version. A Video edited since,
  missing, or held by a person (Personalisation's `videoHeld`) is `rollback-refused` and left for a
  person (MIGRATION_STRATEGY.md §7.2).
- **Pipeline.** Sequential, one item at a time, checkpointed every batch of at most 25, one open
  run per source held by a renewable lease; an interrupted run (`--max-items`) resumes with every
  record fetched once and nothing staged twice. Identical evidence is recorded `unchanged`; changed
  evidence produces a new staged revision for review that supersedes the earlier pending or
  approved one — a published Video is never overwritten by it. Every run and revision records
  adapter, parser, normaliser and code revision.
- **Runs and promotions are command-line operations.** `npm run migration:run-fixture` and
  `npm run migration:promote` run under plain Node through `migration-runner.ts`; the browser
  surfaces hold every human decision and show where runs and promotions stand, and never start one.
- **Executable legacy export.** `scripts/migration/export/synthetic-export.sql` is executed into an
  in-memory `node:sqlite` database — another engine and schema — made query-only, and read through
  an export adapter. It never touches SQL Server and never becomes the target schema.
- **Permissions:** `migration.read` and `migration.administer` — ordinary keys in the protected
  Platform Administrator bundle (the migration revoked the bundle holders' sessions and step-up
  grants and wrote one provisioning audit row); `migration.publish` — externally gated, bundled into
  no role, held by nobody, and every publish, rollback and promotion approval also needs the new
  `migration-publication` step-up, checked by the Server Action, re-verified by the service and
  re-checked by the database trigger.
- **Staged content is not public.** No public route, API, sitemap segment or Search kind reads a
  staged record; the admin subtree is `noindex, nofollow` and per request. The one public form
  migration creates is a published Video, through Media.
- **Staging proof.** `npm run staging:migration:proof` (`docker/staging/bin/migration-proof.sh` on
  the staging VM, from the exact-SHA operations image) writes one disposable synthetic operator,
  runs `scripts/migration/staging-fixture-proof.ts` as the runtime principal against a loopback
  fixture server inside the container — run, interrupt, resume, publish through Media, promote into
  a temporary bundle, withdraw a second promotion, roll back — and revokes the operator afterwards.
  Locally the same proof runs against a disposable database through
  `tests/migration/staging-fixture-proof.integration.test.ts`.
- **Delivered routes:** `/admin/migration`, `/sources`, `/runs`, `/runs/{id}`, `/staging`,
  `/staging/{id}`, `/duplicates`, `/url-mapping`, `/errors`, `/manifests`, `/manifests/{id}`,
  `/reconciliation`, `GET /api/admin/migration/runs/{id}` and
  `GET /api/admin/migration/snapshots/{id}` (ROUTE_MAP.md §7, §8).
- **Not delivered:** any real or `authorised` source, adapter or ingestion; content kinds other than
  `media.video`; serving legacy 301s and the `/admin/system/redirects` surface; a production
  promotion destination; a raw-snapshot retention period; and any `migration.publish` holder.

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
> **not contacted** (OPEN_DECISIONS.md §3.1). The minimum per-source decision record is
> OPEN_DECISIONS.md §3.1.1.

> **The other Phase-30 decisions gate later moments, not the start** (OPEN_DECISIONS.md §3.6):
> per-source scope and asset rights gate that source's ingestion (OPEN_DECISIONS.md §3.3, §2.4); a
> missing export or API is **not** a start blocker — authorised public-content ingestion is the
> fallback (§3.2 there); religious source, review and conflict authority gate the acceptance of
> affected religious content (§1.1–§1.6 there); and a `migration.publish` holder (§3.5 there) is
> needed before real content can be **published in staging** — this phase's exit. **A Phase 30
> meant to complete in one run needs all of these supplied before it starts.** Production DNS,
> legacy hosting, promotion and cutover are Phase 35's alone (§3.4 there) and are not entry
> criteria here.

**Deliverables:** Per-source adapters · migration executed **against staging** in the risk
order of MIGRATION_STRATEGY.md §10.1 · deduplication resolved · **URL mapping complete and
reviewed** · **unresolved-link report reviewed** · **reconciliation balanced** · **domain-specific
editorial and religious QA completed**.

**Tests:** **No religious content published without human approval** · duplicates resolved with
**all legacy URLs preserved** · **counts reconcile** · **no private data ingested** · asset
checksums and **per-asset licensing evidence** verified · **every in-scope legacy URL resolves
deterministically through `LegacyMapping` to its intended canonical target, with no chain in the
mapping, proven in staging or through a controlled resolver or test harness**
(MIGRATION_STRATEGY.md §9.5). **No real legacy domain is claimed to serve a 301** — that is Phase 35.
**Exit:** Content migrated, reviewed, approved and published **in staging**, by a holder of
`migration.publish` under the `migration-publication` step-up. **Religious content signed off by
Minhaj religious authority.** Completes on review capacity, not a date.

> **Two corpus stages, one phase (owner roadmap decision, 2026-10-27; MIGRATION_STRATEGY.md
> §10.1.0).** **Stage 1A** runs the complete Phase-30 machinery over a bounded, representative real
> review corpus, so the pre-adoption build can be reviewed with real content in every built public
> area; **Stage 1B** widens the same registrations to the full authorised corpus after Minhaj's
> review and go-ahead. Phase-30 **engineering** may be complete at Stage 1A; the **exit above**
> stays open until Stage 1B, its reconciliation and the required content acceptance complete.
> **Phase 31 requires Stage 1B.** Neither stage is a new product phase, a DemoMode or a separate
> import path, and representative content is data, never a reduced product.

> **Stage 1A — run on staging (2026-10-28/29).** Eleven authorised sources, one bounded run each:
> 165 discovered, 164 staged, 1 rejected; every run balanced. 134 ordinary records (Library, Media,
> news and articles) were reviewed and published in staging under `migration.publish` and the
> `migration-publication` step-up, held by the owner's first administrator and granted by a second
> (OPEN_DECISIONS.md §3.5); Editorial's 59 were approved and published by that second
> administrator. 134 legacy mappings, one typed target each, no chain. Fatwa and Quran revisions
> (30) stay staged for qualified review. The Phase-30 **exit** stays open: Stage 1B, its
> reconciliation and religious sign-off have not happened (MIGRATION_STRATEGY.md §14).

> **Phase 30-R — Stage-1A review completeness (an OPERATIONAL macro inside Phase 30, not a new
> phase number; owner decision 2026-10-29, OPEN_DECISIONS.md §3.7).** The first Stage-1A corpus
> proved the machinery but was too sparse to present. Delivered on one branch: migration
> `20261030000000_phase30r_review_completeness` (30 migrations) — optional typed visuals (an
> Editorial lead image on Article, NewsArticle, PressRelease and Page revisions with per-translation
> alt text; a Person portrait; Edition and MagazineIssue covers; a Video poster — each one NO ACTION
> key to a stored Asset with its measured box, served only by its owning domain), the source's
> original publication date on Article, NewsArticle and PressRelease revisions and the root
> `chronologyAt` every listing now orders by, four more migration kinds (`editorial.press-release`,
> `editorial.page`, `people.person`, `global.country`), per-source first-party asset hosts, the
> metadata-stripped public copy of an acquired image, replay of retained raw evidence, and REFRESH
> manifest entries that carry a newer approved revision into an already-published record through
> its own domain (MIGRATION_STRATEGY.md §15). The official MQI logo is the provisional brand
> lockup (OPEN_DECISIONS.md §6.4). The Database-foundation Messaging proof now prints the failing
> test and its first failure lines beside the JSON report, still failing with the run's status.
> Staging result (2026-10-29/30, MIGRATION_STRATEGY.md §15.1): 21 runs, every one balanced — the
> Stage-1A sources replayed from their retained evidence, then 545 items discovered and 396 staged
> in the bounded expansion; 496 manifest entries published (364 new records, 132 refreshes), 2
> refused by Library; **497 ordinary records public**, every Editorial one approved and published by
> a second administrator; 461 first-party pictures, each decided public by a person; every news
> item, article and press release dated by its source; 497 active legacy mappings with no chain and
> no address mapped twice. Fatwa (24) and Quran (6) revisions stay review-only, never manifested.
> Ingestion ran on the exact CI-green releases `730159e`, `d956ce4` and `821dca7` (branch CI
> 40978771144, staging deploy 40980811932); a post-migration backup set `20261030T120812Z` passed an
> isolated restore proof from Blob. Visual acceptance on staging at 390, 768 and 1440 px in en, ur
> and ar over 30 public routes — home, Explore with a migrated page, leadership and a profile, News
> with an item in each language, press releases, Library, articles, books, magazines and an issue,
> Watch and a video, Global and a country, Learn, Quran, Hadith, Fatwa and search: each answered
> 200 in its locale's direction with no horizontal overflow, no broken or alt-less image and one
> main heading. Three source defects found on the way were fixed by normal
> commits (Press-Release listing, minhaj.info cover originals, a listing page cut mid-character),
> as were a manifest page that could not offer past its first page of revisions and one legacy
> address taken by two sources. Stage 1B, Phase 31, Phase 32 and production cutover have **not**
> started, and no official adoption is claimed.

> **Phase 30-RF — final Stage-1A gap closure (an OPERATIONAL continuation inside Phase 30, a
> working checkpoint label, not a new phase).** No schema change (30 migrations). Delivered: the
> four bound Explore pages §15.1 had called "section-landing" were ordinary posts the site
> redirects under an empty category segment — one address-pattern fix, replayed from retained
> evidence, all four published by a second administrator (seven of eight bound pages live); still
> WebP admitted by Storage for a policy that names it, container-validated and stripped with no
> pixel decoded, reaching Library covers only (SECURITY_BASELINE.md §10.8) — eight of the nine
> coverless issues now carry their cover, the ninth's own page names a `.php` path; a final
> source-limitation sweep recording Learning, Events, Audio, Galleries/Photos and Centres YELLOW
> with evidence (MIGRATION_STRATEGY.md §16); and one presentation defect the final review found — an
> undated Page (an organisational, help or legal destination) no longer states the day the
> platform published it as its "Published" date, which made a 2009 profile read as new. Two
> findings need an owner decision and were not built
> (OPEN_DECISIONS.md §3.8): clearing a personal-data flag on the introduction page's organisational
> contacts, and Collections from the source's curated archives. Staging result (2026-10-31,
> MIGRATION_STRATEGY.md §16.1): 3 balanced replays, 13 entries published, **501 ordinary public
> records**, 501 active mappings with no chain or duplicate, 470 first-party pictures each decided
> public by a person, Fatwa and Quran still review-only; backup `20261031T093409Z` restore-proven.
> Ingestion ran on the exact CI-green release `0945a86` (branch CI 41182517179, staging deploy
> 41183695614); the Page-date fix followed as `0b3cea0` (branch CI 41193297494, deploy
> 41194727578), and the final review — 47 routes, three locales, three widths, 423 loads, no
> request to another host — passed on it.
> **Phase 30 engineering and Stage 1A are complete.** Stage 1B, Phase 31, Phase 32 and production
> cutover have **not** started, and no official adoption is claimed.

> **Phase 30-RD — the two owner decisions of OPEN_DECISIONS.md §3.8 (an OPERATIONAL continuation
> inside Phase 30, a working checkpoint label, not a new phase).** One schema migration,
> `20261031000000_phase30rd_owner_decisions` (31 migrations). Delivered: a narrow, audited
> clearance of personal-data FALSE POSITIVES — each detector match recorded as evidence (never its
> text), classified by a holder of the externally gated `migration.clearPersonalData` after its own
> `migration-personal-data` step-up, a replay of the retained snapshot into a new `cleared`
> revision only when every match is public organisational, approved by a different person, every
> rule held by the database too (SECURITY_BASELINE.md §10.9); the `editorial.collection` kind with
> its typed `collectionId` target, two bounded catalogued sources for exactly three source-curated
> archives and the 114 posts they hold, members resolved only through active mappings and confirmed
> public by their owners, and two unmigratable entries named in the payload rather than dropped
> (MIGRATION_STRATEGY.md §17); and a guarded command that removes leftover local restore and test
> databases (`npm run db:residue:cleanup`). Staging result (2026-11-02, MIGRATION_STRATEGY.md
> §17.1): the introduction page published — **all eight** bound Explore pages — **three Collections**
> (Al-Hidayah 19, Mawlid Conferences 42, Itikaf 51), **617 ordinary public records**, 617 active
> mappings with no chain or duplicate, 577 pictures, Fatwa and Quran still review-only; backup
> `20261102T171008Z` restore-proven. Clearance and members ran on `c5d0dbb` (CI 41226330077,
> migrate-and-deploy 41229333489), the Collections on `576e5b3` (CI 41480782196, deploy
> 41484695429); the release carrying this record was the one staging and `main` both ran at
> Phase 30-RD exit.
> **Phase 30-RD is complete.** Stage 1B, Phase 31, Phase 32 and production cutover have **not**
> started, no official adoption is claimed, and religious acceptance stays separate and open.

> **Phase 30-RV — the owner's staging review, defect-only (a working checkpoint label, not a new
> phase).** No schema change. Five ordinary defects found by the final review of the deployed build
> are fixed at their cause (MIGRATION_STRATEGY.md §18): a reference into a record's own document
> is dropped rather than rewritten to the page itself; an image-only link keeps its image's `alt`
> as its words, in the body even when it is also the lead picture; a heading before a biography's
> prose is not its opening paragraph; a Page's search result states no year, as the Page states no
> date; and a description under a left-to-right label takes its direction from its own text
> (`NORMALIZER_VERSION` 30.3). Issue and book order (slug order — a model decision) and the bare
> titles of private pages are recorded, not changed. Staging result (2026-11-03,
> MIGRATION_STRATEGY.md §18.1): the fixes ran on `8d5d49a` (CI 41605219941, deploy 41608188495) —
> five revisions refreshed and published (peace, mobile apps, UN recognition, the biography page
> and one leadership profile), no lead image changed, totals unchanged at 617, search rebuilt, and
> the final review — 41 routes, three locales, three widths, 369 loads, no request to another host —
> passed. The owner's verdict on the staging build is pending; Stage 1B, Phase 31, Phase 32 and
> production cutover have **not** started.

> **Rebaseline Program R1 — Flagship Foundation (an OPERATIONAL macro, 2026-11-06; owner-directed,
> not a canonical phase and not Phase 31).** It follows the independent Enterprise Product
> Re-Baseline Audit (2026-11-06, held outside the repository) and resets the product's
> foundation — identity, addresses, navigation, typography and frame — before any further
> presentation work. **No schema change** (31 migrations; latest
> `20261031000000_phase30rd_owner_decisions`), no new npm dependency, public indexing still off,
> staging still pre-adoption.
>
> **Owner decisions (2026-11-06, Haseeb, project owner; OPEN_DECISIONS.md §6.4, §8):** the interim
> One Minhaj visual identity (replaceable by Minhaj's brand pack, which stays OPEN; the official
> MQI logo unmodified as a secondary footer mark; a typographic "One Minhaj" wordmark with an
> eight-point star outline); unprefixed English URLs; content-aware navigation; the one
> pre-adoption statement in the footer; and the readiness vocabulary below.
>
> **Delivered:**
>
> - **Visual identity as tokens** — the palette, radii and shadows by role in one `@theme` block,
>   every role a Tailwind utility; 1,403 arbitrary `[color:var(--…)]`/radius/shadow classes
>   migrated; contrast asserted by `tests/config/design-tokens.test.ts` (text ≥ 4.5:1, control
>   boundary and focus ≥ 3:1) (ARCHITECTURE.md §13.2).
> - **Typography** — four self-hosted OFL faces (Newsreader, Instrument Sans, Gulzar Nastaliq, Noto
>   Naskh Arabic) through `next/font/local` in one module, Latin preloaded, Arabic-script not,
>   enforced by `tests/config/fonts.test.ts`; CSP `font-src 'self'` unchanged (ARCHITECTURE.md
>   §13.3; TECH_STACK.md §18.9).
> - **Unprefixed English URLs** — `/en` and `/en/…` one 301 to the unprefixed address (query
>   preserved, merged with slug history); `localePrefix: 'as-needed'`, no locale detection, no
>   locale cookie; every localised path built by `localizedPath` / parsed by `splitLocalePath`
>   (`packages/contracts/src/locale-path.ts`), ~850 hand-built `/${locale}` constructions
>   centralised; the language switcher as plain links; route-scoped headers by `inEveryLocale`;
>   sign-in `returnTo` canonicalised; `icon.png` excluded from the proxy matcher (ROUTE_MAP.md §1.1,
>   §1.3, §4, §9, §10).
> - **Content-aware shell** — a pure presentation policy (`apps/web/src/shell/presence.ts`) over a
>   per-request, fail-closed public evidence snapshot (`apps/web/src/composition/presence.ts`):
>   at most six promoted destinations plus "More", Donate only while giving is open, a three-group
>   footer, legal links only for published legal Pages, `/explore` listing only published pages; the
>   registry's `placements`, `shell/menus.ts` and `components/shell/menu-panel.tsx` removed; the
>   public layout and `/explore` declared content routes (INFORMATION_ARCHITECTURE.md §2–§4;
>   ARCHITECTURE.md §8.3.1.1). The admin Navigation status page's Placement column became a
>   Promotion column (ROUTE_MAP.md §5.1).
> - **One product frame** — a shared ProductBar on My Minhaj, Teacher, Admin (`WorkspaceShell`)
>   and a new identity layout; "<page> · <Area> · One Minhaj" titles; explicit `noindex`; the
>   private read `/api/my/account-state` (`{ signedIn }` only) for the header's account island
>   (INFORMATION_ARCHITECTURE.md §5; SECURITY_BASELINE.md §19.1.2).
> - **Probes moved off `/en`** — the staging edge smoke and edge-credential rotation probe `/`,
>   `/signin`, `/my`, `/admin`, `/admin/migration`; `scripts/staging-edge-proof.sh` probes `/` and
>   `/explore?x=1`; the CI proxy proof and the staging-deploy verify probe `/`.
>
> **Intentionally NOT in R1:** the home and landing-page redesign (R2; the home body's own hero
> line is left for it), media-player redesign, the My Minhaj / Teacher / Admin workflow redesign
> (R3/R4), Stage 1B, Phases 31–35, production cutover, any schema change and any official adoption
> claim. *(The "(R2)" / "(R3/R4)" split is historical, superseded by the owner's R2 scope decision
> of 2026-11-06 — OPEN_DECISIONS.md §8: R2 covers every public, My Minhaj, Teacher and Admin
> surface, and the media-player redesign, in one macro; see the Rebaseline R2 record below.)*
>
> **Readiness vocabulary (owner-approved).** Readiness is never reported as a bare "complete". It
> is reported in six separate dimensions — **Engineering**, **Product**, **Content**, **Activation**,
> **Production** and **Flagship/presentation** — each stated on its own evidence, so that an
> engineering exit is never read as content, activation, production or presentation readiness.
>
> **Closure evidence (2026-11-06).** Branch `feature/rebaseline-r1-flagship-foundation` from main
> `0382218`: `46b68b8` (the macro), `3edbb93` (the English rewrite mark honoured only on its own
> `/en/…` re-entry — a Server Action's redirect target had answered 404 — and the header fitted at
> 320px), `3fb5863` (the staging deploy gate admits exactly `feature/phase-*` and
> `feature/rebaseline-*` heads, owner-approved, pinned by test). Runtime SHA `3fb5863`: CI run
> 42212656181, 5/5 green; staging deploy run 42215217113 (gate, images, deploy, public-edge
> verify) green — staging serves `3fb5863`. Staging acceptance: 126 loads (10 public and 4 private
> routes × en/ur/ar × 390/768/1440 px), all 200, no horizontal overflow, no broken image, no
> third-party request, titled; header bar Library · Watch · News · Collections · About, no Donate;
> Gulzar Nastaliq on Urdu headings, Naskh on Arabic; `/en…` and case variants one 301 with the
> query kept, `Accept-Language` never redirects, `/fr/…` 404, no public `Set-Cookie`. After the
> deployed runtime, two further commits change no runtime code — this record, and `c1dd042`, which
> makes the browser suite compare signed-in and signed-out documents from the same presence
> snapshot (CI run 42228320736 had caught two loads straddling a snapshot refresh) — so staging
> keeps serving `3fb5863` while `main` is fast-forwarded to the final branch head. No schema
> change (31 migrations).
>
> **Readiness after R1 (six dimensions).** Engineering — R1 contract delivered and CI-proven.
> Product — the shell, routing and identity foundation is in place; the home, landings, media
> player, My Minhaj and internal workflows are not yet redesigned (R2–R4). Content — unchanged
> (Stage 1A, 617 public records; Stage 1B not started). Activation — unchanged (religious corpora,
> giving, learning and messaging not activated). Production — not started (Phases 34–35).
> Flagship/presentation — improved but not yet presentation-ready; R2 is the next step.
> *(A snapshot at R1 exit; "R2–R4" there is superseded by the R2 scope decision — see below.)*

> **Rebaseline Program R2 — Full Ecosystem Completion (an OPERATIONAL macro, 2026-11-06 onward;
> owner-directed, not a canonical phase and not Phase 31).** Branch
> `feature/rebaseline-r2-full-ecosystem-completion` from main `1725be9`. It follows R1 and a
> competitor benchmark and ecosystem study of minhaj.org and its sister hosts (held outside the
> repository), and finishes the product's presentation across every surface on the real corpus.
> **Two schema migrations** — `20261106000001_r2_quran_reference_preview` and
> `20261107000000_r2_storage_derivatives` (**33 migrations**); one new runtime dependency, `sharp`
> 0.35.5 for Storage alone (TECH_STACK.md §18.10), and one development dependency,
> `@axe-core/playwright` 4.14.0, for the accessibility smoke (§18.11); public indexing still off; staging still
> pre-adoption.
>
> **Owner decisions (2026-11-06, Haseeb, project owner; OPEN_DECISIONS.md §8)** — each for
> pre-adoption staging only where so marked, none a decision of Minhaj-ul-Quran International:
>
> - **R2 scope** widens to every public, My Minhaj, Teacher and Admin surface, superseding the R1
>   record's R2/R3/R4 split.
> - **Grouped navigation** replaces R1's ranked bar of at most six (`PRIMARY_LIMIT`); presence still
>   hides genuinely empty destinations (INFORMATION_ARCHITECTURE.md §1.5, §2, §4).
> - **Comprehensive pre-adoption presentation corpus**
>   (`OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS`; OPEN_DECISIONS.md §3.9),
>   with §3.8 extended to all fourteen genuine curated archives.
> - **Quran staging reference preview** — the Tanzil Uthmani 1.1 text verbatim (CC BY 3.0) with
>   Irfan-ul-Quran, a labelled `reference` authority, gated and never indexable; production
>   unchanged (OPEN_DECISIONS.md §1.1–§1.2).
> - **Hadith:** external hadith corpora declined; the Hadith landing presents MQI's hadith works
>   (OPEN_DECISIONS.md §1.3). **Fatwa:** unchanged; the staged review set is widened (§1.4).
> - **Staging demonstration data** as operator-run environment data, never an application mode
>   (`OWNER-DECISION-2026-11-06-R2-STAGING-DEMO`; OPEN_DECISIONS.md §4.2).
> - **Staging host-issued step-up** (2026-11-09; `OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP`;
>   OPEN_DECISIONS.md §4.2) — the staging operator may issue the browser step-up's own grant from the
>   proven host; production keeps every confirmation unchanged (SECURITY_BASELINE.md §8.1).
>
> **Delivered:**
>
> - **Design system** — the shared primitives split into a catalogue under `components/ui`
>   (layout, composition, forms, data, feedback, cards, indicators, hero, link tabs, one `Pager`,
>   responsive image primitives — `ResponsiveImage`, `Cover`, `Poster`, `Portrait` — and an in-house
>   37-icon SVG set, no icon dependency), client islands kept in their own modules (`Dialog`/`Sheet`
>   on native `<dialog>`, ARIA `Tabs`, `Shelf`, `ConfirmAction`), a third elevation
>   (`--shadow-overlay`), the long-form reading scale and the Quran face, Scheherazade New 4.500,
>   for `.quran-text` and `.quran-name` only (ARCHITECTURE.md §13; TECH_STACK.md §18.9).
> - **Grouped shell** — six header groups with mega panels from a laptop up, a utility strip, a
>   search palette (Ctrl/⌘K, a real GET form), a modal Menu sheet below 1024 px, six footer
>   columns, the organisation's official channels and the Tanzil attribution while a reference
>   corpus is live; fourteen new presence signals; the admin Navigation page's Promotion column now
>   `always | signal | page` (INFORMATION_ARCHITECTURE.md §2, §4; ROUTE_MAP.md §7).
> - **Public page families** — the home page rebuilt from real modules; a cover-led Library with
>   `?sort=title|newest` and magazine issues by year; a poster-led Watch whose privacy facade now
>   plays on one press, `autoplay` delegated only on the two player routes (ARCHITECTURE.md §4.7.1);
>   News with `?lang` and the archive's `?type`; Collections with a cover mosaic and
>   `?order=curated|newest|oldest`; countries grouped by world region from their ISO code; a
>   narrative `/explore`; search facets for areas with content; the Hadith works landing; the calm
>   Fatwa page; content-language badges (ROUTE_MAP.md §3).
>   *Superseded in part 2026-11-08 by owner direction:* the features R2 had dropped from these
>   pages are back in R2's components — the home page's hero search, Explore link, Quran and Hadith
>   cards, areas, Explore sections, and its audio, Events, rulings, organisation and topics modules;
>   the full `/explore` index with every reserved page; the Quran landing's full-text search; the
>   Hadith landing's structure; the Library's resources link, Books entry, group intros, metadata
>   notice and per-shelf fail-closed reads; Watch's twelve-video grid and group intros; News'
>   Events and archive links and family cards; Collections' topic chips and kinds row; and Global's
>   always-present finder, data notice and `/global/countries?offset=` paging (ROUTE_MAP.md §3).
> - **Quran reference preview** — the `reference` authority and its database separation rules,
>   the two-condition deployment gate (`RELIGIOUS_REFERENCE_PREVIEW`, refused beside indexing), one
>   exhaustive mode posture table, the reference notice and "About this text" panel, the reader
>   (quick jump `/quran/read?q=`, presentation settings kept in the browser, copy with citation,
>   the Bismillah rule), the admin step-up panel, and the host-side import and translation commands
>   (`docker/staging/bin/quran-reference.sh`) — DOMAIN_MODEL.md §8.4; SECURITY_BASELINE.md §5.1.
> - **Image derivatives** — Storage's `AssetDerivative` and WebP widths 320/640/960/1440 rendered by a
>   fenced `sharp` decoder, served beside each of the six public picture routes under a
>   content-addressed `public, max-age=31536000, immutable` class, with `srcset` on pages and an
>   operator backfill (`docker/staging/bin/derivatives-backfill.sh`) — ARCHITECTURE.md §4.2;
>   SECURITY_BASELINE.md §10.10.
> - **My Minhaj** — its own frame and grouped, capability-aware navigation, a home overview of what to
>   resume and what is next, and an IANA time-zone picker (INFORMATION_ARCHITECTURE.md §5).
>   *Superseded in part 2026-11-08 by owner direction:* every section is listed and has its home
>   module for every account (honest empty / not-available states), the neighbour links between
>   Learning, Classes, Teachers and Messages and the Teacher home's full section list are back,
>   and a teaching or administrative authority holder is linked to `/teacher` / `/admin` from
>   Identity's live permission evaluation (INFORMATION_ARCHITECTURE.md §5; ROUTE_MAP.md §5–§6).
> - **Teacher** — a Monday-to-Sunday week (`?week=`), class stages, dialogs for "mark held" and
>   "cancel", a student directory, fixed page titles; attendance and "mark held" are refused
>   server-side before a class starts (Learning's `not-started`; DOMAIN_MODEL.md §13.5).
> - **Admin** — a queue-first dashboard from owner-supplied counts (Membership's open applications,
>   Donations' attention flags — counts, not audited accesses), area roots that open the first
>   permitted surface, one shared pager, confirmation dialogs (presentation only), audit filters by
>   action prefix, actor and date range, step-up resume with a purpose-bound return address
>   (SECURITY_BASELINE.md §8.1, §9.3), the Editorial queue's second-administrator approve-and-publish
>   (at most 25, both keys), and Migration's run-wide acts — approve a confirmed candidate set,
>   clear pictures by registered host after seeing each through the administrative preview, draft a
>   manifest of 100 — each still a person's audited decision per item (SECURITY_BASELINE.md §10.11).
> - **Migration corpus engineering** — 23 catalogued sources (five new keys), a soft `tid:N` identity
>   that never merges on its own, all fourteen curated archives, 39 countries, two more
>   organisational pages and eight Minhaj Books authors (MIGRATION_STRATEGY.md §19).
> - **Staging demonstration data** — `npm run staging:demo:{seed,status,reset}` behind
>   `docker/staging/bin/demo.sh`, a second operations composition root
>   (`apps/web/src/composition/staging-demo-runner.ts`), three synthetic `.invalid` personas, the
>   email transport refusing `.invalid` recipients (`reserved_domain`), and the provider simulator
>   in-process for fixture donations (OPEN_DECISIONS.md §4.2; SECURITY_BASELINE.md §21.5).
> - **Staging host-issued step-up** — `npm run staging:step-up:grant` behind
>   `docker/staging/bin/step-up.sh grant --account <id> --purpose <purpose> [--minutes <1-15>]`, a
>   further operations composition root (`apps/web/src/composition/staging-step-up-runner.ts`) and
>   Identity's `createHostStepUpService`: the same grant, bound to the account's latest live
>   session, refused unless the account is active, holds the purpose's permission, has a complete
>   second-factor posture and the deployment is declared non-indexable staging; at most 15 minutes;
>   audited as `identity.security.step-up-granted` marked host-issued; unreachable from any web
>   request path (`tests/architecture/staging-host-step-up.test.ts`; SECURITY_BASELINE.md §8.1).
> - **Staging host review of a completed run** — `npm run staging:migration:review` behind
>   `docker/staging/bin/migration-review.sh status|approve-run|rights|manifest|publish|editorial`,
>   the review tool `scripts/review/review-runtime.ts` and its operations composition root
>   (`apps/web/src/composition/staging-review-runner.ts`): the screens' own Migration and Editorial
>   services, every act a preview first and then confirmed over exactly the printed set,
>   publication only under a live `migration-publication` step-up, the Editorial approver never
>   the author, pictures decided public only on first-party Minhaj hosts with the R2 attestation
>   named; staging only, unreachable from any web request path (MIGRATION_STRATEGY.md §19.2;
>   `tests/migration/host-review*.test.ts`).
> - **CI** — a new "Authorisation catalogue proof (real SQL Server)" step in the Database foundation
>   job runs the Identity and Taxonomy authorisation suites against the live catalogue and fails if
>   any did not run (`scripts/assert-authorization-proofs.mjs`); both suites, stale since Phase
>   30-RD, are repaired.
> - **Quality gates** (the enterprise audit's finding that no visual, accessibility or performance
>   check existed) — an **accessibility smoke**, `tests/browser/accessibility.spec.ts`, runs
>   `@axe-core/playwright` 4.14.0 (a reviewed, exact-pinned development dependency; TECH_STACK.md
>   §18.11) over home, Quran, Library, Watch, News, Collections, Explore, search, sign-in and a
>   signed-in My Minhaj, in English and Urdu, at desktop and phone widths, against the WCAG 2.x A/AA
>   rules, failing on any `serious` or `critical` violation and annotating the rest; it runs in the
>   `Browser flows` CI job with the rest of `tests/browser`. **Visual snapshots**,
>   `tests/browser/visual.spec.ts` — `toHaveScreenshot` of the phone header, the footer's brand
>   column, the home and Library hero words, the search empty state and the Urdu sign-in form,
>   fonts settled and motion stopped — are Linux-only and opt-in (`MINHAJ_VISUAL_BASELINE`), with
>   the baseline procedure in the spec; they are not a gate until baselines are committed. A
>   **performance budget**, `npm run perf:budget` (`scripts/perf-budget.mjs`), loads a list of paths
>   cold on a deployed build under Lighthouse's mobile Slow 4G and a 4× CPU, reports LCP, CLS and
>   bytes transferred, and fails when a path's median exceeds LCP 2.5 s or CLS 0.1; Basic Auth comes
>   only from a netrc file and is never printed. It is run against staging by a person, not in CI.
>
> **Intentionally NOT in R2, deferred, and missing reads (recorded, not promised):** Stage 1B,
> Phases 31–35, production cutover and any official adoption claim; the hosts deferred by §3.9
> (minhajsisters.com, youth.com.pk, msmpakistan.org, research.com.pk, equranclass.com, itikaf.com,
> welfare.org.pk; minhajwelfare.org needs its own authorisation), a magazine-article kind, a
> Works↔author link and year archives (MIGRATION_STRATEGY.md §19); Quran recitation audio; any
> Hadith corpus or published Fatwa; catalogue-only Courses and date-only Events (no real source);
> search-result thumbnails and per-country news counts; in My Minhaj, cover pictures in saved
> targets, progress percentages, a learner's class resources, receipts, recommendations and
> notification kinds beyond Fatwa; in Teacher, a learner's last activity, server-side student
> search, per-Course past classes, CSV export, materials upload and recurring availability; the
> visual-snapshot comparison as a CI gate (the spec exists but skips until Linux baselines are
> committed and the `Browser flows` job sets `MINHAJ_VISUAL_BASELINE`); and the performance budget
> in CI (it measures a deployed build, so a person runs it against staging).
>
> **Operator steps on staging (each a person's act, none run by CI):** deploy and migrate; register
> the five new source keys under the §3.9 reference and run the corpus plan, approving, deciding
> pictures and publishing per run (MIGRATION_STRATEGY.md §19.1); a second administrator's custom
> role for the Quran import, its step-up, then `quran-reference.sh import --sha256 …` and, after the
> Irfan-ul-Quran runs, `quran-reference.sh translations`; `derivatives-backfill.sh`; and, after a
> `privilege-administration` step-up, `demo.sh seed`. Since 2026-11-09 each step-up named here may
> instead be issued on the host with `step-up.sh grant` for that administrator and purpose (the
> administrator signs in once first); the gates and the two-person rules are unchanged. The
> review and publication acts of each completed run may likewise be performed with
> `migration-review.sh` (MIGRATION_STRATEGY.md §19.2).
>
> #### Closure evidence
>
> *Recorded at closure* — CI, staging deployment, staging data runs and acceptance are added here
> when they exist.
>
> **Readiness after R2 (six dimensions), as of this record — each restated at closure on its
> evidence.** Engineering — the R2 contract is implemented; its CI and staging proof are the
> closure evidence above, and nothing is called green before them. Product — every public, My
> Minhaj, Teacher and Admin surface is redesigned on one system; the missing reads listed above
> remain. Content — Stage 1A's 617 public records until the §19.1 staging runs complete; Stage 1B
> not started; no religious corpus accepted (the Quran preview is labelled reference text, not
> accepted content). Activation — unchanged for the organisation: no approved religious corpus, no
> giving, learning or messaging activation beyond staging's demo `fixture` rows (OPEN_DECISIONS.md
> §4.2). Production — not started (Phases 34–35). Flagship/presentation — the full presentation
> layer exists for review on pre-adoption staging; its acceptance is the owner's review of the
> deployed build, not this record.

> **Quran Part 1 — the reading experience (owner direction 2026-11-09; on
> `feature/rebaseline-r2-full-ecosystem-completion`).** The owner directed that the Quran section be
> built part by part, "from A to Z, fully ready", in menu order; Part 1 is **Read Quran** — the
> reader entry, the Surah reading page, the Ayah page and the reader components they share
> (ROUTE_MAP.md §3.3; INFORMATION_ARCHITECTURE.md §3.2). The owner's four Quran content decisions of
> the same day are recorded in OPEN_DECISIONS.md §1.2 (staging only; the production gates of §1.1,
> §1.2 and §2.4 are unchanged). Delivered:
>
> - **Windows, not one document.** A Surah page renders one window of 40 ayat server-side (one read
>   per layer, no per-Ayah read); `?from=` opens the window holding an Ayah; the next window is a link
>   the reader island fetches and appends as the reader nears it. Every Ayah element is
>   `ayah-{surah}-{ayah}`; a fragment such as `/quran/surah/2#ayah-2-255` is landed by the island in
>   that Ayah's window. Corpus reads are **not cached**: the cost was the payload, not the bounded
>   reads, and a cache would need invalidation on activation and correction that the platform does
>   not have.
> - **Three reading modes over one document** — Translation, Reading (flowing Arabic, presentational
>   end marks, one button per Ayah opening its translation in a sheet) and Mushaf (grouped by the
>   source's pages) — and **`/quran/page/{n}`**, one mushaf page as text (no images), 404 outside the
>   corpus's recorded pages. `PublicAyah` now carries the stored `hizb` and `page`, and the public
>   reader answers `pageAyat` and `lastPage` (no schema change, no new index: one bounded scan of the
>   canonical table).
> - **Division markers** where a Juz, a hizb or a page begins, and sajdah ayat, from stored numbers
>   only; rub' al-hizb quarters are not stored apart from the text's own ۞ sign.
> - **A settings sheet** — mode, which of up to four rendered public translations show, stacked or
>   side by side, both sizes, line spacing — kept in `localStorage` and applied before the first
>   paint by a fixed inline boot script whose rules are proved equal to the TypeScript ones by test;
>   the no-JS GET form remains.
> - **Continue where you stopped**, on `/quran/read` and the landing: the signed-in person's own
>   position through a new data-minimal `GET /api/my/quran-position` (same-origin only, no query,
>   private and `no-store`), else the device's last place; `/quran/read` becomes a start page
>   (popular starting points as fixed citations offered only where the corpus holds them, the quick
>   jump with "page 50", the indexes). Save and note open the existing private island in place on
>   the Surah page (it records no history there).
> - **Surah header** with the Arabic and recorded names, count, revelation, Juz and page span and the
>   neighbouring Surahs; a skip link to the text; `aria-current="location"` on the read position;
>   no single-key shortcuts (they collide with screen-reader browse keys).
>
> **Proof:** unit tests for windows, fragments, divisions, starting points, preferences and the boot
> script's parity, the quick jump's pages and the private read's parsing
> (`tests/quran/reading-layout.test.ts`, `tests/quran/reader-surface.test.ts`); the browser journey
> (`tests/browser/quran.spec.ts`) gains a 45-Ayah fixture Surah with made-up hizb and page numbers
> and proves windows and deep links, the three modes, the page route's 200/404, settings across a
> reload, the continue card signed in and out with the private read's refusals, the start page's
> sameness signed in and out, no sideways scroll at 320 and 390 px in Urdu and Arabic in every mode,
> and an axe scan in every mode; `/quran/read` joins the accessibility smoke. *CI and staging
> evidence are recorded when they exist; nothing here is called green before them.*
>
> **Not in Part 1 (later parts of the same programme):** the Surah and Juz index redesigns, Quran
> search, the recitation player (each Ayah element is its seam: a stable id and `data-ayah`, and no
> placeholder control), the translations comparison page, tafsir, tajweed and the related views;
> more than four translations side by side (more are chosen one at a time through `?translation=`).

> **Quran Part 2 — the Surah index and the Surah display names (owner direction 2026-11-09; on
> `feature/rebaseline-r2-full-ecosystem-completion`).** Delivered (ROUTE_MAP.md §3.3; DOMAIN_MODEL.md
> §8.4; OPEN_DECISIONS.md §1.1):
>
> - **Names.** Migration `20261109000000_r2_quran_surah_meaning` (**34 migrations**) adds
>   `SurahName.meaning` — one nullable presentation column edited with the name on
>   `/admin/quran/surahs`. `quran-reference.sh names --sha256 <metadata hex> --operator <id>`
>   (`npm run quran:reference:names`) saves the Tanzil metadata's `tname` and `ename` verbatim as each
>   Surah's English name and meaning through Quran's administrative service, only when the file is
>   the one the reference corpus was registered with and its Arabic names are the corpus's; it keeps
>   an operator's name and is a no-op on a re-run. No Urdu or Arabic name is written (no lawful source
>   in the data); those interfaces show the source's Arabic name. Revelation order is not stored and
>   not offered.
> - **The index.** `/quran/surah` and the landing's Surah tab: one row per Surah (number, name and
>   meaning, ayat, revelation, Juz span, Arabic name in the Quran face that wraps instead of squeezing
>   the row), a filter by name in any script, meaning or number and four orders (number, grouped by
>   revelation place, longest, shortest) — a GET form without JavaScript, answered per keystroke with
>   it, the count announced in a status line — and Part 1's continue card above it. The quick jump
>   also resolves meanings and single-vowel spellings; the Surah header shows the meaning.
>
> **Proof:** `tests/quran/surah-index.test.ts` (filter, orders, address, Juz spans, display names);
> `tests/quran/tanzil-corpus.test.ts` (the names reader and its refusals); the SQL Server proofs
> `tests/quran/reference.integration.test.ts` (the names import end to end) and
> `tests/quran/persistence.integration.test.ts` (the meaning saved and refused empty); the migration
> rehearsal (`db:migrate:test`, column, CHECK and rollback); the browser journey
> (`tests/browser/quran.spec.ts`) gains the index's filter with and without script, its orders,
> Urdu and Arabic, 320 px and an axe scan. *CI and staging evidence are recorded when they exist.*

> **Quran Part 3 — the Juz index and the Juz reading page (owner direction 2026-11-09; on
> `feature/rebaseline-r2-full-ecosystem-completion`).** Delivered (ROUTE_MAP.md §3.3; DOMAIN_MODEL.md
> §8.4). **No migration, no import, no staging command**: everything is derived from the stored
> `juzNumber`, `hizb`, `page` and text.
>
> - **Juz identity without invented text.** Each Juz is shown by the opening words of its first Ayah —
>   its first three words cut verbatim from the stored text (a leading ۞ is not a word; a pause mark
>   between words stays) — with "Juz n", its range by citation and by its first and last Surahs'
>   display names, its pages and hizb. No Juz name list exists anywhere.
> - **The index** (`/quran/juz`, and the landing's Juz tab without the opening words — the landing
>   shows no verse): thirty cards in Part 2's styling, a filter
>   by number or by a hizb a Juz holds (GET without JavaScript, live with it, count announced), the
>   continue card above.
> - **The Juz page** reads one window per recorded hizb; a hizb over 100 ayat is read in parts that
>   break only between mushaf pages (`juzWindows`, pure). `?hizb=`/`?part=` name a window; the next
>   one is appended by Part 1's window loader (generalised from a Surah to a reading series), with the
>   reading frame, modes, settings, markers, anchors, Surah headings and Bismillah rule of Part 1
>   shared rather than copied (the mushaf page and the Juz page now render Surah runs through one
>   component). An "In this Juz" navigation lists its hizb starts and Surahs; the header names where
>   it begins and ends; the Juz before and after close the page; the window's position is in words
>   and the island's progress line runs through the whole Juz. The arbitrary 100-ayah `?offset=`
>   paging is gone (an old address opens the first window).
> - **The quick jump** also opens "hizb 30" in its Juz.
> - **Quarters (rub' al-hizb) are not stored or navigated** — the reason is recorded in
>   DOMAIN_MODEL.md §8.4 (canonical structure, and Tanzil's text and metadata disagree on one quarter).
>
> **Proof:** `tests/quran/juz-layout.test.ts` (the opening-words rule, windows and their balance,
> addresses, the index filter, the quick jump's hizb); `tests/quran/persistence.integration.test.ts`
> (the derived Juz fields, the outline and the bounded window read on SQL Server); the browser
> journey (`tests/browser/quran.spec.ts`) gains the Juz index (verbatim opening words, ranges, the
> filter with and without script, the quick jump's hizb, Urdu and Arabic, 320 px, axe) and the Juz
> page (one window without script, the next appended with it, unique ids, contents, neighbours,
> unknown windows, Urdu and Arabic, 320 px, axe). *CI and staging evidence are recorded when they
> exist.*

> **Quran Part 4 — search (owner direction 2026-11-09; on
> `feature/rebaseline-r2-full-ecosystem-completion`).** Delivered (ROUTE_MAP.md §3.3; DOMAIN_MODEL.md
> §8.4; ARCHITECTURE.md §4.3; TECH_STACK.md §10). **No migration, no import, no new source**; the
> derived index must be **rebuilt** once the release is deployed, because every Arabic-script
> document's matching copy changes.
>
> - **Arabic typed in ordinary spelling finds the Uthmani text — by folding the index, never the
>   text.** Option (i), importing Tanzil Simple-Clean as a search-only companion, was weighed and
>   not taken (a new Quran table, a second registered import and alignment proof, and nothing for
>   the fixture or a future approved corpus); option (ii) is delivered: Search's one matching fold
>   (`@minhaj/contracts/search`, `fold.ts`) now unifies the Arabic-script letters ordinary typing
>   writes interchangeably, and an indexed text also carries the words its Uthmani marks spell. It
>   applies to every kind, so the Phase-17 Urdu/Arabic yeh limitation is resolved too. Measured on the
>   full Tanzil Uthmani 1.1 text against Simple-Clean as the yardstick: 99.5 % of ordinary-spelling
>   words found in their own Ayah's indexed copy (68.3 % before). The hamza on the line stays a
>   letter (dropping it broke the Arabic breaker's `قراء`/`للقراء` match, measured).
> - **Citation and name detection.** Part 1's quick jump gains "Surah 18", "surah 2:255" and a name
>   with an Ayah number ("Al-Baqarah 255", "البقرة ٢٥٥"), and a WHOLE-name mode for the search page;
>   a query that names a place is offered first ("Go straight there"), text matches beneath.
> - **Filters** — Surah, Juz and text language (the Arabic, or each language of the public
>   translations and transliterations, naming their works) — as GET parameters, no-JS first, refused
>   in words when the reader does not hold them, with chips, "Clear all filters", a stated count and
>   paging that keeps them. Surah and Juz become Search's new server-side restriction
>   (`within`, at most 1,000 identifiers, built from the reader's counts and ranges), which lifts the
>   per-breaker ranking cap for that query so a frequent word is never cut off before the filter.
> - **Results**: Surah display name and citation, the Arabic in the Quran face with the typed words
>   marked in place (a fold-aware, whole-word highlighter, segments cut from the original text), the
>   matching translation snippets in their own languages, "Open the Ayah" and "Read in its Surah";
>   suggestions when nothing matches.
>
> **Proof:** `tests/search/text.test.ts` (the fold, Uthmani-orthography words typed plainly),
> `tests/search/highlight.test.ts`, `tests/search/service.test.ts` (the restriction),
> `tests/quran/search-view.test.ts` (filters, restriction, layers, snippets, citation and name
> detection), `tests/quran/search-projection.test.ts`; on real SQL Server FTS
> `tests/search/quran.integration.test.ts` (plain typing finds a neutral Uthmani-orthography
> fixture phrase; the restriction) and `tests/search/search.integration.test.ts` (the yeh fold); the
> browser journey (`tests/browser/quran.spec.ts`) gains plain-typed Arabic, the citation and name
> card, the filters without script, Urdu and Arabic, 320 px and axe. **Staging:** deploy, then
> rebuild the index from `/admin/system/search` ("Rebuild", `search.operate`); the web service's
> sweep works it through. *CI and staging evidence are recorded when they exist.*

> **Quran Part 5 — recitations (owner decisions 2026-11-09, OPEN_DECISIONS.md §1.2 item 1; on
> `feature/rebaseline-r2-full-ecosystem-completion`).** Delivered (DOMAIN_MODEL.md §8.5; ROUTE_MAP.md
> §3.3, §7; SECURITY_BASELINE.md §5.1, §16.2; ARCHITECTURE.md staging operations):
>
> - **Data.** Migration `20261109120000_r2_quran_recitation_timing` (**35 migrations**, with its
>   rollback): `QuranRecitation.languageCode` (→ `Language`), `streamProvider` + `streamPath` (an
>   allowlisted provider and CDN folder, never a URL; `QuranRecitation_stream_ck`), and
>   `QuranRecitationTiming` (`[startMs, endMs)` per Ayah of a segment, `QuranRecitationTiming_ck`).
>   Refusals 51400 (a stream is fixed at creation), 51401 (a stream names a `reference` source only;
>   a streamed segment is one whole Surah with no file) and 51402 (timing for every Ayah or none, in
>   range, monotonic, never edited); the two 51188 "published recitation has audio" triggers count a
>   streamed segment as audio. Grants: the runtime may SELECT, INSERT and DELETE timings only, and
>   may not UPDATE a stream. `RECITATION_UPLOAD_MAX_BYTES` stays 64 MiB (the narration's largest file,
>   Al-Baqarah, is 49,161,152 bytes; ClamAV's stream limit is 100 MiB).
> - **The player.** One persistent dock, mounted by the new Quran layout, that keeps playing across
>   client navigations within `/quran/**`: play and pause, the recitation choice (remembered), Play
>   from any Ayah, continuous play across ayat, segments and into the next Surah (the page follows
>   from that Surah's own page), follow-along highlight and scrolling (reduced motion and the
>   visitor's own scrolling respected; a toggle), repeat each Ayah 1–10 times, a repeated range N
>   times or until stopped, speed 0.75–1.5×, a seek bar with a tick at each Ayah, Space/K/J/L only
>   inside the dock, the Media Session (Surah, Ayah, reciter; lock-screen controls), loading,
>   buffering and failure in words, Urdu and Arabic right to left, 320 px. Its one audio element is
>   made by the press and never in the document; nothing plays or loads before. An untimed
>   recitation plays whole Surahs and says highlighting is unavailable. Pure rules in
>   `components/quran/recitation-plan.ts`; data from `GET /api/quran/recitations/{slug}/{surah}`.
> - **Pages.** Surah, Juz and Ayah pages gain a Listen section with an honest no-JavaScript fallback
>   (links to `?reciter=`, whose segments are native `<audio controls>`); `/quran/recitations` cards
>   (language, style, timed or whole-Surah, Surah count, Play) with a GET filter by style and
>   language; the reciter page lists Surahs with Play and "Read and listen".
> - **Administration.** `/admin/quran/recitations` records the language, shows the audio source
>   (uploaded or streamed, the folder read-only) and each segment's timing coverage; no URL field
>   exists, and a streamed recitation offers no upload.
> - **Security.** The Quran routes alone add `media-src 'self' https://cdn.mp3quran.net` and
>   `autoplay=(self)`; no third-party script; the referrer policy is unchanged (origin only).
> - **Imports (staging operator commands, in the `ingest` container).** `quran-reference.sh
>   recitations-mp3quran --operator <id>` (`quran.read`, `quran.administer`, `people.administer`):
>   the twelve curated Ayah-timed Hafs reads streamed, each reciter a People Person, a Surah whose
>   timing does not fit skipped and reported. `quran-reference.sh recitations-irfan-urdu --operator
>   <id>`: the narration archive downloaded once (exact 687,598,353 bytes, SHA-256 recorded in its
>   provenance), each of its 114 `NNN. Name.mp3` members verified and stored through Storage, one
>   untimed segment per Surah. Both are resumable and idempotent and print counts only. Run them
>   after `import` and `translations`; deploy first (the migration is in the release).
>
> **Proof:** `tests/quran/recitation-rules.test.ts` (timing rule, stream allowlist and address),
> `tests/quran/recitation-plan.test.ts` (the player's state machine and response reading),
> `tests/quran/mp3quran.test.ts` (read planning, timing reading, the polite fetch),
> `tests/quran/zip-archive.test.ts`, the safe-download block of
> `tests/migration/tooling/safe-fetch.test.ts`; on SQL Server
> `tests/quran/persistence.integration.test.ts` (timing, streams, language) and
> `tests/quran/recitations-import.integration.test.ts` (both imports end to end with stubbed fetch,
> a stand-in scanner where ClamAV is not running); the migration rehearsal (`db:migrate:test`,
> trigger and grant proofs, rollback), `db:test:permissions` and the populated restore proof; the
> browser journey (`tests/browser/quran.spec.ts`) gains a timed first-party fixture and an untimed
> one: nothing before the press, Play from an Ayah, the highlight moving, playing across a client
> navigation, close, repeat, range, speed and the dock's keys remembered, the untimed note, Urdu and
> Arabic, 320 px, axe, the catalogue filter and the reciter page, and the no-JavaScript fallback.
> *CI and staging evidence are recorded when they exist.*

> **Quran Part 6 — translations and the translator's notes (owner direction 2026-11-10; on
> `feature/rebaseline-r2-full-ecosystem-completion`).** Delivered (DOMAIN_MODEL.md §8.6; ROUTE_MAP.md
> §3.3, §7; MIGRATION_STRATEGY.md §19, parser version 3; SECURITY_BASELINE.md §5.1):
>
> - **Data.** Migration `20261110000000_r2_quran_translation_notes` (**36 migrations**, with its
>   rollback): `QuranTranslationNote` (a translation text's notes in order — the marker as written
>   and the note's words), a typed composite key to its `QuranTranslationText` row,
>   `QuranTranslationNote_ck` (ordinal 1–20, non-empty, 20,000 units) and `_marker_ck` (none, a run
>   of one to four stars with an optional ":", or "n:-"), trigger 51403 (written once; no gap).
>   Grants: SELECT, INSERT and DELETE only. Restore proof: 44 CHECKs, 44 foreign keys, 29 triggers.
> - **The rule.** `tieTranslationNotes` ties each note to a mark of its text — numbered entries to
>   "(1)" … "(m)", star notes to star runs of their own length in order, a star note on a text with no
>   star mark to the Ayah, an unmarked note (the only one) to the one mark — and the service refuses
>   anything else (`note-untied`), the notes an Ayah keeps under a new text included.
> - **Migration.** The Irfan-ul-Quran parser, version 3, reads the notes verbatim (Urdu from the
>   later `h2.ur`, English from `p.en`; numbered notes split at their entries; paragraphs kept) with
>   per-language strictness; proved on all 114 surveyed surahs of both sources (46 Urdu and 134
>   English notes, every one tied). The staged payload carries `notes` (`null` from an earlier
>   parser); `quran-reference.sh translations` saves texts and notes together, idempotently.
> - **Reader.** Each answered mark is a link to its note (the mark, exactly as written, is the link);
>   the notes follow the work's attribution in a native disclosure, in the translation's own language
>   and direction; a mark opens its note in a dialog; the settings offer "Show under every Ayah"
>   (remembered, applied before the first paint); without JavaScript a mark jumps to its note.
> - **Pages.** `/quran/translations` (each work's language, People, attribution, counted coverage
>   and notes, Read and Compare), `/quran/translations/{slug}` (the work's record and every Surah's
>   coverage and notes, linked to the reader), and `/quran/translations/compare?surah=&ayah=` (the
>   Arabic once and every public translation with its notes; a GET form and neighbour links; a
>   missing Ayah said). `compare` is reserved from translation slugs.
> - **Administration.** `/admin/quran/translations/{id}?surah=` edits each Ayah's notes beside its
>   text (a marker and a textarea per note, one slot to add), under the same authority, version and
>   audit; read-only to `quran.read`.
> - **Search.** Notes are indexed as `note` layers of their work — after every text of their
>   language, never a summary — and a result shows a note only where the typed words mark it,
>   labelled as the translator's note.
>
> **Operator steps on staging** (after deploying the release that carries the migration):
> `migration-run.sh run --source irfan-ul-quran-ur --operator <adminId> --pages 1 --limit 114
> --items 1,2,…,114 --replay` and the same for `irfan-ul-quran-en` (every surah re-staged by parser
> version 3 from its retained evidence; nothing is fetched), then `quran-reference.sh translations
> --operator <accountId>` (`migration.read`, `quran.read`, `quran.administer`).
>
> **Proof:** `tests/quran/translation-notes.test.ts` (the tie rule, the text cut at its marks, the
> rendered notes, compare and coverage rules, search), `tests/quran/service.test.ts` (tie refusals,
> kept notes, schema refusals, the reserved slug), `tests/quran/reader-surface.test.ts` (the notes
> preference and the boot script), `tests/migration/tooling/adapters/irfan-ul-quran.test.ts` (trimmed
> real rows: 9:29, 9:101, 24:35, 33:6, 33:37, 53:39, 4:34, 42:52, 108:1, and refusals),
> `tests/migration/kinds.test.ts`; on SQL Server `tests/quran/persistence.integration.test.ts`,
> `tests/quran/reference.integration.test.ts` (the import with notes, idempotent, null-notes
> revisions, untied refused), the migration rehearsal (`db:migrate:test`), `db:test:permissions` and
> the populated restore proof; the browser journey (`tests/browser/quran.spec.ts`): a mark opening
> its note, notes under every Ayah, an Ayah-level note, Urdu right to left, no script, the listing,
> a work's Surahs, the compare view and its form without script, the admin note refused then saved,
> 320 px and axe. *CI and staging evidence are recorded when they exist.*

> **Quran Part 7 — transliteration and word by word (owner decision 2026-11-09, OPEN_DECISIONS.md
> §1.2 item 3; on `feature/rebaseline-r2-full-ecosystem-completion`).** Delivered, **hidden until a
> lawful source is recorded** (DOMAIN_MODEL.md §8.7; ROUTE_MAP.md §3.3, §7). No data is imported,
> nothing is scraped, and nothing is derived from the Arabic:
>
> - **Data.** Migration `20261110120000_r2_quran_word_by_word` (**37 migrations**, with its
>   rollback): `QuranWordByWord` (a Translation-shaped layered work), `QuranWordByWordContributor`
>   (translator, editor) and `QuranWordByWordGloss` (one gloss per work, Surah, Ayah and word
>   position, typed to the canonical Ayah; position 1–999, one line of at most 200 units), refusal
>   51404 (a published work keeps a gloss). Grants: the work SELECT, INSERT, UPDATE (slug denied);
>   contributors SELECT, INSERT, DELETE; glosses SELECT, INSERT, UPDATE, DELETE (keys denied).
>   Restore proof: 48 CHECKs, 50 foreign keys, 31 triggers. Transliteration's model is unchanged.
> - **The rule.** `ayahWords` (`@minhaj/contracts/quran`) cuts an Ayah's stored text on whitespace,
>   verbatim; a run with no letter (a pause mark, ۞, ۩) belongs to the word before it — or, opening
>   the text, the word after it. The service refuses a gloss beyond its Ayah's words
>   (`word-outside-ayah`); the Juz opening words share the word rule.
> - **Reader.** A chosen transliteration sits between the Arabic and the translations in its own
>   language and direction; a chosen word-by-word work draws each glossed Ayah's words as units with
>   the gloss beneath, wrapping right to left. The settings sheet offers each (remembered, applied
>   before the first paint), the reading form chooses one without script (`?transliteration=`,
>   `?words=`), Translation mode only; Surah, Ayah, mushaf page and Juz alike; the compare view shows
>   every public transliteration under the Arabic. A translation, transliteration or notes block in
>   a script of the other direction now aligns to its own reading start (`me-auto`), so an Urdu
>   translation on an English page ends where the Arabic does.
> - **Pages.** `/quran/transliteration` and `/quran/word-by-word`: each work's language, scheme or
>   credited People, attribution, counted coverage (and words glossed), a sample and "Read with".
> - **Hidden until published.** While no work of a layer is public its route is a 404, and the Quran
>   menu (the presence snapshot's `quranTransliteration` / `quranWordByWord`, the one exception to
>   the unconditional navigation), the Quran landing, the reader's settings and form and the search
>   page's languages omit it; the hub's copy no longer names transliteration; a search result's
>   layer says "Translation" or "Transliteration" as it is.
> - **Administration.** `/admin/quran/word-by-word` (directory, create) and `/{id}` (lifecycle,
>   metadata and People, and a per-Surah gloss editor: each stored Arabic word beside a one-line
>   field), under `quran.administer` with the same audit as a Transliteration.
> - **Search.** A public transliteration is searchable and a withdrawn one is not (unchanged
>   projection); glosses are not indexed.
>
> **Proof:** `tests/quran/word-by-word.test.ts` (the segmentation on Uthmani-shaped synthetic text —
> pause marks, ۞, ۩, maddah letters, exact rejoining — the gloss schemas and the rendered layers),
> `tests/quran/service.test.ts` (authority, positions beyond the words, an Ayah outside the Surah,
> malformed glosses, publication), `tests/quran/reader-surface.test.ts` (the two preferences and the
> boot script), `tests/quran/presentation.test.ts` (`?words=`), `tests/shell/menus.test.ts` (the
> gated links); on SQL Server `tests/quran/persistence.integration.test.ts`, the migration rehearsal
> (`db:migrate:test`), `db:test:permissions` and the populated restore proof; the browser journey
> (`tests/browser/quran.spec.ts`): the hidden state (menu, settings and form without the layers, both
> routes 404), the published fixtures (transliteration line and word-by-word view, settings kept,
> Urdu and Arabic, 320 px, axe, the two listings, the admin gloss editor). *CI and staging evidence
> are recorded when they exist.*

> **Quran — more recitations and QuranEnc translations (owner direction 2026-11-10: "add recitation
> of Shaykh Mishary Rashid Al Afasy and some other famous qari's too. and add urdu translation of
> famous translators too. and also english translation."; on
> `feature/rebaseline-r2-full-ecosystem-completion`).** Staging only; the production gates of
> OPEN_DECISIONS.md §1.1, §1.2 and §2.4 are unchanged.
>
> - **More qaris** (OPEN_DECISIONS.md §1.2 item 1). The curated mp3quran reads grow from twelve to
>   **twenty-nine** (`CURATED_READS`, `scripts/quran/mp3quran.ts`), each re-verified against the live
>   timed-reads list by the importer as before: twelve more murattal and five **mujawwad** editions
>   (Maher Al Meaqli, Abdulbasit Abdulsamad, Mahmoud Khalil Al-Hussary, Mustafa Ismail, Mahmoud Ali
>   Albanna). A mujawwad read — whose timed-read riwayah is mp3quran's "المصحف المجود" — is admitted
>   only where its own Arabic moshaf says Hafs, and every read's Arabic moshaf must now say Hafs
>   (`riwayahOf`). A qari with two reads is one People Person (the reciter's CDN folder) with two
>   recitations, told apart by mp3quran's moshaf names.
> - **Finding a recitation among ~30.** One order (`recitationGroups`,
>   `apps/web/src/components/quran/recitation-plan.ts`) for the player's chooser, the catalogue and a
>   reciter's page: grouped by style — the most common first (Murattal, then the mujawwad editions),
>   styleless ones last — then by reciter in the interface language's collation. The chooser shows
>   each style as an `<optgroup>`; `/quran/recitations` (and `/listen/recitations`) a heading per
>   style with its count ("Other recitations" for those naming none); the player's default is the
>   first timed recitation in that order (none privileged).
> - **External reference translations** (OPEN_DECISIONS.md §1.2 item 5,
>   `OWNER-DECISION-2026-11-10-EXTERNAL-REFERENCE-TRANSLATIONS`; MIGRATION_STRATEGY.md §19). Four
>   review-only migration sources read QuranEnc.com's public API — Urdu Muhammad Ibrahim Junagarhi,
>   English Saheeh International, Rowwad Translation Center and Hilali-Khan — each pinned to the
>   edition checked on 2026-11-10 (a run is refused once QuranEnc lists another), translation and
>   footnotes verbatim. `quran-reference.sh translations` now imports every declared work
>   (`scripts/quran/translation-works.ts`): Irfan-ul-Quran's two first, then QuranEnc's four, each
>   with its own `reference` provenance source; a QuranEnc work's attribution names the publisher,
>   QuranEnc.com with its link, the VERSION its staged text is, and that it is an external reference
>   translation, not Minhaj-ul-Quran's; "About this text" lists every such work under that statement.
>   Other famous Urdu translations (Kanz-ul-Iman, Jalandhry, Maududi) have no lawful digital source
>   and are not added.
> - **Data.** Migration `20261110130000_r2_quran_bracketed_note_marks` (**38 migrations**, with its
>   rollback) replaces `QuranTranslationNote_marker_ck` with one that also admits a bracketed
>   footnote number "[1]"…"[9999]"; no table, column, grant or trigger changes. The tie rule
>   (`tieTranslationNotes`) ties each "[n]" to the text's one mark "[n]", in order; every earlier
>   shape's rule is unchanged. The staged `quran.translation` payload gains `edition`.
>   Migration `20261110140000_r2_migration_payload_ceiling` (**39 migrations**, with its rollback,
>   which refuses while a longer revision exists) raises the staged-payload ceiling from 200,000 to
>   **400,000** characters (`MIGRATION_LIMITS.payload`; `MigrationStagedRecord_ck` restated exactly
>   as Phase 30-RD with only that bound changed). Lead decision 2026-11-10: a translation's surah is
>   one indivisible source item and the Urdu Al-Baqarah with Junagarhi's notes stages 265,210
>   characters; splitting a surah would complicate every import, and 400,000 leaves about half again
>   as much room.
> - **Search.** The new works are indexed by the unchanged projection, like Irfan-ul-Quran's, once
>   published.
>
> **Operator steps on staging** (after deploying the release that carries the migration): register
> the four sources (`migration-run.sh register --source <key> --operator <adminId>
> --authorisation-reference OWNER-DECISION-2026-11-10-EXTERNAL-REFERENCE-TRANSLATIONS --authorised-on
> 2026-11-10 --activate`; each source's policy notes name QuranEnc's terms), run each (`migration-run.sh run
> --source <key> --operator <adminId> --pages 1 --limit 114 --items 1,2,…,114`), then
> `quran-reference.sh translations --operator <accountId>` and `quran-reference.sh
> recitations-mp3quran --operator <accountId>`.
>
> **Proof:** `tests/quran/mp3quran.test.ts` (the mujawwad and Hafs rule, one Person for two reads,
> the pinned list), `tests/quran/recitation-plan.test.ts` (the catalogue's order),
> `tests/migration/tooling/adapters/quranenc.test.ts` (trimmed real API answers: Surah 108 of each
> edition, the one-line, joint and unmarked footnote forms, discovery's edition check, robots and
> every refusal), `tests/quran/translation-works.test.ts` (the declared works, their provenance and
> catalogue registrations, Irfan-ul-Quran first, the attribution), `tests/quran/translation-notes.test.ts`
> (bracketed marks), `tests/migration/tooling/catalogue.test.ts`, `tests/migration/kinds.test.ts`;
> a one-off survey of all 456 QuranEnc surahs through the adapter and the normaliser (no failure, no
> issue, no personal-data finding, every note tied, every staged payload within the 400,000
> ceiling — the longest the Urdu Al-Baqarah's, 265,210); on SQL Server `tests/quran/reference.integration.test.ts`
> (every provenance source registered once, no work created without a revision, the QuranEnc import
> with its footnotes, another edition's revision refused, a new edition's version named),
> `tests/quran/recitations-import.integration.test.ts` and the migration rehearsal
> (`db:migrate:test`: the bracketed marker accepted and refused at its bounds, the rollback restoring
> Part 6's CHECK; the restated staged-revision CHECK exactly, a 300,000-character payload staged and
> a 400,001 one refused, the ceiling's rollback refused over the longer revision and, once rolled
> back, Phase 30-RD's CHECK restored). *CI and staging evidence are recorded when they exist.*

---

### Phase 31 — Search Completeness Validation
**Entry:** Phase 17, **Phase 30**, and every in-scope searchable domain complete.

> **Why Phase 30 is a prerequisite.** This phase re-validates tokenisation quality **against the
> full migrated corpus at real volume** — Phase 30's **Stage 1B**, not the Stage-1A review corpus. That corpus does not exist until initial migration has
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
>   legacy-301 acceptance criteria below require **Phase 30**. They acceptance-test the
>   **software redirect contract** — mapping to a single-hop 301 at the canonical target —
>   through controlled routes, fixtures or resolvers. **This phase does not claim that any legacy
>   host has been cut over**; serving legacy-domain 301s is Phase 35's (MIGRATION_STRATEGY.md §9.5).
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
valid with no over-claiming** · **the legacy-redirect contract correct with no chains, through
controlled routes or resolvers** · **WCAG 2.2 AA across
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
legacy hosting access arranged.** **Production promotion approver, cutover owner and rollback
owner named** (OPEN_DECISIONS.md §3.4). **Cutover rollback runbook written and rehearsed.**

**Deliverables:** Delta migration **with unchanged review requirements** · **promotion of the
accepted corpus from staging to production through the reviewed promotion manifest**
(MIGRATION_STRATEGY.md §10.1.1) · final URL mapping verification · **legacy-domain 301s
activated and served** — the first phase in which any legacy domain serves one
(MIGRATION_STRATEGY.md §9.5) · DNS and legacy-host cutover per organisational decision, verified
live afterwards · unmapped-URL logging · **the transition to
official-origin indexing** — `noindex` lifted, canonical URLs moved to the official origin and
sitemaps submitted **only at this point** (PRODUCT_SCOPE.md, *Product status and acceptance*) ·
post-launch monitoring.

> **The indexing transition is one server-only setting, and this is its name.** Phase 4 delivered
> the control as **`PUBLIC_INDEXING_ENABLED`**, which defaults to `false` and fails closed: while
> it is off, every page emits `noindex`, `robots.txt` disallows the whole site, no canonical or
> `hreflang` is emitted and the sitemap routes answer 404. Turning it on at the official origin —
> together with `AUTH_BASE_URL`, the single application origin canonical URLs are built from — is
> what performs this transition. **It is an environment and launch-state control, not a product
> mode**, and the application is not reduced in any way while it is off. The value is inlined
> into the build (`MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED`), so the transition is a deliberate
> rebuild and redeploy, not a runtime toggle — still true since Rebaseline R1 made the public
> layout render per request (ARCHITECTURE.md §8.3.1.1); at Phase-4 exit the reason given was that
> the public shell was statically rendered (historical).

> **Staging acceptance is not production promotion.** Promotion carries provenance, review
> integrity and checksums forward, and **excludes staging test accounts, known-password users,
> development credentials and unrelated staging configuration**. A defined source cutoff,
> protection of new production writes, and a named rollback owner are settled before cutover.

> **Launch scope is the approved in-scope phase set.** An explicitly approved deferral, such as
> Donations (Phase 27), is not a launch prerequisite and never becomes one by implication.

**Tests:** **Delta religious content reviewed to the same standard as initial content** ·
**legacy URLs 301 to correct canonical destinations with no chains, verified live on the legacy
domains after cutover** · unmapped URLs return the
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
5. **Documentation parity** — every canonical document **directly affected** by the work is
   current before closure (below)
6. Exit criteria explicitly verified, not assumed
7. Reviewer approval obtained
8. **The phase's gate status is stated honestly** (§3.1) — an engineering implementation exit
   is reported as exactly that, and never as content acceptance, activation or launch approval

**Phases 18, 19, 20 and 30 additionally require sign-off from Minhaj religious authority** for
the content they handle. That is not an engineering judgement and cannot be substituted by one.

### 5.1 Documentation parity — a standing rule

The ten documents in `/docs` are a **living system contract**, not a Phase-0A snapshot.

- **Every accepted implementation, security, dependency, infrastructure or operational change
  updates every directly affected canonical document in the same task or phase, before it
  closes** — a phase, a maintenance fix, a dependency patch or an incident closure alike.
- A correction found after a commit has been pushed is made in a **new normal commit**.
- **History is preserved by labelling it historical** — "at Phase-N exit", "historical,
  resolved" — never by leaving a false present-tense statement, and never by deleting useful
  evidence.
- Unrelated documents are not churned for style.
- **The repository, its tests, CI and runtime evidence outrank stale prose.** Where a document
  and the implementation disagree, the authoritative intent is investigated and reconciled —
  neither side is silently made to match the other.

---

## 6. Review and commit workflow

```
implement / document → reconcile directly affected canonical docs (§5.1) → inspect git diff
   → run required validation → review results → user / reviewer approval
   → commit ONLY when explicitly requested
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
| **Canonical documents drift from the delivered state** | The documentation-parity rule (§5.1): directly affected documents are reconciled in the same task, and historical snapshots are labelled as such |
| **Phase 30 stops part-way on a missing external decision** | Its gates are classified by timing (OPEN_DECISIONS.md §3.6); every decision a one-run Phase 30 needs — per-source authorisation, scope, rights, religious review and the `migration.publish` holder — is requested before it starts |
