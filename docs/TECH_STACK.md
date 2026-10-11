# Technology Stack — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit
**Document type:** Locked stack decisions. **No dependencies are installed in this phase.**

---

## 1. How to read this document

### 1.1 Version status

Every entry below is **LOCKED**. These are authoritative architecture decisions, not
provisional guesses.

The prior revision marked most versions "CONFIRM AT INSTALL" and permitted automatic
downgrade. Both are corrected: the versions are the authoritative stack, and **automatic
downgrade is prohibited**.

### 1.2 Compatibility verification remains mandatory — in the owning phase

Locking a version does not remove the obligation to verify that the locked combination
actually installs and builds together.

> **Compatibility is proven where a dependency is actually introduced, never in advance.**
>
> - **Phase 0B proves compatibility for the dependencies Phase 0B actually introduces.** It
>   makes no claim about a package it does not install.
> - **A deferred locked dependency is compatibility-validated in its owning phase**, at its
>   genuine first introduction (§1.5).
>
> Asserting that Phase 0B verified a dependency it never installed — a persistence layer, an
> authentication library — would be a claim without evidence.

> **If a locked package or version cannot be resolved, or proves incompatible during
> installation:**
>
> 1. **STOP.** Do not substitute a different version.
> 2. **Investigate** the actual cause — registry availability, peer conflict, platform
>    support, transitive constraint.
> 3. **Report the problem** with evidence.
> 4. **Require an explicit architecture decision** before any locked version is changed.

**There is no automatic fallback to "the nearest older stable release."** That policy could
silently change the baseline without anyone deciding to, which is precisely how an
architecture drifts away from its documentation.

### 1.3 Installation is conditional

**An approved stack choice does not mean the package is installed in Phase 0B.**

Feature-only dependencies are installed **in the phase that first genuinely uses them**:
Motion · React Hook Form · Tiptap · Playwright browser tooling · Socket.IO · Cheerio.

The technology remains locked and approved; installation is deferred to first real use. This
keeps the early dependency surface small and avoids carrying unused packages — and their
vulnerabilities — through phases that do not need them.

### 1.4 Role

| Role | Meaning |
|---|---|
| **Runtime** | Ships in the deployed application |
| **Development** | Builds and tests; does not ship |
| **Administration** | A workstation tool; **not an application dependency** |
| **Infrastructure** | Deployment and operations |

### 1.5 Where each deferred dependency is compatibility-validated

Validation happens **at genuine introduction**, in the phase that owns it
(DELIVERY_PLAN.md §2):

| Dependency | Introduced and validated in |
|---|---|
| Next.js · React · TypeScript · Tailwind · Zod · Pino · Vitest · ESLint · Prettier | **Phase 0B** — the dependencies 0B actually installs |
| **Prisma ORM · @prisma/client · @prisma/adapter-mssql** | **Phase 1** — the database foundation, where persistence first exists |
| **Better Auth 1.7.x** | **Phase 2** — the Identity phase, where authentication persistence first exists |
| **The privileged second-factor mechanism** (TOTP + recovery codes) | **Phase 2** — proven against the chosen Better Auth configuration, Prisma, SQL Server and the accepted Identity schema (SECURITY_BASELINE.md §8.2) |
| **Resend** — first `EmailProvider` adapter | **Phase 2**, where transactional mail first exists (ARCHITECTURE.md §4.6) |
| **next-intl 4.14.x** | **Phase 3A** — the Localisation Foundation, its owning point |
| **Playwright 1.55.x** | **Phase 2** — the first genuinely browser-critical phase (ARCHITECTURE.md §13.10) |
| **Socket.IO 4.8.3** | **Phase 25** — when the owning Messaging/realtime work introduces it |
| Motion · React Hook Form · Tiptap · Cheerio · shadcn/ui source | First genuine use, in the phase that needs them |

**The policy at every one of those points is identical** (§1.2, §16):

- **no prerelease substitution**
- **no automatic downgrade**
- **no speculative dependency installation**
- a discrepancy means **STOP → investigate → explicit architecture decision**

---

## 2. Locked stack — summary

| Technology | Version | Status | Role | Installed |
|---|---|---|---|---|
| Node.js | **24.20.0 LTS** | LOCKED | Runtime | Phase 0B |
| Next.js | **16.3.8** | LOCKED | Runtime | Phase 0B |
| React | **19.2.8** | LOCKED | Runtime | Phase 0B |
| TypeScript | **5.9.x** strict | LOCKED | Development | Phase 0B |
| Tailwind CSS | **4.3.3** | LOCKED | Runtime | Phase 0B |
| shadcn/ui | pinned CLI/source revision | LOCKED | Runtime (copied source) | On first component use |
| Motion | **13.1.x** | LOCKED | Runtime | **On first genuine use** |
| next-intl | **4.14.x** | LOCKED | Runtime | **Phase 3A — Localisation Foundation** |
| Microsoft SQL Server | **2022** | LOCKED | Infrastructure | Environment setup |
| SSMS | **22.9.1 GA** | LOCKED | **Administration** | **Not installed by this project** |
| Prisma ORM | **7.10.0** | LOCKED | Runtime | **Phase 1 — Database Foundation** |
| @prisma/client | **7.10.0** | LOCKED | Runtime | **Phase 1 — Database Foundation** |
| **@prisma/adapter-mssql** | **7.10.0** | LOCKED | Runtime | **Phase 1 — Database Foundation** |
| Better Auth | **1.7.x** | LOCKED | Runtime | **Phase 2 — Identity & Access** |
| **Resend** (first `EmailProvider` adapter) | **6.27.0** | LOCKED as the **first/development adapter**, behind the abstraction | Runtime | **Phase 2** |
| Zod | **4.5.x** | LOCKED | Runtime | Phase 0B |
| React Hook Form | **7.x** | LOCKED | Runtime | **When needed** |
| Tiptap | **3.x** | LOCKED | Runtime | **When needed** |
| Socket.IO | **4.8.3** | LOCKED | Runtime | **Phase 25 — realtime runtime** |
| Google Meet | — | LOCKED | Runtime (external) | Live class phase |
| YouTube / Vimeo embeds | — | LOCKED | Runtime (external) | Media phase |
| SQL Server Full-Text Search | — | LOCKED | Runtime | Search foundation phase |
| StorageService abstraction | — | LOCKED | Runtime | Storage foundation phase |
| Native `fetch` + Cheerio | current stable Cheerio | LOCKED | Development | Migration phase |
| Playwright | **1.55.x** | LOCKED | Development | **Phase 2 — first browser-critical phase** |
| Pino | **10.3.1** | LOCKED | Runtime | Phase 0B |
| Vitest | **4.1.x** | LOCKED | Development | Phase 0B |
| ESLint | **10.x** | LOCKED | Development | Phase 0B |
| Prettier | **3.x** | LOCKED | Development | Phase 0B |
| Docker / Compose | current stable | LOCKED | Infrastructure | Phase 0B (local) |
| NGINX | stable | LOCKED | Infrastructure | Deployment phase |
| Linux self-hosting | — | LOCKED | Infrastructure | Deployment phase |

**Ranges vs pins.** Where an `x` appears (TypeScript 5.9.x, Better Auth 1.7.x, Zod 4.5.x,
Motion 13.1.x, next-intl 4.14.x, React Hook Form 7.x, Tiptap 3.x, Playwright 1.55.x, Vitest
4.1.x, ESLint 10.x, Prettier 3.x), the **range is the locked architectural choice** and the
**exact resolved patch is recorded in the committed lockfile**.

---

## 3. Runtime

**Node.js 24.20.0 LTS** — LOCKED.

LTS is required for production: predictable security patching and a defined support window.
Node 24 provides native `fetch` (used by migration tooling), modern ECMAScript, and current
framework requirements.

The production runtime must match. **Odd-numbered Node releases are never used in
production.**

*Workstation note: the development machine currently reports Node v24.18.0. The locked target
is 24.20.0, and the workstation is aligned to it during Phase 0B setup.*

---

## 4. Web application

**Next.js 16.3.8** · **React 19.2.8** · **TypeScript 5.9.x strict** — all LOCKED.

> **Next.js moved from 16.3.3 to 16.3.8 as a security patch within the locked 16.3 line**
> (October 2026): advisories published after 16.3.3 was locked — among them a critical
> remote-code-execution defect in `next/og` (GHSA-vcvr-r3jv-pc5j) and cache-poisoning and
> image-optimisation SSRF defects — are fixed in 16.3.8, and the required `npm audit
> --audit-level=high` gate fails without it. No API, configuration or behaviour change was
> adopted; the flagged transitive packages moved only within their declared ranges.

**Why Next.js.** Server Components suit a content platform whose overwhelming majority of
pages are read-only and anonymously cacheable — most of the site ships no client JavaScript.
Streaming, image optimisation and Server Actions cover requirements that would otherwise be
assembled by hand. It self-hosts on Linux Docker with no platform lock-in.

**On internationalised routing.** The locale policy of ROUTE_MAP.md §1 is implemented by
**the application's routing layer together with next-intl** — always-present locale prefixes,
resolution rules, route-preserving locale switching and RTL handling. It is **not** a built-in
Next.js behaviour, and the rationale for choosing Next.js should not claim it is.

**Configuration:** App Router · Server Components by default · **TypeScript strict mode,
non-negotiable**.

**Constraint:** do not upgrade to TypeScript 6 or another newer major during this project
phase.

---

## 5. UI and styling

**Tailwind CSS 4.3.3** · **shadcn/ui** · **Motion 13.1.x** — LOCKED.

**Tailwind.** Consistent design tokens without stylesheet sprawl. Critically, its **logical
properties** (`ms-*`, `me-*`, `ps-*`, `pe-*`) make correct RTL a default rather than a
retrofit. **Physical direction utilities (`ml-*`, `pl-*`) are prohibited in layout code** —
they silently break RTL.

**shadcn/ui is copied source, not a conventional runtime dependency.** Components are
generated into the repository and then owned, versioned and modified like any other source
file — necessary for RTL correctness and Minhaj's visual identity. There is no floating
production package to upgrade.

> **The CLI and source revision used to generate components is recorded** at first use, so
> generated components are reproducible. "Current" is not a version.

**Motion** — installed **only when a purposeful animation genuinely exists**. **Reduced-motion
support is mandatory.** Decorative animation on religious content is inappropriate
(SECURITY_BASELINE.md §16.2).

---

## 6. Internationalisation

**next-intl 4.14.x** — LOCKED. Purpose-built for the App Router with Server Component support,
so translations do not force client rendering.

**Introduced and compatibility-validated in Phase 3A — Localisation Foundation** (§1.5), which
is delivered **before any phase required to serve en/ur/ar routes**, including the Phase 2
authentication surfaces. **There is exactly one localisation implementation.**

English, Urdu and Arabic supported architecturally from day one; RTL from the start; **one
codebase, one content database**. V1 may ship English content first.

**next-intl handles interface localisation.** **Content** translations are domain data
(DOMAIN_MODEL.md §19.1) and are not managed by this library. Conflating them is a common and
damaging error — and for Library, a **BookTranslation Edition is a genuine translated work**,
not a localized label (DOMAIN_MODEL.md §10.1).

---

## 7. Database and data access

### 7.1 The three-tool distinction

```
Application runtime:   Next.js / Node.js → context public service
                       → owning-context persistence port
                       → context-owned persistence adapter (inside packages/database)
                       → PRIVATE Prisma client → SQL Server 2022
Administration:        SSMS → SQL Server 2022
```

**Model A — encapsulated persistence through context-owned services** (ARCHITECTURE.md §3.1.1).
**Raw Prisma client construction is private infrastructure**, confined to `packages/database`;
a **persistence adapter physically implemented there is still semantically owned by its bounded
context**; and **no ordinary application package exposes a Prisma client, delegate, transaction
handle or raw-query facility in its public API** (ARCHITECTURE.md §4.1).

| Tool | What it is | Role |
|---|---|---|
| **Microsoft SQL Server 2022** | The database engine | Runtime |
| **Prisma ORM 7.10.0 + @prisma/adapter-mssql 7.10.0** | The application ORM and data-access layer | Runtime |
| **SSMS 22.9.1 GA** | Administration and inspection GUI | **Administration — not an application dependency** |

**Complementary. None replaces another.**

### 7.2 Microsoft SQL Server 2022 — LOCKED

Relational integrity for a heavily inter-referenced content graph · **Full-Text Search**
serving V1 search without new infrastructure · mature backup and administration tooling.

**Referential integrity is enforced by the database.** Polymorphic `targetType + targetId`
references are prohibited because SQL Server cannot enforce foreign keys from them
(DOMAIN_MODEL.md §6.2).

Local development targets **SQL Server 2022 Developer edition**. Hosting is an open decision.
**No production SQL Server is connected to in Phase 0A.**

### 7.3 Prisma — LOCKED

**Prisma ORM 7.10.0** · **@prisma/client 7.10.0** · **@prisma/adapter-mssql 7.10.0**.

The adapter is named explicitly. The prior revision recorded a generic "SQL Server
adapter/driver", leaving the supported database path ambiguous.

Type-safe access matching a strict TypeScript codebase · a schema reviewable in pull requests
· versioned migrations · parameterised queries by default.

**Constraint:** do not use Prisma 8 RC or preview.

**Rules:** Prisma is the **sole** application data-access path, confined to
`packages/database` and **never part of another package's public API** · schema changes flow
through **reviewed migrations**, never ad-hoc SSMS edits · the application account is
least-privilege with **no UPDATE or DELETE on audit tables** — and **the single application SQL
principal does not itself enforce bounded-context ownership, which is enforced by application
architecture, interfaces and tests** (ARCHITECTURE.md §4.1) · **`apps/realtime` never acquires
raw database capability** (ARCHITECTURE.md §3.1.2) · **administrative migration, provisioning
and recovery tooling is classified separately from runtime persistence adapters**.

**Introduced and compatibility-validated in Phase 1**, at its genuine introduction (§1.5).

### 7.4 SSMS 22.9.1 GA — LOCKED, Administration

**Used for:** inspecting databases and tables · diagnostic and manual T-SQL · index and
execution review · constraint inspection · authorised configuration · backup and restore
administration · controlled troubleshooting.

**SSMS is not:** ✘ an ORM · ✘ an application runtime dependency · ✘ a replacement for Prisma ·
✘ something the deployed application communicates through.

> **Phase 0A constraint: SSMS is not installed or configured.** It is a workstation
> administration tool, documented here only.

---

## 8. Authentication, validation, forms, editing

**Better Auth 1.7.x** — LOCKED, and **remains locked at the 1.7.x range**. The **range is the
architectural decision; the exact resolved patch is recorded in the committed lockfile** (§2,
§16.5) and is not selected here. Self-hosted, no external identity-service dependency or
per-user cost; data in the platform's own SQL Server; Google OAuth and email/password with
verification and reset; TypeScript-native.

**Introduced and compatibility-validated in Phase 2**, at its genuine introduction — **not in
Phase 0B, which does not install it** (§1.2, §1.5).

**Privileged multi-factor authentication is a Phase-2 compatibility gate of its own.** The
preferred V1 mechanism is **TOTP plus single-use recovery codes** for high-consequence
privileged capabilities (SECURITY_BASELINE.md §8.2), and it must be **proven** against the
chosen Better Auth 1.7.x configuration, Prisma 7.10.0, SQL Server and the accepted Identity
schema.

> **No Better Auth plugin, API, schema, session or recovery behaviour is asserted in advance of
> that proof.** If the mechanism cannot meet the required security properties without unsafe or
> custom divergence, **Phase 2 stops for an explicit architecture decision** (§1.2) rather than
> bending the security contract to fit the library. **General-user MFA is not mandatory in V1,
> and SMS MFA is not introduced by this baseline.**

**Boundary:** Better Auth handles authentication mechanics only, confined to the Identity &
Access adapter sub-layer. **Permissions are the single enforcement path**
(DOMAIN_MODEL.md §4.4); capability labels are derived projections, never stored booleans.

**Zod 4.5.x** — LOCKED. Every trust boundary — Server Actions, Route Handlers, socket events,
import pipeline, environment configuration validated at startup. Schemas shared via
`packages/contracts`, with **server-side validation always authoritative**.

**React Hook Form 7.x** — LOCKED, **installed when needed**. Only for complex multi-step or
highly interactive forms. **Not forced onto simple server forms**, better served by Server
Actions with progressive enhancement.

**Tiptap 3.x** — LOCKED, **installed when needed**. **Editorial content only.** **Religious
canonical texts require specialised structured editors with validation and mandatory review
workflows, never arbitrary WYSIWYG editing.** All editor output is sanitised server-side
before storage.

---

## 9. Realtime, live classes, video

**Socket.IO 4.8.3** — LOCKED, **introduced and compatibility-validated in Phase 25**, when the
owning Messaging/realtime work actually introduces it — not in Phase 0B (§1.5).

Runs in `apps/realtime`, which is created in the Messaging phase. **SQL Server is the
persistence layer**; the process transports and does not own data, reaching it only through
the Messaging-owned services hosted in `packages/server-core` (ARCHITECTURE.md §3.1).
**No Redis initially.**

**Google Meet** — LOCKED. V1 stores `meetingProvider` and `meetingUrl`, entered manually, with
provider/URL consistency and an **HTTPS `meet.google.com` allowlist** (SECURITY_BASELINE.md
§11). Automated provisioning deferred. **Class recording out of scope for V1.**
**Excluded:** Jitsi, custom WebRTC, Azure Communication Services.

**YouTube / Vimeo embeds** — LOCKED. Provider identifiers and metadata stored; provider player
embedded. **No custom video hosting.** CSP allowlists embed frame sources explicitly — only the
privacy-enhanced player origins, only on the routes that render the player (ARCHITECTURE.md
§4.7.1).

---

## 10. Search and storage

**SQL Server Full-Text Search** — LOCKED for V1, behind a **`SearchService` abstraction**.

No new infrastructure, no new operational burden, no additional failure mode.

> **Arabic and Urdu tokenisation quality under SQL Server FTS is an engineering validation
> risk**, proven with real content in the Search Foundation phase and re-validated as each
> domain adds its projection. It is a **technical acceptance criterion, not an external
> business decision** — the prior revision incorrectly referred it to OPEN_DECISIONS.md.

The abstraction exists precisely so this decision stays reversible.

> **Phase 17 — the engine and the tokenisation assessment, as measured.**
>
> **The engine.** The official `mcr.microsoft.com/mssql/server` images ship **without** the FTS
> component (`SERVERPROPERTY('IsFullTextInstalled') = 0`). `docker/sqlserver/Dockerfile` adds
> Microsoft's own `mssql-server-fts` package and nothing else, and pins **one engine build**:
> the base by digest (2022 CU26, 16.0.4265.3) and `mssql-server` and `mssql-server-fts` at
> `16.0.4265.3-1`. The floating `2022-latest` tag is gone: it had already moved past the build
> the persistent local volume runs, so local and CI were running different engines. Moving to
> a newer cumulative update is a deliberate edit of those pins, because an engine upgrade is
> one-way for the databases on a persistent volume. Local and CI both build this image through
> `docker/compose.yaml`; the migration refuses to run on an engine without FTS.
>
> **One column per word breaker.** Each search document's text is stored in exactly one of four
> columns, chosen by its text language: English (LCID 1033), Arabic (1025), Urdu (1056) and
> Neutral (0) for every other language. The catalogue is accent-insensitive and the index is
> built with `STOPLIST OFF`. Matching text — never displayed text — is folded identically at
> index and query time: NFC, Arabic-script harakat and Quranic annotation marks removed,
> ZWNJ/ZWJ and tatweel removed, lower-cased.
>
> **What was measured, with controlled non-religious fixtures** (library and reading-room prose;
> no Quran, Hadith or religious text), and is now a CI proof (`tests/search`):
>
> | Behaviour | Result |
> |---|---|
> | Arabic: definite article (`مكتبة` ↔ `المكتبة`), attached prepositions (`قراء` ↔ `للقراء`), ة/ه (`مكتبه`), harakat in text or query | **Matches — only under the Arabic breaker.** Every other breaker fails these, which is why Arabic text must be tokenised by it |
> | Urdu: whole words, plurals by prefix (`کتاب` → `کتابیں`), izafat (`تعلیم` ↔ `تعلیمِ`, after folding), ZWNJ compounds, loanwords (`لائبریری`), multi-term AND | **Matches** |
> | Urdu keheh/Arabic kaf (`کتاب` ↔ `كتاب`) | **Matches** (normalised by the engine) |
> | Urdu yeh typed as Arabic yeh (`نئی` ↔ `نئي`) | **Does not match — a known V1 limitation**, recorded here and asserted by the proof so a change is noticed |
> | English inflection (`library` ↔ `libraries`) and prefixes (`librar*`) | **Matches** |
> | Mixed script: Urdu or Arabic words inside an English document | **Matches** |
>
> **Conclusion: V1 quality is acceptable** for the initial inventory. No stemming exists for
> Urdu beyond prefix matching, and the yeh variant above is not folded; both are candidates for
> reconsideration if Phase 31's completeness validation against the migrated corpus shows them to
> matter. No search queries are recorded to find out — there is no search analytics. The
> abstraction keeps that reconsideration an adapter change.

**StorageService abstraction** — LOCKED. Local/company filesystem for V1; S3-compatible via
adapter later. **No Azure dependency.** **Large PDFs and video files are never database
BLOBs.** Untrusted uploads are **quarantined before publication**, with **malware scanning
part of the production security design** — **no scanner is selected or installed in Phase 0A**
(SECURITY_BASELINE.md §10).

---

## 11. Migration tooling

**Node.js native `fetch`** — LOCKED, built in.
**Cheerio** (current stable) — LOCKED, installed in the migration phase. Fast and sufficient
for the majority of legacy pages.
**Playwright 1.55.x** — LOCKED, **only where JavaScript rendering is genuinely required**.
Never the default; dramatically heavier and pointless against static markup. **It is introduced
and compatibility-validated in Phase 2** (§1.5), so by the time migration tooling needs it the
dependency already exists and is proven.

Rate limiting, **safe retry classification**, raw snapshot preservation, checksums, resumable
imports, **reconciliation** and **reversible publication** are required by the migration
design (MIGRATION_STRATEGY.md).

---

## 12. Logging, testing, linting

**Pino 10.3.1** — LOCKED. Structured JSON, low overhead, **logger-level redaction**.
Application logging is distinct from **domain audit** (SECURITY_BASELINE.md §13).

**Vitest 4.1.x** — LOCKED. **Do not jump to a newly released Vitest 5 during this project
foundation.**

**Playwright 1.55.x** for E2E — LOCKED, **introduced in Phase 2**. The same tool serves E2E and
migration, so one browser-automation dependency covers both. Phase 2 is where it genuinely earns
its place: real cookies, session transitions, CSRF and browser behaviour, sign-out, verification
and reset confirmation, authentication return paths, the Account & Security surface, and locale
and RTL flows (ARCHITECTURE.md §13.10). **It is not installed before that phase.**

**ESLint 10.x** · **Prettier 3.x** — LOCKED. ESLint additionally enforces **bounded-context
dependency rules** transcribed from DOMAIN_MODEL.md §3.1. **Architecture violations fail the
build**, and **the rules require no exceptions** — a rule needing an exception indicates a
wrong rule or a wrong design.

---

## 13. Deployment

**Linux host** · **Docker / Docker Compose** · **NGINX stable** · **self-hosted Node
applications** · **npm workspaces** · **GitHub Actions** — LOCKED.

**No Vercel. No Kubernetes. No Azure.**

**Turborepo is not adopted** — no demonstrated orchestration need; reconsider only if build
times measurably degrade.

---

## 14. AI

**V1:** a **deterministic, minimal "Minhaj Guide"** for site navigation, FAQ and search
assistance only. **No RAG. No AI agent.** No bounded context is reserved for it until it is
scheduled (DOMAIN_MODEL.md §1.1).

**Later:** RAG over approved, structured, reviewed content; controlled agent tools with
explicit authorisation boundaries.

> **Absolute constraint: no AI system may issue, draft, generate or publish a Fatwa, or
> generate any religious content.** Architectural, not configurable.

---

## 15. Technologies intentionally excluded

| Excluded | Reason |
|---|---|
| **Kubernetes** | Two processes on one host; complexity with no benefit at this scale |
| **Microservices** | The unified content graph requires joins and transactions |
| **Redis** | Not required for V1; **must not be added prematurely**. Rate limiting and realtime scaling use abstractions that permit a shared store later |
| **Redux / global state libraries** | Server Components, URL state and local React state suffice |
| **Turborepo** | No demonstrated orchestration need |
| **Vercel** | Self-hosted Linux Docker required; no platform lock-in |
| **Azure (all services)** | Explicitly excluded |
| **Azure Communication Services** | Google Meet meets the requirement |
| **Jitsi / custom WebRTC** | Self-hosting video infrastructure is a major programme with no justification |
| **Custom video hosting** | Provider embeds suffice; bandwidth and transcoding unjustifiable |
| **Dedicated search engine (V1)** | SQL Server FTS suffices; the abstraction keeps the path open |
| **Vector database** | No RAG in V1 |
| **Class recording** | Storage, consent, retention and privacy unresolved |
| **Separate codebases per language** | Prohibited; one locale-aware codebase |
| **Separate content databases per language** | Prohibited; translations are related rows |
| **Canary / beta / RC / preview / experimental packages** | Production platform; stability over novelty |
| **Prisma 8 RC/preview** | The 7.10.x line is the target |
| **TypeScript 6** | Not during this project phase |
| **Vitest 5** | Not during this project foundation |

---

## 16. Versioning policy

1. **Every version in §2 is a LOCKED architecture decision.**
2. **No automatic downgrade.** An unresolvable or incompatible locked version means **stop,
   investigate, report, and require an explicit architecture decision** (§1.2).
3. **Compatibility verification at installation is mandatory, in the phase that installs.**
   **Phase 0B tests the combination it actually introduces** — Next/React, Tailwind build
   integration, Zod, Pino, Vitest and the ESLint boundary configuration. **Deferred locked
   dependencies are validated at their genuine introduction** (§1.5): **Prisma + client + MSSQL
   adapter in Phase 1**, **Better Auth persistence in Phase 2**, **next-intl in Phase 3A**,
   **Playwright in Phase 2**, **Socket.IO in Phase 25**. Phase 0B claims nothing about a package
   it does not install.
4. **Installation is conditional** (§1.3). Approval is not installation.
5. **Ranges lock the architectural choice; the lockfile records the resolved patch.**
6. **Avoid canary, beta, RC, preview and experimental packages** unless a written architecture
   decision approves them.
7. **No opportunistic major upgrades during feature work.** An upgrade is its own task with
   its own testing.
8. **Lockfiles are committed and respected.**
9. **Security patches are the exception** — applied promptly, still reviewed and tested.
10. **shadcn/ui component generation records its CLI/source revision** (§5).

---

## 17. Summary — runtime vs development vs administration

### Runtime — ships in production
Node.js 24.20.0 · Next.js 16.3.8 · React 19.2.8 · Tailwind CSS 4.3.3 · shadcn/ui (copied
source) · Motion 13.1.x · next-intl 4.14.x · Prisma ORM 7.10.0 · @prisma/client 7.10.0 ·
**@prisma/adapter-mssql 7.10.0** · Better Auth 1.7.x · **Resend (first `EmailProvider`
adapter)** · Zod 4.5.x · React Hook Form 7.x · Tiptap 3.x · Socket.IO 4.8.3 · Pino 10.3.1
**Infrastructure:** Microsoft SQL Server 2022 · NGINX · Docker
**External services:** Google OAuth · Google Meet · YouTube / Vimeo

### Development — builds and tests, does not ship
TypeScript 5.9.x · Vitest 4.1.x · Playwright 1.55.x · ESLint 10.x · Prettier 3.x · Cheerio ·
npm workspaces · GitHub Actions

### Administration — workstation tools, NOT application dependencies
**SQL Server Management Studio 22.9.1 GA**

> The deployed application reaches SQL Server **through Prisma**.
> Developers and DBAs administer SQL Server **through SSMS**.
> **Separate paths. SSMS is never part of the application runtime.**

---

## 18. Licensing and provenance awareness

Licensing is recorded **at the moment something is introduced**, by the phase that introduces
it. Reconstructing it later, across a multilingual corpus with migrated assets, is far harder
than recording it once.

A lightweight inventory is maintained for: **runtime dependency licences** · relevant
**development dependency licences** · the **copied shadcn/ui source and its recorded CLI and
source revision** (§5) · **fonts**, including the Urdu and Arabic typefaces
(OPEN_DECISIONS.md §6.4) · **icon sets** · **stock images**, **illustrations**, **logos** and
**brand assets** · **external embeds** · **imported legacy assets**, which additionally carry
per-asset provenance (MIGRATION_STRATEGY.md §4.9) · **religious datasets** · and any other
copied or generated asset.

> **Public availability is not permission to redistribute or migrate.** That a file can be
> downloaded says nothing about whether this platform may host, republish or migrate it. The
> distinction matters most exactly where it is easiest to overlook: religious texts,
> translations, tafsir works and recitations (OPEN_DECISIONS.md §2.4).

> **Naming a font family is not shipping one, and the inventory records the difference.** Phase 4
> declares three semantic script slots — Latin, Urdu and Arabic — whose values are stacks of
> family NAMES ending in a generic family. Nothing is downloaded, nothing is bundled, no
> `@font-face` is declared and no network request is made, so no licence is acquired or
> required: a visitor sees a face only if their own system already has it. **The moment a font
> FILE enters this repository, or a remote font is requested at runtime, that is an
> introduction** and it carries a recorded licence — and, for the Urdu and Arabic typefaces,
> the accepted brand evidence of OPEN_DECISIONS.md §6.4 as well. Substituting the approved
> faces later is a change to those three token values.

**No enterprise SBOM programme is introduced**, and no speculative compliance bureaucracy. The
requirement is a maintained, honest inventory — proportionate to a platform that will hold
third-party scholarly material for a long time.

### 18.1 Phase-6 rich-text dependency inventory

| Direct dependency | Exact version | Use and provenance |
| --- | --- | --- |
| `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/static-renderer` | 3.31.3 each | MIT; [Tiptap source](https://github.com/ueberdosis/tiptap). StarterKit defines the shared schema, React/core/pm power the lazy editor, static-renderer produces authoritative server HTML. React 19 peer support and the locked Node 24 runtime are checked against installed manifests and the production build. |
| `sanitize-html` | 2.17.7 | MIT; [source](https://github.com/apostrophecms/sanitize-html). Server-only allowlist sanitisation after schema-validated rendering. |
| `@types/sanitize-html` | 2.16.1 | MIT; [DefinitelyTyped source](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/sanitize-html). Development-only type declarations. |

Only Article/Page authoring imports the Tiptap client island. The supported schema is bounded
paragraphs, headings 2–4, lists, quotations, emphasis/strike and HTTP(S) or internal links.
Images, embeds, raw HTML, scripts and custom styles are refused. Tiptap CSS injection and
unused cursor extensions are disabled; typography uses the shared stylesheet and tokens.
No font, icon, image, religious corpus or third-party content was introduced with this editor.

### 18.2 Phase-7 storage foundation inventory

| Tool | Exact version | Use and provenance |
| --- | --- | --- |
| ClamAV (`clamav/clamav`) | 1.5.2 | GPL-2.0; [Cisco Talos images](https://github.com/Cisco-Talos/clamav-docker), [engine source](https://github.com/Cisco-Talos/clamav). The malware scanner SECURITY_BASELINE.md §10.1 rule 4 requires and defers to "the phase that implements the storage foundation". Self-hosted, Linux, Docker Compose, no paid cloud service and no Azure dependency. Pinned to an exact version tag, never `latest`, matching the `node:24.20.0-bookworm-slim` precedent. |

**No new npm dependency was introduced.** The storage foundation uses Node built-ins —
`node:crypto` for SHA-256 and key generation, `node:fs` and `node:stream` for streaming, and
`node:net` for the scanner socket — plus the already-locked Zod for configuration.

**Content sniffing is a magic-number table, not a library.** The foundation recognises a small
closed set of formats and refuses everything else, so the detector is a reviewable table rather
than a general-purpose identifier. A dependency would earn its place if the requirement were
"identify anything"; it is the opposite. A later phase that genuinely needs deep format parsing
introduces one with its own evidence.

**`INSTREAM`, not a shared mount.** The application sends bytes to `clamd` over the socket, so
the scanner container is never given access to the storage volume. One fewer mount, and a
compromised scanner cannot reach the corpus.

**The storage volume is persistent state.** `minhaj-platform-storage-data` holds the
authoritative bytes of every stored asset — bytes no SQL Server backup contains. It is protected
from the moment it exists and is never a cleanup target; tests use disposable temporary roots.

### 18.3 Phase-17 search foundation inventory

| Tool | Exact version | Use and provenance |
| --- | --- | --- |
| SQL Server 2022 base image (`mcr.microsoft.com/mssql/server:2022-CU26-ubuntu-22.04`) | 16.0.4265.3, pinned by digest | Microsoft SQL Server 2022 licence, Developer edition for engineering use — the same engine and licence already locked in §2; only the pin changed, from the floating `2022-latest` to one build. |
| `mssql-server`, `mssql-server-fts` (Microsoft `mssql-server-2022` apt repository for Ubuntu 22.04) | 16.0.4265.3-1 | Components of SQL Server itself, distributed by Microsoft under the same SQL Server 2022 licence. `mssql-server-fts` adds Full-Text Search (§10); `mssql-server` is reinstalled at the identical build only because the FTS package depends on it and the base image does not register it with the package manager. Installed by `docker/sqlserver/Dockerfile`, whose build context holds that file alone. |

**No npm dependency, no external search engine, no vector store and no Redis were introduced.**
The `@minhaj/search` workspace uses Node's `node:crypto` for projection checksums and the
already-locked Zod through `@minhaj/contracts`. **No corpus or dataset was introduced**: the
tokenisation fixtures are short synthetic, non-religious sentences written for the proof.
