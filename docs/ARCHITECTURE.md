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
              │   Server Actions │      │  NO db capability   │
              └───┬───────────┬──┘      └──────────┬──────────┘
                  │           │                    │
      DEFAULT     │           │  ONLY for services EXPLICITLY admitted
      PATH        │           │  for multi-process reuse (§3.1.3)
                  │           │                    │
                  │     ┌─────▼────────────────────▼───────────┐
                  │     │   packages/server-core               │
                  │     │   server-only HOST for the SUBSET of │
                  │     │   context-owned services that BOTH   │
                  │     │   processes genuinely share          │
                  │     │   NOT a universal application path   │
                  │     └──────────────────┬───────────────────┘
                  │                        │  ← same context service
              ┌───▼────────────────────────▼──────────────────┐
              │   bounded-context public services             │
              │   → owning-context persistence port           │
              │   semantic owner: the bounded context         │
              └────────────────────┬──────────────────────────┘
                                   │
                      ┌────────────▼─────────────┐
                      │  packages/database       │
                      │  context-owned adapters  │
                      │  private Prisma client   │
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

**Reading the diagram.** `packages/server-core` is **not** the universal path for application
work, and the overview is drawn to say so:

- **`apps/web`'s default path is direct**: composition → bounded-context public service →
  owning-context persistence port → context-owned adapter physically in `packages/database` →
  private Prisma → SQL Server. **Most domain operations never touch `server-core` at all.**
- **`apps/web` routes through `server-core` only** for a service that has been **explicitly
  admitted** for multi-process reuse under §3.1.3, and then reaches the *same* context-owned
  service and the *same* persistence path.
- **`apps/realtime` has one route**: an explicitly approved public `server-core`-hosted context
  service, which is the *same* implementation `apps/web` would call, over the *same* persistence
  path.

`server-core` is therefore **a narrow, admission-controlled host for a subset of services** — not
a layer every operation passes through, and **not an infrastructure tunnel to the database**. It
never exposes raw persistence capability to its callers (§3.1.2), and semantic ownership stays
with the bounded context in every one of these paths (§3.1.1).

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

1. **`apps/realtime` never acquires raw database capability** — not `packages/database`, not
   Prisma, not an MSSQL driver, not a persistence adapter, and not a client, delegate,
   transaction handle or raw-query facility, whether directly or through any intermediate
   package (§3.1.2). It **may** invoke approved public `server-core` services that persist
   internally (§3.1.1). Enforced by lint; the build fails.
2. **`apps/realtime` never reimplements** authentication rules, permissions, conversation
   authorisation, or message mutation invariants.
3. **Messaging is the semantic owner** of conversations, participants, message creation,
   authorisation invariants, blocking, and assignment/enrolment checks — whether its services
   are called from `apps/web` or from `apps/realtime`.
4. **Each hosted service reaches data only through its owning context's interface**, exactly
   as it would if it were called from within `apps/web`.
5. Both processes call the **same functions**, so there is one implementation of each rule and
   no possibility of divergence.
6. **Admission is by justification**, under the timing rule of §3.1.3. A service belongs here
   only where a second process genuinely needs it — either already, or as a **concrete
   scheduled consumer the approved architecture names**. "Shared-looking" is not a reason.

### 3.1.1 Model A — encapsulated persistence through context-owned services

The approved persistence model is **Model A: encapsulated persistence through context-owned
services**. It rests on one distinction, and every rule that follows is derived from it:

> **Access to an encapsulated service that internally persists is not possession of a raw
> database capability.**

A caller that invokes a context's public service is permitted to *cause* persistence. It does
not thereby *hold* database access, because it never receives a client, a delegate, a
transaction handle or a raw-query facility — only the service's narrow contract and the domain
values it returns.

**The permitted conceptual path:**

```
web composition / Server Action / Route Handler
    → context public service
    → owning-context persistence port
    → approved context-owned persistence adapter
       (physically implemented inside packages/database)
    → private Prisma client
    → SQL Server

future realtime transport
    → explicitly approved public server-core service
    → the SAME owning-context service implementation
    → the SAME persistence path
```

**Semantic ownership stays with the bounded context.** Physically placing a persistence adapter
inside `packages/database` changes **where it is implemented**, never **who owns it** — exactly
as hosting a service in `packages/server-core` changes only where it is exported from. Every
adapter has exactly one named semantic owning context (§4.1).

`packages/database` remains **the only package that may construct or use raw Prisma database
capability**. Everything above it depends on a narrow port, never on Prisma.

### 3.1.2 Raw database capability remains forbidden

Model A permits encapsulated service invocation. It permits nothing beneath it. The following
remain prohibited, and no wrapper, re-export or intermediate package makes any of them
permitted:

- `apps/realtime` importing `packages/database`
- `apps/realtime` importing Prisma
- `apps/realtime` importing an MSSQL driver
- `apps/realtime` importing a persistence adapter or repository directly
- `apps/realtime` receiving a Prisma client
- `apps/realtime` receiving a Prisma delegate
- `apps/realtime` receiving a transaction handle
- `apps/realtime` receiving a raw-query facility
- `server-core` public APIs returning raw persistence capability
- `server-core` public APIs exposing repositories as unrestricted database capability
- one context reading another context's persistence adapter
- one context reading another context's tables or models directly
- neutral or shared packages exposing unrestricted database capability
- **wrapper modules laundering raw database capability into a prohibited caller**

Future source enforcement distinguishes **encapsulated service invocation** from **raw database
capability acquisition**. Those rules are written in the source work that owns them, against
this contract — never improvised at a call site.

### 3.1.3 Admission to `server-core` — the timing rule

Rule 6 says admission is by justification. It is refined here, because the frozen architecture
already names Identity **session** and **authorization** services inside `server-core` before
`apps/realtime` exists — and "a service belongs here only when a second process genuinely needs
it", read alone, would forbid exactly what the architecture requires.

A service may be admitted to `packages/server-core` **before the second process is physically
introduced** only where **all** of the following hold:

1. the approved delivery architecture already identifies a **concrete scheduled**
   second-process consumer
2. that future consumer is **not speculative**
3. early placement prevents later duplication or extraction churn
4. **semantic ownership remains with exactly one bounded context**
5. the service exposes a **narrow context-owned contract**
6. `server-core` adds **no new business rule**
7. `server-core` remains **server-only**

Identity's session and authorisation services qualify: the approved realtime architecture
(§3.2, §3.3) explicitly requires the *same* implementation, so introducing them elsewhere first
would mean extracting and rewriting a security-critical path later.

**This is not a general licence.** `server-core` must never become a generic shared-code
package, a utils package, an infrastructure tunnel, a second domain layer, or an owner of
Identity, Messaging or Learning rules.

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
| Raw database capability | **never held** — persistence happens inside context-owned services (§3.1.1) | **never held** (§3.1.2) |

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
Next.js / Node.js  →  context public service  →  owning-context persistence port
                   →  context-owned persistence adapter (inside packages/database)
                   →  private Prisma client    →  Microsoft SQL Server 2022

server-core        →  the SAME context-owned service  →  the same path beneath it
SSMS               →                                     Microsoft SQL Server 2022
```

**The database surface contract (Model A, §3.1.1):**

- **Raw Prisma client construction is private infrastructure.** It happens inside
  `packages/database` and nowhere else.
- **Raw Prisma client, delegate, transaction handle and raw-query capability are never part of
  an ordinary application package's public API.**
- **Context-owned persistence adapters may physically reside inside `packages/database`.**
- **Each persistence adapter has one explicit semantic owning context.** Physical placement
  transfers no business ownership to `packages/database`.
- Adapters expose **narrow persistence operations**, never raw Prisma.
- Service and domain code depends on a **narrow port/contract**, never on an adapter's internals.
- **Cross-context model/table use is prohibited**, and **one context may never use another
  context's persistence adapter as a shortcut** — it calls that context's public interface.
- **Administrative migration, provisioning and recovery tooling is classified separately** from
  runtime persistence adapters. The two are not interchangeable and are not governed by the
  same rules.
- **The single application SQL principal does not itself enforce bounded-context ownership.**
  A least-privilege account constrains what the application may do to the database; it cannot
  express which context owns which table. **Bounded-context ownership is enforced by
  application architecture, interfaces and tests** — the SQL principal is defence in depth,
  never the boundary.

**Tooling and integrity:**

- **Prisma ORM 7.10.0** with **`@prisma/adapter-mssql` 7.10.0** is the sole application
  data-access path, confined to `packages/database`.
- **SSMS 22.9.1 GA** is a **workstation administration tool** for inspection, diagnostic
  T-SQL, index and constraint review, authorised configuration, backup/restore and
  troubleshooting.
- **SSMS is not an ORM, not a runtime dependency, not a replacement for Prisma, and not
  something the deployed application communicates through.** The paths are complementary.
- Schema changes flow through **reviewed Prisma migrations** — never ad-hoc SSMS schema edits.
- **Referential integrity is enforced by the database.** Polymorphic `targetType + targetId`
  **relational domain references** are prohibited (DOMAIN_MODEL.md §6.2). **Historical audit
  identifiers are outside that prohibition** and are unchanged (DOMAIN_MODEL.md §6.2.1).
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
│   ├── database/           Prisma schema, PRIVATE client, migrations, seed, and the
│   │                    context-owned persistence adapters — each with one named
│   │                    semantic owning context (§4.1). Administrative migration,
│   │                    provisioning and recovery tooling is classified separately
│   │                    from runtime persistence adapters.
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
8. **`apps/realtime` never acquires raw database capability** (§3.1.2). It calls context-owned
   services hosted in `packages/server-core`, which persist internally through their own
   context's port.
9. **`packages/server-core` is server-only** and is never imported into a client bundle.
10. **Shared code is promoted toward foundation contexts**, never reached for sideways
    outside the allowlist.
11. **No `utils` module.** Helpers live in the lowest context that legitimately owns them.
12. **No ESLint exceptions for architecture rules.** A rule needing an exception is a wrong
    rule or a wrong design — fix the design. **A genuinely needed new edge is added to the
    allowlist by decision, not bypassed by an exception.**
13. **Encapsulated service invocation is not raw database capability acquisition** (§3.1.1).
    Calling a context service that internally persists is permitted. Receiving a Prisma client,
    delegate, transaction handle, raw-query facility or persistence adapter is not — and a
    wrapper that launders one into the other violates this rule rather than satisfying it.
14. **A persistence adapter's physical location never determines its owner** (§4.1). An adapter
    inside `packages/database` is still owned by its bounded context, and only that context may
    change its rules.

### 6.4 Enforcement

ESLint `no-restricted-imports` encoding **the exact allowlist** of DOMAIN_MODEL.md §3.1 and
§6.1.1 — including the direction of every same-level edge · a rule preventing `server-core`
from entering client bundles · **a rule distinguishing encapsulated service invocation from raw
database capability acquisition (§3.1.1, §3.1.2), applied transitively so that no intermediate
package launders a capability** · circular dependency
detection · public interfaces as the only exported surface · **violations fail the build**.

---

## 7. Rendering architecture

- **React Server Components by default.** Client components are opt-in and justified.
- Client interactivity confined to genuinely interactive surfaces: reader preference
  controls, search-as-you-type, messaging, media players, admin editors.
- **Server Actions** for mutations from the platform's own UI; **Route Handlers** where a
  real HTTP contract is required (webhooks, feeds, health probes, realtime boundary).
- **Ordinary browser application mutations follow Class A** (SECURITY_BASELINE.md §7.1): POST
  or Server Action, Origin/Host validation and framework-appropriate browser CSRF protection —
  **sign-out included**. **A GET never performs an ordinary protected browser mutation.**
  **Signed machine callbacks (Class B) and authentication/OAuth callbacks (Class C) follow their
  own protocol classes**, and emailed verification/reset links (Class D) may render on GET while
  consuming their token at the confirming mutation. **Any protocol endpoint's semantics must
  satisfy SECURITY_BASELINE.md §7.**
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
- **It is delivered once, in the Localisation Foundation phase** (DELIVERY_PLAN.md, Phase 3A),
  **before any phase required to serve en/ur/ar routes** — including the Phase 2 authentication
  surfaces. next-intl is introduced and compatibility-validated there (TECH_STACK.md §1.5).
  **No later phase re-implements localisation.**
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
│                      │ ctx services  │ server-core    │         │
│                      └───────────────┴────────────────┘         │
│        └──▶ storage volume    ──▶ backup volume                 │
└─────────────────────────────────────────────────────────────────┘
```

NGINX terminates TLS, applies security headers and coarse rate limiting, serves static
assets, proxies HTTP to `web`, and upgrades WebSocket connections to `realtime` once that
process exists.

**On the two labelled paths.** `web` reaches SQL Server through **bounded-context services and
their persistence ports** — `server-core` is on that path only for the explicitly admitted
subset (§1, §3.1.3). `realtime` reaches the same services **only** through `server-core`, and
holds no raw database capability (§3.1.2).

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
| Validation | **Zod 4.5.x** at every trust boundary; server-side validation of **application-owned inputs** mandatory and independent. Opaque provider/library protocol material is validated by its protocol implementation (SECURITY_BASELINE.md §7, §9.1) |
| Mutation safety | **Four protocol security classes** (SECURITY_BASELINE.md §7). **Class A** browser mutations: Origin/Host validation, `SameSite` cookies, framework-appropriate CSRF controls, **no state-changing GET**. **Classes B, C and D** — signed machine callbacks, authentication/OAuth callbacks and emailed verification/reset links — use their own protocol guarantees, **not** browser CSRF |
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
| Realtime | Calls context-owned services hosted in `packages/server-core`; **never holds raw database capability** | Prevents a second business backend and divergent security, without transferring ownership away from the contexts |
| **Persistence model** | **Model A — encapsulated persistence through context-owned services** (§3.1.1) | Separates *invoking a service that persists* from *holding raw database capability*, so web and realtime share one implementation while neither becomes a data-access holder |
| **Persistence adapter placement** | Physically inside `packages/database`; semantically owned by exactly one context (§4.1) | Keeps raw Prisma private without moving business ownership into infrastructure |
| **`server-core` admission timing** | Permitted ahead of the second process **only** for a concrete scheduled consumer (§3.1.3) | Reconciles "admission by justification" with the architecture already naming Identity session and authorisation services there |
| **Bounded-context ownership enforcement** | Application architecture, interfaces and tests — not the SQL principal (§4.1) | One application SQL account cannot express context ownership; it is defence in depth, not the boundary |
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
