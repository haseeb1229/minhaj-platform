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

### 1.2 Compatibility verification remains mandatory

Locking a version does not remove the obligation to verify that the locked combination
actually installs and builds together.

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

---

## 2. Locked stack — summary

| Technology | Version | Status | Role | Installed |
|---|---|---|---|---|
| Node.js | **24.20.0 LTS** | LOCKED | Runtime | Phase 0B |
| Next.js | **16.3.3** | LOCKED | Runtime | Phase 0B |
| React | **19.2.8** | LOCKED | Runtime | Phase 0B |
| TypeScript | **5.9.x** strict | LOCKED | Development | Phase 0B |
| Tailwind CSS | **4.3.3** | LOCKED | Runtime | Phase 0B |
| shadcn/ui | pinned CLI/source revision | LOCKED | Runtime (copied source) | On first component use |
| Motion | **13.1.x** | LOCKED | Runtime | **On first genuine use** |
| next-intl | **4.14.x** | LOCKED | Runtime | Locale foundation phase |
| Microsoft SQL Server | **2022** | LOCKED | Infrastructure | Environment setup |
| SSMS | **22.9.1 GA** | LOCKED | **Administration** | **Not installed by this project** |
| Prisma ORM | **7.10.0** | LOCKED | Runtime | Database foundation phase |
| @prisma/client | **7.10.0** | LOCKED | Runtime | Database foundation phase |
| **@prisma/adapter-mssql** | **7.10.0** | LOCKED | Runtime | Database foundation phase |
| Better Auth | **1.7.x** | LOCKED | Runtime | Identity phase |
| Zod | **4.5.x** | LOCKED | Runtime | Phase 0B |
| React Hook Form | **7.x** | LOCKED | Runtime | **When needed** |
| Tiptap | **3.x** | LOCKED | Runtime | **When needed** |
| Socket.IO | **4.8.3** | LOCKED | Runtime | **When messaging is introduced** |
| Google Meet | — | LOCKED | Runtime (external) | Live class phase |
| YouTube / Vimeo embeds | — | LOCKED | Runtime (external) | Media phase |
| SQL Server Full-Text Search | — | LOCKED | Runtime | Search foundation phase |
| StorageService abstraction | — | LOCKED | Runtime | Storage foundation phase |
| Native `fetch` + Cheerio | current stable Cheerio | LOCKED | Development | Migration phase |
| Playwright | **1.55.x** | LOCKED | Development | **Only when required** |
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

**Next.js 16.3.3** · **React 19.2.8** · **TypeScript 5.9.x strict** — all LOCKED.

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
Application runtime:   Next.js / Node.js → context services → Prisma → SQL Server 2022
Administration:        SSMS → SQL Server 2022
```

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
`packages/database` · schema changes flow through **reviewed migrations**, never ad-hoc SSMS
edits · the application account is least-privilege with **no UPDATE or DELETE on audit
tables** · **`apps/realtime` never imports it** (ARCHITECTURE.md §3.1).

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

**Better Auth 1.7.x** — LOCKED. Self-hosted, no external identity-service dependency or
per-user cost; data in the platform's own SQL Server; Google OAuth and email/password with
verification and reset; TypeScript-native.

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

**Socket.IO 4.8.3** — LOCKED, **installed when messaging is introduced** — not in Phase 0B.

Runs in `apps/realtime`, which is created in the Messaging phase. **SQL Server is the
persistence layer**; the process transports and does not own data, reaching it only through
the Messaging-owned services hosted in `packages/server-core` (ARCHITECTURE.md §3.1).
**No Redis initially.**

**Google Meet** — LOCKED. V1 stores `meetingProvider` and `meetingUrl`, entered manually, with
provider/URL consistency and an **HTTPS `meet.google.com` allowlist** (SECURITY_BASELINE.md
§11). Automated provisioning deferred. **Class recording out of scope for V1.**
**Excluded:** Jitsi, custom WebRTC, Azure Communication Services.

**YouTube / Vimeo embeds** — LOCKED. Provider identifiers and metadata stored; provider player
embedded. **No custom video hosting.** CSP allowlists embed frame sources explicitly.

---

## 10. Search and storage

**SQL Server Full-Text Search** — LOCKED for V1, behind a **`SearchService` abstraction**.

No new infrastructure, no new operational burden, no additional failure mode.

> **Arabic and Urdu tokenisation quality under SQL Server FTS is an engineering validation
> risk**, proven with real content in the Search Foundation phase and re-validated as each
> domain adds its projection. It is a **technical acceptance criterion, not an external
> business decision** — the prior revision incorrectly referred it to OPEN_DECISIONS.md.

The abstraction exists precisely so this decision stays reversible.

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
Never the default; dramatically heavier and pointless against static markup.

Rate limiting, **safe retry classification**, raw snapshot preservation, checksums, resumable
imports, **reconciliation** and **reversible publication** are required by the migration
design (MIGRATION_STRATEGY.md).

---

## 12. Logging, testing, linting

**Pino 10.3.1** — LOCKED. Structured JSON, low overhead, **logger-level redaction**.
Application logging is distinct from **domain audit** (SECURITY_BASELINE.md §13).

**Vitest 4.1.x** — LOCKED. **Do not jump to a newly released Vitest 5 during this project
foundation.**

**Playwright 1.55.x** for E2E — LOCKED. The same tool serves migration and E2E, so one browser
automation dependency covers both. **Browser tooling is installed when first genuinely used.**

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
3. **Compatibility verification at installation is mandatory.** Phase 0B tests the locked
   combination — particularly Next/React, Prisma + client + MSSQL adapter, Better Auth
   persistence, Tailwind build integration, and ESLint boundary configuration.
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
Node.js 24.20.0 · Next.js 16.3.3 · React 19.2.8 · Tailwind CSS 4.3.3 · shadcn/ui (copied
source) · Motion 13.1.x · next-intl 4.14.x · Prisma ORM 7.10.0 · @prisma/client 7.10.0 ·
**@prisma/adapter-mssql 7.10.0** · Better Auth 1.7.x · Zod 4.5.x · React Hook Form 7.x ·
Tiptap 3.x · Socket.IO 4.8.3 · Pino 10.3.1
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
