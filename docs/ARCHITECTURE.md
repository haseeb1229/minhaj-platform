# Architecture — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit
**Document type:** Planning only. No code, no scaffolding, no dependencies.

---

## 1. Application topology

One web process at launch, one database, one shared codebase. A second realtime process is
introduced **only when Messaging is implemented** — not scaffolded in advance.

```
                         ┌──────────────────────┐
                         │      Visitors        │
                         │  en · ur · ar        │
                         └──────────┬───────────┘
                                    │ HTTPS
                         ┌──────────▼───────────┐
                         │        NGINX         │
                         │  TLS · reverse proxy │
                         │  coarse rate limit   │
                         │  static · WS upgrade │
                         └────┬────────────┬────┘
                              │            │
                   HTTP       │            │  WebSocket (Messaging phase onward)
              ┌───────────────▼──┐      ┌──▼──────────────────┐
              │   apps/web       │      │  apps/realtime      │
              │   Next.js 16     │      │  transport ·        │
              │   App Router     │      │  presence ·         │
              │   RSC default    │      │  event delivery     │
              │   Server Actions │      │  NO db access       │
              └────────┬─────────┘      └──────────┬──────────┘
                       │                           │
                       │   both consume ONLY ↓     │
              ┌────────▼───────────────────────────▼──────────┐
              │   packages/server-core                        │
              │   server-only HOST for context-owned services  │
              │   messaging · authorization · session          │
              │   (hosts implementations; owns no rules)       │
              └────────────────────┬──────────────────────────┘
                                   │
                      ┌────────────▼─────────────┐
                      │  packages/database       │
                      │  Prisma Client           │
                      └────────────┬─────────────┘
                                   │
                      ┌────────────▼─────────────┐
                      │  Microsoft SQL Server    │
                      │  2022 · relational + FTS │
                      └──────────────────────────┘

                      ┌──────────────────────────┐
                      │  Storage volume          │
                      │  (S3-compatible later)   │
                      └──────────────────────────┘

  External (referenced, not hosted): YouTube · Vimeo · Google OAuth · Google Meet
```

### 1.1 Why the realtime process exists at all

`apps/web` is stateless and request-scoped; it scales horizontally and restarts freely.
Long-lived WebSocket connections have a different lifecycle: a web deployment must not drop
every open conversation.

That difference in connection lifetime is the **sole** justification for the split, and it
is the only split in the system.

### 1.2 Why it is not created yet

A process that exists before the domain it serves inevitably accretes logic that belongs
elsewhere. `apps/realtime` is introduced in the Messaging phase, after the shared server
boundary below is built and proven — not in Phase 0B merely because it appears on a diagram.

---

## 2. Modular monolith — rationale

One deployable web application, internally divided into **16 bounded contexts**
(DOMAIN_MODEL.md §1) with enforced boundaries.

### 2.1 Why not microservices

| Consideration | Finding |
|---|---|
| Domain coupling | The core product value is the *unified content graph*. A topic page joins works, videos, articles, research, Fatawa, courses, audio and contributors. Distributed, this becomes network joins and consistency problems — solving with infrastructure what a database join solves for free. |
| Transactional integrity | Publishing a Fatwa updates the ruling, question status, topic assignments, audit log and search index. One database, one transaction. Across services: sagas and compensating actions, for religious content where correctness is non-negotiable. |
| Team size | Small team. Microservices turn every cross-domain change into multi-repository coordination. |
| Operational cost | Service discovery, distributed tracing and per-service CI/CD are permanent costs. Nothing requires scaling Library independently of Editorial. |
| Explicit exclusion | Kubernetes and microservices are excluded by requirement. |

### 2.2 What makes the boundaries real

A monolith is defensible only if its boundaries are enforced mechanically:

- Each context has an **explicit public interface**; internals are not importable.
- Cross-context access goes **through interfaces**, never another context's tables.
- Dependency direction is **enforced by lint rules that fail the build**.
- **The graph is acyclic and requires no ESLint exceptions** — see §6.
- Contexts are independently testable.
- Where a context ever needed extraction, its interface is already the seam.

---

## 3. The shared server boundary — how realtime works

The prior revision let `apps/realtime` consume `packages/database` directly and perform its
own conversation authorisation, while the owning Messaging context lived inside `apps/web`.
That made the realtime process a second business backend with divergent security
enforcement. Corrected as follows.

### 3.1 `packages/server-core` — a host, not an owner

`packages/server-core` is a **server-only physical hosting and export surface** for selected
server-side application services. It exists so that one implementation can be reached by two
processes.

> **`server-core` owns no business rules. The bounded contexts own them.**

The services hosted here **belong to** their bounded contexts — Identity & Access, Messaging,
Learning and others as applicable. Placing an implementation in this package changes **where
it is exported from**, never **who owns it**. The same Messaging authorisation implementation
is hosted here so both the web process and the future realtime transport call it, while
**Messaging remains its semantic owner** and the sole place its rules may change.

```
packages/server-core/
  messaging/      ← owned by the Messaging context
                    createMessage · listConversations · loadHistory
                    markRead · canAccessConversation · canSendTo
  authorization/  ← owned by Identity & Access
                    can(user, permission) · capability projections
  relationships/  ← owned by Learning
                    current assignment / enrolment checks
  session/        ← owned by Identity & Access
                    verifySession · resolveUser
```

**What `server-core` is not:**

- ✘ **Not a bounded context.** It has no domain language and no invariants of its own.
- ✘ **Not a second domain layer.** It adds no modelling tier above or below the contexts.
- ✘ **Not a god-package.** Code is hosted here only because two processes genuinely need it.
- ✘ **Not a home for unrelated business logic.** Anything needed by one process only stays in
  its context.
- ✘ **Not a route around boundaries.** It performs **no uncontrolled cross-context table
  access** and **never bypasses a bounded context's public interface**.
- ✘ **Never client-side.** It is **server-only** and **must never be imported into a client
  bundle** — enforced by lint.

**Rules:**

1. **`apps/realtime` never imports `packages/database`, Prisma, or any table access.**
   Enforced by lint; the build fails.
2. **`apps/realtime` never reimplements** authentication rules, permissions, conversation
   authorisation, or message mutation invariants.
3. **Messaging is the semantic owner** of conversations, participants, message creation,
   authorisation invariants, blocking, and assignment/enrolment checks — whether its services
   are called from `apps/web` or from `apps/realtime`.
4. **Each hosted service reaches data only through its owning context's interface**, exactly
   as it would if it were called from within `apps/web`.
5. Both processes call the **same functions**, so there is one implementation of each rule and
   no possibility of divergence.
6. **Admission is by justification.** A service belongs here only when a second process
   genuinely needs it. "Shared-looking" is not a reason.

### 3.2 Division of responsibility

| Concern | `apps/web` | `apps/realtime` |
|---|---|---|
| Page rendering | Yes | No |
| Server Actions / Route Handlers | Yes | No |
| Message **persistence** | via Messaging services | via the same Messaging services — **never directly** |
| Live delivery / fan-out | No | **Yes** |
| Presence | No | Yes — in-memory |
| Typing indicators | No | Yes — **ephemeral, never persisted** |
| Session verification | via Identity & Access services | via the same services — **same code** |
| Authorisation decisions | via Identity & Access services | via the same services — **same code** |
| Business rules | **owned by the bounded contexts**, invoked here | **none of its own** |
| Direct database access | via `packages/database` | **prohibited** |

### 3.3 The realtime process is an adapter

Its responsibilities are **transport, presence and event delivery**. When a message is sent it
calls the **Messaging services hosted in `server-core`**, which validate the current
relationship (DOMAIN_MODEL.md §15.3), enforce blocking, persist the message and return it. The
realtime process then fans it out to connected sockets. It decides nothing, and the decision
it defers to belongs to Messaging — not to the package the call happens to travel through.

### 3.4 Persistence rule

> **SQL Server is the source of truth. The realtime process transports; it does not own data.**

A message is durably persisted before broadcast. With the realtime process down, messaging
still works through the web application — delivery degrades from instant to on-refresh, and
**nothing is lost**. The process can be restarted or redeployed at any time.

### 3.5 No Redis initially

Socket.IO runs single-instance when introduced. Horizontally scaling the realtime tier would
require an adapter; that is accepted until measured volume justifies it, and is revisitable
without domain change. **The web tier scales horizontally regardless.**

---

## 4. Platform abstractions

Infrastructure is **not** a business domain (DOMAIN_MODEL.md §1.1). Each is consumed through
an interface, so no context depends on a vendor.

### 4.1 Database boundary

```
Next.js / Node.js  →  server-core  →  Prisma ORM  →  Microsoft SQL Server 2022
SSMS               →                                 Microsoft SQL Server 2022
```

- **Prisma ORM 7.10.0** with **`@prisma/adapter-mssql` 7.10.0** is the sole application
  data-access path, confined to `packages/database`.
- **SSMS 22.9.1 GA** is a **workstation administration tool** for inspection, diagnostic
  T-SQL, index and constraint review, authorised configuration, backup/restore and
  troubleshooting.
- **SSMS is not an ORM, not a runtime dependency, not a replacement for Prisma, and not
  something the deployed application communicates through.** The paths are complementary.
- Schema changes flow through **reviewed Prisma migrations** — never ad-hoc SSMS schema edits.
- **Referential integrity is enforced by the database.** Polymorphic `targetType + targetId`
  references are prohibited (DOMAIN_MODEL.md §6.2).
- Local development targets SQL Server 2022 **Developer edition**.

### 4.2 Storage

**StorageService** with adapters. V1 uses a local/company filesystem volume; S3-compatible
later. **No Azure dependency.** Large PDFs and video files are **never database BLOBs** —
references, metadata and checksums only. Untrusted uploads are **quarantined before
publication** (SECURITY_BASELINE.md §10).

### 4.3 Search

**SearchService** abstraction, implemented over **SQL Server Full-Text Search** for V1, so a
dedicated search or vector engine can arrive later without touching call sites.

**Arabic and Urdu tokenisation quality under SQL Server FTS is an engineering validation
risk**, proven with real content in the Search Foundation phase. It is a technical
acceptance criterion — **not an external business decision**.

### 4.4 Authentication and authorisation

**Better Auth 1.7.x** handles authentication mechanics, confined to the Identity & Access
context's adapter sub-layer.

**Permissions are the single enforcement path** (DOMAIN_MODEL.md §4.4). Capability labels
such as `canIssueFatwa` are **derived projections**, never independently stored booleans and
never an enforcement path. The internal User record is authoritative for application state.
**Google never creates a Minhaj email address.**

### 4.5 Rate limiting

A **RateLimiter abstraction**, not a mandated infrastructure dependency.

| Deployment stage | Strategy |
|---|---|
| Initial single-instance | NGINX coarse per-IP throttling **plus** process-level application limits for lower-risk flows |
| Before horizontal scaling, or where a security-critical flow needs cross-instance consistency | Introduce a shared limiter store/strategy behind the same abstraction |

**Redis is explicitly not required initially and must not be added prematurely.**

### 4.6 Email, logging, auditing

**EmailProvider** abstraction — no provider invented in Phase 0A. **Pino 10.3.1** structured
logging with **logger-level redaction**. **Audit** is durable domain data with the realistic
integrity baseline of SECURITY_BASELINE.md §13.

### 4.7 Integration abstractions

| Integration | V1 | Later |
|---|---|---|
| Live class | `MeetingProvider` storing provider + manually entered URL, with validation (DOMAIN_MODEL.md §13.1) | Google Calendar/Meet API provisioning |
| Video | `VideoProvider` — YouTube/Vimeo metadata and embed | Additional providers |
| Payment | `PaymentProvider` interface only | Provider selection is an open decision |
| Email | `EmailProvider` interface | Provider selection is an open decision |

---

## 5. Repository structure

```
minhaj-platform/
├── apps/
│   ├── web/                Next.js 16 application
│   └── realtime/           Introduced in the Messaging phase — NOT in Phase 0B
├── packages/
│   ├── server-core/        Server-only HOST for selected context-owned services
│   │                    (owns nothing; never in a client bundle)
│   ├── database/           Prisma schema, client, migrations, seed
│   ├── contracts/          Shared types and Zod schemas
│   ├── ui/                 Only if genuinely shared
│   └── config/             Shared ESLint, TypeScript, Prettier config
├── scripts/
│   └── migration/          Source-adapter executables and tooling
├── docs/
├── docker/
└── .github/workflows/
```

A **simple npm workspace** monorepo. **Turborepo is not adopted** — no demonstrated
orchestration need; reconsider only if build times measurably degrade. `packages/ui` is
created only when a component is genuinely shared, not speculatively.

**Migration control and provenance data belong to the Migration & Provenance context inside
the application** (DOMAIN_MODEL.md §16.4). `scripts/migration/` holds only the source-adapter
executables and tooling.

---

## 6. Dependency rules

### 6.1 The dependency model — an explicit acyclic allowlist

The dependency model is **an explicit acyclic context allowlist**, not a strict
"downward-only" rule.

Dependencies **generally** flow toward lower, foundation contexts. But a small number of
**directed same-level dependencies are legitimate**, and the model states them rather than
pretending they do not exist. `Messaging → Learning` is the clear case: authorising a message
requires knowing whether a teaching assignment or enrolment is *currently* valid, and that
knowledge belongs to Learning.

> **The allowlist is the specification. Layer numbering is a readability aid, not the rule.**
>
> The architecture is not reorganised merely to make a diagram's arrows all point one way.

The layers below describe the general shape; **DOMAIN_MODEL.md §3.1 enumerates the exact
permitted edges**, including same-level ones, and is what the lint configuration encodes.

```
Layer 4  Application composition
         routes · layouts · pages · admin surfaces · cross-context orchestration
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
         (`packages/server-core` hosts context-owned services; it is not a layer)
```

**Permitted edges are enumerated per context in DOMAIN_MODEL.md §3.1.** That table — not the
layer diagram — is the specification the lint configuration transcribes.

### 6.1.1 Permitted same-level dependencies

Only these directed same-level edges are allowed. Each is **one-directional**; the reverse is
**not** implied and **not** permitted.

| Permitted edge | Why | Reverse |
|---|---|---|
| **Messaging → Learning** | Message authorisation must verify a **current** teaching assignment or enrolment (DOMAIN_MODEL.md §15.3) | **`Learning → Messaging` is prohibited** |

Adding an edge to this table is an architecture decision requiring review — never a
convenience taken during feature work. Any addition must preserve acyclicity.

### 6.2 Identity & Access internal order

```
  Authentication orchestration     (sign-in, linking, verification, reset)
            │ depends downward through public interfaces
  User & Account domain  +  Permission domain
            │
  Framework / provider adapters    (Better Auth, OAuth, session store)
```

Orchestration may depend on the user and permission domains. **Adapters remain below
domain-facing contracts** and never depend upward. No cycle exists.

### 6.3 Hard rules

1. **Only allowlisted edges exist.** A dependency not listed in DOMAIN_MODEL.md §3.1 —
   including §6.1.1 same-level edges — is prohibited. Taxonomy never imports Learning.
2. **No implicit lateral imports.** A same-level dependency exists only if explicitly listed,
   and only in the listed direction.
3. **No dependency cycles** anywhere. Detected in CI and enforced by the allowlist's
   directedness.
4. **Interface-only cross-context imports** — never `contexts/library/internal/...`.
5. **No cross-context database access.** Only Library queries Library tables.
6. **Religious canon isolation.** Quran and Hadith never depend on Editorial or any feature
   context. Provenance reaches them via Migration & Provenance, not Editorial.
7. **Migration & Provenance depends on no target content context.** It publishes through
   target domains' public interfaces, composed at Layer 4.
8. **`apps/realtime` never imports `packages/database`.** It calls context-owned services
   hosted in `packages/server-core`.
9. **`packages/server-core` is server-only** and is never imported into a client bundle.
10. **Shared code is promoted toward foundation contexts**, never reached for sideways
    outside the allowlist.
11. **No `utils` module.** Helpers live in the lowest context that legitimately owns them.
12. **No ESLint exceptions for architecture rules.** A rule needing an exception is a wrong
    rule or a wrong design — fix the design. **A genuinely needed new edge is added to the
    allowlist by decision, not bypassed by an exception.**

### 6.4 Enforcement

ESLint `no-restricted-imports` encoding **the exact allowlist** of DOMAIN_MODEL.md §3.1 and
§6.1.1 — including the direction of every same-level edge · a rule preventing `server-core`
from entering client bundles · circular dependency
detection · public interfaces as the only exported surface · **violations fail the build**.

---

## 7. Rendering architecture

- **React Server Components by default.** Client components are opt-in and justified.
- Client interactivity confined to genuinely interactive surfaces: reader preference
  controls, search-as-you-type, messaging, media players, admin editors.
- **Server Actions** for mutations from the platform's own UI; **Route Handlers** where a
  real HTTP contract is required (webhooks, feeds, health probes, realtime boundary).
- **No state-changing GET.** Sign-out and every mutation are POST/action with CSRF
  protection (SECURITY_BASELINE.md §7).
- **No global state library.** Server Components → URL state → local React state → Server
  Actions. A client-state library is added only when a concrete feature proves the need.

---

## 8. The public caching boundary

Correcting an unspecified boundary in the prior revision: "anonymously cacheable, with
personalisation added on top" is not implementable without saying exactly where session
state may be read.

### 8.1 The rule

> **The anonymous public render tree must never read session-derived state.**

A component in the cached public tree may not read: private user preferences · saved state,
bookmarks or notes · **meeting URLs** · private Fatwa questions · messages · notification
state · any per-user record.

### 8.2 How personalisation is added

Personalised content is rendered in **explicitly uncached authenticated boundaries** —
separate islands or separate routes with private cache directives — composed alongside the
cached public tree.

A signed-in visitor sees the same cached public page plus their own uncached islands. A page
**must never fail, blank out, or degrade** because no session exists.

### 8.3 Private surfaces are never publicly cached

`/my/*`, `/teacher/*`, `/admin/*` and every authenticated API response carry private,
no-store cache directives and `noindex` (ROUTE_MAP.md §11).

### 8.4 Validation

**Cache-leakage tests are a standing exit criterion of every feature phase**: no
session-derived value may appear in a shared cache entry, and no personalised fragment may
be served to a different visitor.

---

## 9. Internationalisation architecture

- **Locale routing is implemented by the application's routing layer together with
  next-intl 4.14.x.** It is not a built-in Next.js behaviour, and the rationale should not
  claim otherwise.
- Locale is the first path segment; always present (ROUTE_MAP.md §1).
- **RTL from day one:** logical CSS properties throughout, `dir` derived from locale, correct
  mixed-direction handling (Arabic Quranic text within an English page).
- **One codebase, one content database, three locales.** Three codebases or three content
  databases are prohibited.
- Content translations are related rows, never parallel columns (DOMAIN_MODEL.md §19.1).

---

## 10. Deployment topology

### 10.1 Production

Linux host · Docker Compose · NGINX stable reverse proxy · self-hosted Node applications.
**No Vercel. No Kubernetes. No Azure.**

```
┌────────────────────────── Linux host ───────────────────────────┐
│  ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌─────────────┐  │
│  │  nginx   │──▶│   web    │   │ realtime  │   │ SQL Server  │  │
│  │  :80/443 │──▶│  :3000   │   │  :3001    │   │    2022     │  │
│  └──────────┘   └────┬─────┘   └─────┬─────┘   └──────▲──────┘  │
│                      │ server-core   │ server-core    │         │
│                      └───────────────┴────────────────┘         │
│        └──▶ storage volume    ──▶ backup volume                 │
└─────────────────────────────────────────────────────────────────┘
```

NGINX terminates TLS, applies security headers and coarse rate limiting, serves static
assets, proxies HTTP to `web`, and upgrades WebSocket connections to `realtime` once that
process exists.

**SQL Server hosting is an open decision** (OPEN_DECISIONS.md). **No production data is
touched during Phase 0A.**

### 10.2 Environments

| Environment | Purpose |
|---|---|
| Local | Developer workstation; SQL Server 2022 Developer edition |
| **Staging** | Production-shaped; migration dry-runs and editorial/religious QA |
| Production | Live platform |

**Staging is delivered as its own foundation milestone before any live-source migration**
(DELIVERY_PLAN.md), not as part of final production hardening. Migration dry-runs and
religious QA must never run against production.

### 10.3 CI

Type check → lint → **architecture boundary rules** → unit and integration tests → build →
E2E on critical paths. Migrations are reviewed and applied deliberately, never automatically
on deploy.

### 10.4 Backups

SQL Server backups with **tested restores**, plus storage volume backups. **A backup that has
never been restored is not a backup.** Retention and RPO/RTO targets are an open decision.

---

## 11. Cross-cutting concerns

| Concern | Approach |
|---|---|
| Validation | **Zod 4.5.x** at every trust boundary; server-side validation mandatory and independent |
| CSRF | Origin/Host validation, `SameSite` cookies, framework-safe mutation patterns, **no state-changing GET** (SECURITY_BASELINE.md §7) |
| Logging | **Pino**, structured, **logger-level redaction**; no secrets, tokens or personal content |
| Auditing | Domain audit records for religious edits, permission grants, publication and migration publication |
| Error handling | Domain errors distinguished from infrastructure errors; no internal detail leaked |
| Configuration | Environment variables validated at startup with Zod; fail fast |
| Testing | Vitest unit/integration; Playwright E2E. Permission checks, religious workflows and **cache-leakage** require explicit coverage |
| Accessibility | **WCAG 2.2 AA** target with domain-specific criteria (SECURITY_BASELINE.md §16 and DELIVERY_PLAN.md) |

---

## 12. Architectural decisions recorded here

| Decision | Choice | Rationale |
|---|---|---|
| Overall style | Modular monolith, 16 bounded contexts | Unified content graph; transactional integrity; small team |
| Context granularity | Contexts, not entities | 27 entity-sized modules were too fine-grained; aggregates stay distinct within contexts |
| Infrastructure | Abstractions, not domains | Database, storage, search, email, logging, auditing and rate limiting own no business invariants |
| Identity structure | One context, internal sub-layering | Removes the `auth`/`users` cycle; enforceable without exceptions |
| Realtime | Calls context-owned services hosted in `packages/server-core`; no database access | Prevents a second business backend and divergent security, without transferring ownership away from the contexts |
| Realtime timing | Introduced with Messaging | A process before its domain accretes misplaced logic |
| Migration provenance | Its own foundation context | Quran and Hadith need provenance without depending on Editorial |
| Referential integrity | Typed relationships | SQL Server cannot enforce polymorphic references |
| Rate limiting | Abstraction; NGINX + in-process initially | Distributed limiting is not a mandatory V1 dependency |
| Redis | Not adopted | Not required initially; not added prematurely |
| Monorepo tool | npm workspaces | No demonstrated orchestration need |
| Search | Abstraction over SQL Server FTS | No new infrastructure now; upgrade path open |
| Storage | Abstraction, filesystem first | No cloud lock-in |
| State management | None by default | Server Components and URL state suffice |
| Locale routing | Always-prefixed; app routing **+ next-intl** | URL stability; correct attribution of the mechanism |
| Public caching | Explicit anonymous boundary | Prevents personalised data entering shared caches |
| Dependency model | **Explicit acyclic allowlist**, not strictly downward | Honest about legitimate same-level edges such as `Messaging → Learning`, rather than reorganising the architecture to satisfy diagram aesthetics |
| Boundary enforcement | Build-time lint, **no exceptions** | Conventions decay; gates do not |
