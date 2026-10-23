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

`apps/web` is stateless and request-scoped; it restarts freely, and it is the tier that can be
scaled out (subject to §3.5.1). Long-lived WebSocket connections have a different lifecycle: a
web deployment must not drop every open conversation.

That difference in connection lifetime is the **sole** justification for the split, and it
is the only split in the system.

### 1.2 Why it is not created yet

A process that exists before the domain it serves inevitably accretes logic that belongs
elsewhere. `apps/realtime` is introduced in the Messaging phase, after the shared server
boundary below is built and proven — not in Phase 0B merely because it appears on a diagram.
**Delivered in Phase 25**, after Phase 24 proved that boundary (§3.6).

---

## 2. Modular monolith — rationale

One deployable web application, internally divided into **16 bounded contexts**
(DOMAIN_MODEL.md §1) with enforced boundaries.

### 2.1 Why not microservices

| Consideration | Finding |
|---|---|
| Domain coupling | The core product value is the *unified content graph*. A topic page joins works, videos, articles, research, Fatawa, courses, audio and contributors. Distributed, this becomes network joins and consistency problems — solving with infrastructure what a database join solves for free. |
| Transactional integrity | Publishing a Fatwa updates the ruling, its question status, topic assignments and the audit log. **One database, one transaction, inside the owning context.** Across services this becomes sagas and compensating actions, for religious content where correctness is non-negotiable. (The **search projection is derived work**, committed as durable intent rather than inside that transaction — §8.5.) |
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

### 3.1.2.1 Cross-context consistency — without a generic transaction port

Model A keeps raw transaction capability private (§3.1.2). A blanket rule that cross-context
work happens "in a single transaction" would contradict that, because the only way to honour it
would be to hand a transaction handle across a boundary. **The contradiction is resolved by
narrowing the claim, not by adding a mechanism.**

**A. Single-context authoritative mutations.** A bounded context performs its own atomic
transaction internally, through its own application service and persistence adapter. **Raw
transaction capability never leaves that private boundary.** This covers the overwhelming
majority of mutations, including the Fatwa publication above.

**B. Derived and external effects are not in that transaction.** Search and FTS, cache
invalidation, sitemap refresh, email delivery and external provider effects are **derived or
external work**. They are never described or tested as atomically committed with authoritative
domain state (§8.5).

**C. Rare cross-context hard purge** uses a **fail-closed, durable, resumable orchestration**,
not one cross-context SQL transaction (DOMAIN_MODEL.md §14.3):

1. the target is first marked **unavailable, archived or purge-pending**;
2. it **cannot leak publicly** while the purge is incomplete;
3. **Layer 4 coordinates the public services of the semantic owners** — it does not reach into
   their tables;
4. each owner **removes, anonymises or tombstones its own records** according to its policy;
5. every step is **idempotent and resumable**, so retries after interruption are safe;
6. the absence of any prohibited relational reference is **verified**;
7. **only then** may the owning content context physically delete;
8. workflow state and failures are **audited**.

A failure may **delay** final physical deletion. It must never break referential integrity,
leak content, or bypass semantic ownership.

> **Explicitly not introduced:** a generic atomic-execution port, a UnitOfWork abstraction, a
> transaction-callback API, a shared repository gateway, an arbitrary transaction coordinator,
> a public transaction handle, or cross-context raw Prisma capability. Each would be
> **capability laundering** under §3.1.2 — a route by which a caller acquires database authority
> it is not permitted to hold.

**If a future concrete use case genuinely requires same-transaction cross-context atomicity,
that phase STOPS and obtains a separate explicit architecture decision** with a narrowly proven
mechanism. **No such mechanism is pre-built now**, because a general-purpose one would be used
generally.

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

**As delivered (Phase 24).** `server-core` now hosts, beside `session/`, `authorization/` and
logging:

- `messaging/` — Messaging's application services (list, open, history, catch-up, start, send, mark
  read, block, report, attachment upload/serve decisions, support queue and claim, moderation
  evidence and decisions, export and disposition), admitted as one unit because every operation
  hangs off the ONE conversation-access decision Phase 25's transport must also make. Messaging
  therefore has no `apps/web/src/contexts/messaging`: its application layer is this module, its
  contract `@minhaj/contracts/messaging`, its adapter `packages/database/src/adapters/messaging`;
- `relationships/` — Learning's current-teaching-relationship answer (both halves, read live),
  which Messaging consumes through a Layer-4-wired port; Learning never imports Messaging.

Both take only injected ports and import nothing but `server-only`, Node built-ins and
`@minhaj/contracts`; Layer 4 (`apps/web/src/composition/messaging.ts`) wires the adapters, Identity
and Storage. No new context edge exists beyond the allowlisted `Messaging → Learning`, and no
realtime process, socket, presence or typing state exists yet (Phase 25).

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
without domain change.

### 3.6 As delivered (Phase 25)

```
browser ──▶ NGINX ──▶ /socket.io/ (WebSocket upgrade) ──▶ apps/realtime (transport)
                │                                            │ injected: SessionService.resolve,
                └──▶ everything else ──▶ apps/web            │           RealtimeMessaging
                                                             ▼
                        realtime process composition root (Layer 4, composition workspace)
                        identity-mechanics.ts · messaging-wiring.ts — shared with apps/web
                                                             ▼
                        server-core: session · authorization · messaging · relationships
                                                             ▼
                        context-owned adapters in packages/database ──▶ SQL Server
```

- **The transport holds no capability.** `apps/realtime` imports Node, Socket.IO, the contracts and
  `server-core`, and is checked transitively under the `realtime` role (§6.4): no database package,
  Prisma, driver or adapter is reachable from it by any chain, and no exception exists.
- **The process still needs Layer 4.** Wiring ports to adapters is composition, so the realtime
  process has its own composition root in the composition workspace. It is plain-Node runnable
  (explicit `.ts` paths, `--conditions=react-server`), builds Better Auth's configuration and
  Messaging's dependencies through the SAME two builders the web process uses, and hands the transport
  `SessionService.resolve` and `RealtimeMessaging` — a narrowed view over the same
  `createMessagingService`. It holds no Storage capability: attachment bytes stay HTTP.
- **Single instance, no Redis** (§3.5). Presence, typing and rooms are process memory; correctness
  never depends on them, because delivery re-reads SQL per recipient and recovery is durable catch-up.

### 3.5.1 Horizontal scaling of the web tier is conditional, not automatic

A previous revision said the web tier "scales horizontally regardless". **That overstated the
position and is corrected here.** Statelessness is necessary for scaling out; it is not
sufficient. Running more than one web instance requires each of the following to be true, and
**each is a real piece of work, not an assumption**:

| Concern | What multi-instance actually requires |
|---|---|
| **Application and route cache** | Cache and revalidation behaviour coordinated across instances, so one instance's publish is not invisible to another |
| **Storage** | Assets on **shared or portable storage** — a per-instance local volume silently serves 404s from the wrong node |
| **Secrets and configuration** | Every instance built and configured compatibly, including any build-time origin values (§10.5.3) |
| **Scheduled work** | **Leasing or single-execution election**, so a scheduled publication does not fire once per instance (§8.5) |
| **Rate limiting** | A shared limiter strategy wherever a security-critical flow needs cross-instance consistency (§4.5) |
| **Realtime** | The Socket.IO adapter above, where the realtime tier is also scaled |

**None of this infrastructure is added before measured need.** It is recorded so that scaling
out is a deliberate, costed decision rather than a surprise during an incident — and so the
baseline stops claiming a property it has not established.

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

**Byte ranges (Phase 11).** A stream `open` has released — clean custody, bytes present, an
explicit allow — also offers `range(start, end)`, read with the file stream's own bounds, so a
player seeking into a long recording reads only that part. The serving route parses the HTTP
`Range` header **only after** `open` has returned, so a range is authorised exactly as a whole
file is: one well-formed `bytes=` range is `206`, one starting past the end is `416`, and
anything malformed, multipart or conditional is served whole. Every byte route under `/assets`
streams through one shared bridge and never buffers a file.

**Large browser uploads (Phase 11).** A consuming context that needs a file larger than the
global Server Action cap streams the raw request body into `StorageService.store` from its own
Class-A Route Handler (SECURITY_BASELINE.md §7.1, §10.1); the cap itself is never raised.
Storage alone generates the key, measures, hashes, sniffs, quarantines and scans. MPEG audio is
recognised either by its ID3 tag or structurally — two consecutive valid Layer III frame
headers — never by one byte, an extension or a declared type.

**Still images (Phase 12).** An upload policy may carry image limits (pixels and longest side).
Storage then admits only a structurally whole JPEG or PNG within them — checked from the frame
header or `IHDR` before the image data is read, so a small file declaring an enormous canvas is
refused on arrival — and what it WRITES, and so measures, hashes, sniffs, scans and serves, is
that image with its hidden metadata removed: EXIF, XMP, IPTC, comments, embedded thumbnails,
unknown segments and chunks, and anything after the end marker. Colour profiles are kept, and a
JPEG's orientation is re-emitted as the only EXIF entry. It is a streaming transform over the
container structure; no pixel is decoded on the server and nothing is re-encoded. The byte
ceiling counts what ARRIVES, discarded metadata included. `servable(ids)` answers, for one
bounded page, which assets are technically servable (clean, bytes present) — a question a
consumer asks only about assets its own authorised records name, so a page offers an image only
where fetching it can work; the byte route still makes both decisions per request.

**Owner-safe release (Phase 24).** A consumer that must be able to dispose of what it stores
generates a 256-bit release token, records it in its OWN row, and passes it in the upload policy;
Storage keeps only its SHA-256 (`Asset.releaseDigest`, unique where present). `release(token)`
withdraws the matching asset from service (`rejected`/`released`), removes its bytes, then its
record; it is idempotent and resumable, and answers `referenced` — record kept, never served — if a
consumer's key still names it. The API takes a token, never an asset id, so no consumer can release
another's asset and nothing stored without a token can be released at all; Storage still reads no
consumer's table. Messaging is the first user (SECURITY_BASELINE.md §10.1).

### 4.3 Search

**SearchService** abstraction, implemented over **SQL Server Full-Text Search** for V1, so a
dedicated search or vector engine can arrive later without touching call sites.

**Arabic and Urdu tokenisation quality under SQL Server FTS is an engineering validation
risk**, proven with real content in the Search Foundation phase. It is a technical
acceptance criterion — **not an external business decision**. The measured result and its
recorded limitations are in TECH_STACK.md §10.

**As delivered in Phase 17** — Layer 0, never a seventeenth context:

| Part | Where | Owns |
|---|---|---|
| `SearchService` | `packages/search` (Layer-0 workspace) | Query parsing and bounds, text folding, projection validation, indexing ticks, rebuild, reconciliation, status. **No engine, no owner, no route** |
| `SearchIndexPort` adapter | `packages/database/src/adapters/search` (declared Layer-0 `search` concern) | **The only place the engine is named**: full-text grammar built from pre-validated terms and passed as a parameter, one `CONTAINSTABLE` per word breaker, leases, settlement |
| Owner projections | each owner context (`search-projection.ts`) over its own public read | What is searchable and when it is public — **the owner's rule, the same one its public pages use** |
| Wiring and routes | Layer 4 (`composition/search-wiring.ts`, `search-read.ts`, `search.ts`) | Which owner feeds which scope, and each result's current canonical path |

- **Durable intent.** Every owner mutation that can change what it publishes appends one
  `SearchIndexRequest` row **inside its own transaction** (the package-internal
  `search-intent.ts`, as `audit-row.ts` is for audit). The indexer relays requests into
  per-scope state with a **generation** counter; a projection is marked current only if no
  newer request arrived while it was built. Claims are **leases**, so a crashed worker's scope
  becomes due again and concurrent ticks never take the same scope. Failures are recorded by
  **category**, retried with bounded backoff, and wait for an operator once exhausted.
- **Ticks, not a worker platform.** An owner's administrative action indexes after its
  response; a thirty-second in-process sweep (production only, `instrumentation.ts`) catches up
  and retries. No queue product, no event bus.
- **The stale-index rule is enforced per result page**: rows are grouped by kind and each
  owner is asked **once per kind** which ids are public now and at what address. A row the
  owner does not return is withheld; the page is shown short rather than refilled.
- **Rebuild and reconciliation** enumerate each owner's public inventory in bounded pages
  (ending only on an empty page) plus the index's own scopes, and request re-projection; they
  never read the projection back as a source.
- **Throttling happens at the request boundary.** The public results page is a content route
  and may reach no request header and no secret (§8.1, §8.3.1.1), so `proxy.ts` admits or
  throttles a `/search` query through the RateLimiter abstraction before the page renders —
  GET and HEAD alike, failing closed when the limiter cannot answer.
  The public runtime reports failures to standard error as identifiers only; the operator and
  background runtime uses the structured logger. **No query text is ever logged or stored.**
- **A later domain adds its kinds in its own migration**, by replacing the vocabulary CHECK
  constraints — never by pre-creation. Phase 9 added `research`, `research-paper`,
  `publication`, `magazine`, `magazine-issue` and `encyclopedia`, each its own scope. A scope
  whose projection depends on another record (an issue on its Magazine) carries that record's
  version in its stamp, and the other record's change requests the dependent scopes in the same
  transaction, so neither a missed request nor reconciliation can leave them stale.
  Phase 10 added `video` alone; a Series or Playlist is a grouping of Videos, not a kind.
  Phase 11 added `audio` alone; an AudioSeries is a grouping, and a Quran recitation is Quran's
  to project.
  Phase 13 added Editorial's four News families — `news-article`, `press-release`,
  `statement` and `media-coverage` — each its own kind and scope, resolved to its own canonical
  family by Editorial's published predicate.

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

**EmailProvider** abstraction. **Pino 10.3.1** structured logging with **logger-level
redaction**. **Audit** is durable domain data with the realistic integrity baseline of
SECURITY_BASELINE.md §13.

**The first EmailProvider adapter is Resend**, introduced with Phase 2. It is recorded here as
the **first and development/pre-adoption adapter behind the abstraction**, not as a permanent
platform dependency: an adopting organisation may run its own provider by supplying another
adapter, and **no business context ever calls Resend directly** (§4.6.1).

> **There is ONE application origin, and `AUTH_BASE_URL` is it.** It bounds what the
> authentication library may redirect to, it builds emailed links, and from Phase 4 it also
> builds every canonical URL, `hreflang` alternate and sitemap entry (ROUTE_MAP.md §9.1). A
> second origin variable beside it would be two names for one fact, and the two would drift the
> first time a deployment set only one. The unused `NEXT_PUBLIC_SITE_URL` declaration was
> therefore retired in Phase 4; a browser-visible origin variable returns only if browser code
> acquires a distinct, demonstrated need for one.

| Origin | Value | Note |
|---|---|---|
| Development / presentation app | `minhajulquran.haseebliaqat.me` | Pre-adoption origin (PRODUCT_SCOPE.md, *Product status and acceptance*) |
| Development sender domain | `mail.minhajulquran.haseebliaqat.me` | Used for development and presentation mail only |
| `notify.haseebliaqat.me` | **Unrelated** | Belongs to **ParaForce**. It is **not** a One Minhaj sender and must stay separate |

> **Selecting a provider does not close the Phase 2 email entry gate.** That gate closes only on
> evidence — verified sending domain, SPF where applicable, verified DKIM, configured DMARC, a
> securely provisioned restricted sending credential, and successful delivery to a real
> controlled inbox (OPEN_DECISIONS.md §5.1). The eventual **official production sender remains
> organisation-controlled and separate**. **No API key or secret appears in this repository's
> documentation.**

### 4.6.1 Outbound communication — one architecture, three owners

Mail is neither a domain nor a free-for-all. Ownership splits three ways, and the split is what
keeps template wording next to the business rule that justifies it while keeping provider
mechanics in one place:

| Owner | Owns |
|---|---|
| **The originating business or security context** | Why the communication exists · recipient eligibility · the business event · its domain meaning · the domain-specific message content |
| **The shared platform email concern** | The provider contract and adapter · rendering infrastructure · the shared visual shell and branding · common localisation and accessibility mechanics · sending · provider event verification · delivery metadata |
| **Personalisation & Notifications** | In-app `Notification` · optional notification preferences · optional email-channel and category preferences where appropriate |

The lifecycles this covers are those the product already implies: **Identity/security**
(verification, resend, reset, password changed, email changed, justified security alerts);
**Learning** (trial and booking lifecycle, confirmation, change, cancellation, reminders);
**Membership** (application and status); **Fatwa** (question lifecycle, only where privacy
permits); **Donations** (confirmation, failure where useful, refund, receipt-style service
mail); **Messaging** (optional notification mail); and the **Newsletter**, which is a separate
marketing lifecycle owned by Personalisation & Notifications (DOMAIN_MODEL.md §14.5).

**Reliability.** Where a committed business or security event must not silently lose its
communication, the event commits **durable delivery intent** in SQL, dispatched by bounded
scheduled work. Required behaviour: stable idempotency · bounded retry with backoff · a
distinction between permanent and transient failure · suppression · bounce and complaint
handling · operator-visible failure · verified webhook authenticity · idempotent, replay-safe
handling of provider events · redacted logs. **No Redis, queue product, generic worker platform
or event bus is introduced** — durable rows plus bounded scheduled dispatch is the whole
mechanism (§8.5).

Better Auth's password and verified-email endpoints do not expose a transaction
that may safely carry arbitrary application writes. Identity therefore prepares
a narrow, token-free `IdentitySecurityOperation` marker before those calls. Its
private database adapter stamps that exact marker in the same SQL transaction as
the authoritative password or email write. Audit plus communication intent are
then finalized idempotently, immediately or by the existing bounded dispatch
sweep after restart. A marker contains only operation kind, historical
user/session identifiers and lifecycle timestamps—never an address, password,
hash or bearer. This is Identity-specific reconciliation, not a generic unit of
work, outbox, saga, event bus or cross-owner transaction.

> **Critical exception — authentication tokens.** Retrying an email **must never** create a
> second token system. Email verification and password reset use the **compatibility-proven
> Better Auth 1.7.x token lifecycle** and nothing else. A retry must not duplicate token
> authority, create a parallel token table, silently extend expiry, resurrect a consumed token,
> mint a new valid token invisibly, or make a GET perform the confirming mutation. **A GET may
> display or validate link state; the confirming action consumes the token** according to the
> proven protocol (SECURITY_BASELINE.md §7.4).
>
> Durable **post-commit notifications** — password changed, email changed, account-security
> alerts — carry no token authority and may use the communication-intent mechanism freely.

> **Critical service mail is not marketing.** A marketing unsubscribe or suppression **never**
> suppresses security-critical or account-service communication.

**As delivered (Phase 21): a second owner.** The Layer-4 dispatcher routes the
`newsletter.confirmation` purpose to Personalisation & Notifications, which re-derives the link at
send time from its own state, and checks it against provider suppression under the **marketing**
scope; every Identity purpose keeps the transactional scope, and Identity resolves nothing that is
not its own. **A provider complaint is scoped by the message it names**: a complaint about a
newsletter message suppresses marketing mail only, because anybody can cause a confirmation to be
sent to anybody and its recipient's spam report must never silence their account mail; any other
complaint, one whose message cannot be identified, and every bounce stay transactional. The newsletter enqueues through the same durable delivery rows — no second queue, no
direct provider call. A bounded personal-data sweep beside the existing ones runs each owner's
closure reconciliation and retires lapsed newsletter confirmations. No dependency edge is added:
Personalisation still depends on Layer 0 and Identity only.

**As delivered (Phase 23): a third owner.** Learning commits a durable `ClassCommunicationIntent` —
purpose, session, recipient account, due instant, idempotency key — in the same transaction as a
trial confirmation, a reschedule, a cancellation or a chosen reminder instant. The Layer-4 dispatcher
relays due intents each tick: Learning re-checks that the message is still owed (activation, session
state, the recipient's current Enrolment, Booking or teaching scope), Identity resolves the account's
current address and locale through its public interface, and the shared delivery row is enqueued
under the intent's own key; at send time Learning resolves and renders the message the same way, with
a link to the person's own private class page and never a meeting address. A reschedule abandons the
old reminder intent and commits a new one, so the old time cannot fire. The four Learning purposes
keep the **transactional** suppression scope. No dependency edge is added: Learning still depends on
Layer 0 and, through Layer-4 answers, on Identity and People.

**As delivered (Phase 26): a fourth owner.** Membership commits a durable
`MembershipCommunicationIntent` — purpose, the recipient account, the ONE application or Membership it
describes (typed keys, never a target pair), due instant, idempotency key — in the same transaction as
a submission, the start of review, an approval, a rejection, an applicant's withdrawal or a
Membership's closure. The Layer-4 dispatcher relays due intents each tick beside Identity's and
Learning's: Membership re-checks that the message is still owed (the application still stands at the
status the message describes, or the Membership is closed), Identity resolves the account's current
address and locale through its public interface — a closed, disabled or suspended account is owed
nothing — and the shared delivery row is enqueued under the intent's own key. At send time Membership
re-checks and renders a short factual message naming the type, with a link to the person's own
`/my/membership` page and never a state-changing link. An account-closure withdrawal owes nothing. The
six Membership purposes keep the **transactional** suppression scope, so a newsletter unsubscribe
never silences them. Membership never calls the provider. No dependency edge is added: Membership
depends on Layer 0 and, through Layer-4 answers, on Identity.

**As delivered (Phase 27): a fifth owner.** Donations commits a durable
`DonationCommunicationIntent` — purpose (`donation.succeeded`, `donation.partially-refunded`,
`donation.refunded`), the linked donor's account, the ONE donation and, for a refund, the ONE refund it
describes (typed keys, never a target pair), due instant, idempotency key — in the same transaction
that records the verified capture or the settled refund. Anonymous donors are owed no mail; no address
is collected for one. The Layer-4 dispatcher relays due intents beside the other owners; Donations
re-checks that the fact still holds for the same linked donor, Identity resolves the current address
and locale, and the message — a payment acknowledgement, never a tax receipt — links only to
`/my/donations`. The purposes keep the **transactional** suppression scope. Donations never calls the
email provider. No dependency edge is added: Donations depends on Layer 0 and, through Layer-4
answers, on Identity.

### 4.7 Integration abstractions

| Integration | V1 | Later |
|---|---|---|
| Live class | `MeetingProvider` storing provider + manually entered URL, with validation (DOMAIN_MODEL.md §13.1). **Delivered in Phase 23** as a pure Layer-0 contract: one provider (Google Meet), standard-parser validation and canonicalisation, no network, no credential | Google Calendar/Meet API provisioning |
| Video | `VideoProvider` — YouTube/Vimeo metadata and embed | Additional providers |
| Payment | `PaymentProvider` (`@minhaj/contracts/donations`) — **delivered in Phase 27** with one **sandbox engineering adapter, Stripe** (hosted Checkout; native `fetch` + `node:crypto`, no SDK), hosted in `packages/database/src/adapters/donations-stripe` and owned by Donations: create, resume and cancel a hosted checkout; observe a checkout's payment, refunds and disputes server-to-server; verify a webhook over its exact bytes; request and observe a refund. Provider units, enums, headers and signatures never cross the port; an unknown outcome is `unknown`, never guessed, and a money-moving call is never retried by the adapter. A deterministic loopback Stripe-protocol simulator serves CI and the browser suite | Production provider selection stays OPEN (OPEN_DECISIONS.md §5.4); a sandbox adapter is not a production selection |
| Email | `EmailProvider` interface, **first adapter Resend** (§4.6) | An adopting organisation supplies its own provider adapter |

### 4.7.1 Third-party embeds — privacy and loading

A provider embed is not privacy-neutral merely because it is an `iframe`. **A third-party embed
must not silently introduce unmanaged non-essential tracking.**

- Prefer a **privacy-enhanced or provider-minimising embed mode** wherever the provider
  supports one and it is compatible with the product.
- Where a provider **necessarily** introduces non-essential cookies or tracking, the privacy and
  consent posture must account for it **before the embed loads** — not after.
- A **blocked or deferred embed always has an accessible fallback**: a described link to the
  provider, never a dead frame or a silent gap.
- Provider scripts and frames remain constrained by the approved **CSP provider allowlist**.
- **No generic cookie-consent platform is introduced** unless genuine non-essential processing
  actually requires one.

Captions and transcripts are surfaced **where the provider or source genuinely supplies them**,
and are never fabricated (SECURITY_BASELINE.md §16.2).

**As delivered for video (Phase 10).** A Video page first renders a first-party placeholder
with a described provider link and a "load the video from YouTube/Vimeo" button; **no frame,
image, script or preconnect reaches the provider until the visitor presses it.** Activation is
local presentation state — nothing is stored or remembered, and it is an engineering gate, not a
recorded consent. The frame address is derived in code from `provider + providerVideoId`, on
the privacy-enhanced host (`www.youtube-nocookie.com`, `player.vimeo.com` with `dnt=1`), never
from operator input, and carries an accessible title and no autoplay. Provider thumbnails are
never painted; they appear only inside structured data, which browsers do not fetch. The CSP
keeps `frame-src 'none'` site-wide and names exactly those two origins only on the public
Video page and its administrative editor; no provider script is allowed anywhere, and
`Permissions-Policy` refuses `autoplay`. No provider API is called: metadata is entered by an
operator and a page never depends on provider uptime.

---

## 5. Repository structure

```
minhaj-platform/
├── apps/
│   ├── web/                Next.js 16 application
│   └── realtime/           The realtime transport — delivered in Phase 25 (§3.6)
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

### 5.1 As delivered (Phase 29) — Migration & Provenance

```
/admin/migration/* · /api/admin/migration/*          scripts/migration/* (plain Node CLIs)
        │                                                     │
composition/migration.ts (web root)         composition/migration-runner.ts (tooling root)
        └──────────────▶ composition/migration-wiring.ts ◀────┘   one wiring, seven services
                           │            │
                           │            └─▶ composition/migration-targets.ts
                           │                  Media's public service · Personalisation's videoHeld
                           ▼
         contexts/migration-provenance (ports only) ──▶ adapters/migration-provenance ──▶ SQL Server
```

- **The context** is `apps/web/src/contexts/migration-provenance`, reached only through its
  `index.ts`. It imports its own modules, `@minhaj/contracts`, `zod`, `sanitize-html`, Node built-ins
  and `server-only` — **no other context and no database capability** — and uses relative imports
  only, so the same code runs in Next and in plain Node (`--conditions=react-server`). Identity's
  live authority, Taxonomy's existing Topics, the publication target, Storage, the fetch boundary
  and the source adapters all arrive as ports from `@minhaj/contracts/migration`.
- **The adapter** is `packages/database/src/adapters/migration-provenance`, owned by Migration
  (§4.1). It reads and writes Migration's eighteen tables only, writes each operator act's audit row
  in the same transaction, and exposes the seven port factories and one refusal type — never Prisma.
  User, Topic, Asset and Video are reached only as the typed foreign keys Migration's rows hold.
- **Layer 4, twice, from one wiring.** `migration-wiring.ts` builds the seven services (sources,
  pipeline, decisions, raw evidence, publication, promotion, read) for both processes and binds
  Storage itself, so no caller can hand a run another place to put acquired bytes. The web root
  `migration.ts` supplies Identity's live authorisation, Taxonomy's public reference read, the
  foundation Storage service and the Media target. The tooling root `migration-runner.ts` — needed
  because the CLIs and the staging proof run outside the Next bundler, as the realtime process does
  (§3.6) — supplies the same answers node-loadably: server-core's `AuthorizationService` over
  Identity's authorisation reader (also the only minter of the privileged actor it can re-verify),
  Taxonomy's and People's public services, and `@minhaj/storage`. Both name packages and explicit
  `.ts` paths only, never the `@/` alias.
- **The one publication target** is Media's Video, in `migration-targets.ts`, through
  `createMediaService(...).saveVideo` / `video` / `videos` — never Media's tables. Media's strict
  schema, references, `media.administer` authority, audit row and search intent apply to a migrated
  Video exactly as to a hand-made one; a refusal is final; a resumed publication adopts the Video an
  interrupted one made only when it is published with the same slug and provider identity; rollback
  archives at the recorded version.
- **Personalisation's held-video read.** Before a rollback withdraws a Video, Layer 4 asks
  Personalisation's own public `createHoldingService(...).videoHeld` — one bit, answered from
  `SavedItem` and `WatchHistory` by two bounded `EXISTS` probes in Personalisation's adapter,
  naming no account, count or instant. A held Video is left for a person. This adds no context
  edge: Layer 4 composes both.
- **No target dependency.** Migration names no target type; Media holds no Migration concept; the
  only bridge is Layer-4 composition (§6.3 rule 7).
- **The tooling, `scripts/migration/`, holds no database capability.** It imports no Prisma, driver
  or `@minhaj/database`, and reaches the application only through `migration-runner.ts`. It contains:
  `safe-fetch.ts`, the SSRF-safe transport (`node:http` / `node:https` with an injected resolver and a
  connection pinned to the validated address; SECURITY_BASELINE.md §10.5); `fixture-server.ts`, a
  deterministic synthetic legacy site on `127.0.0.1` answering only `*.fixture.invalid` hosts;
  `adapters/fixture-video.ts` over `adapters/html-source.ts` (Cheerio with parse5, handing markup on
  exactly as written); `adapters/fixture-export.ts` over `export/export-source.ts`, which executes
  `synthetic-export.sql` into an in-memory, query-only `node:sqlite` database — the only use of that
  engine; `promotion-bundle.ts`, the Phase-29 promotion destination; `canonical-json.ts`; and the
  `run-fixture.ts`, `promote.ts` and `staging-fixture-proof.ts` entries.
- **Operations image.** `docker/ops.Dockerfile` additionally carries `packages/server-core/src`, the
  three node-runnable migration composition files, the five contexts that graph composes through
  their public interfaces (migration-provenance, media, people-contributors,
  personalisation-notifications, taxonomy) and `scripts/migration`, so `staging-migration-proof` can
  run the fixture proof as the runtime principal (§10.6). No page, route or component is included.

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
| **Editorial → Global Network** | A NewsArticle revision and, since Phase 14, an Event revision carry a typed Centre reference; Editorial asks Global's public reference interface whether a Centre may be chosen and never reads Global's tables (DOMAIN_MODEL.md §3.2, §17.1) | **`Global Network → Editorial` is prohibited** — a Centre page composes both at Layer 4 |
| **Editorial → Media** | Phase 14: an Event revision owns its typed, ordered association to Media-owned Galleries (`EventGallery`). Since Phase 15 a Collection revision also holds typed Video members (`CollectionItem.videoId`). Editorial asks Media's public interfaces whether a Gallery may be associated or a Video is published, and never reads Media's tables; Media holds no Event or Collection column, table or code (DOMAIN_MODEL.md §3.2, §7.2.3, §7.3) | **`Media → Editorial` is prohibited** — an Event's gallery view and a Collection page compose both at Layer 4 |
| **Editorial → Library** | Phase 15: a Collection revision holds typed Work members (`CollectionItem.workId`). Editorial asks Library's public Work reference reads whether a Work is public and what it is called now, and never reads Library's tables; Library holds no Collection column, table or code (DOMAIN_MODEL.md §3.2, §7.3) | **`Library → Editorial` is prohibited** — a Collection page composes both at Layer 4 |

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
no-store cache directives and `noindex` (ROUTE_MAP.md §9.5).

### 8.3.1 What a statically rendered page may read

A page in the anonymous public tree is **prerendered at build time**, which constrains its
configuration as well as its data.

- **Only non-secret, build-time configuration.** The build runs in CI and on developer
  machines that hold no production credential, so a prerendered page reads a validated
  **projection** of the server environment containing only the variables it genuinely needs
  — currently the application origin and the indexing posture. It does **not** call the full
  server-environment parser, which correctly refuses a development secret in production and
  would make every build demand credentials it never uses.
- **The projection shares field definitions with the server schema.** Each variable has
  exactly one definition and one validation rule in a non-secret module consumed by both
  schemas. The public import graph never reaches the full secret-bearing server schema.
- **A consequence, recorded rather than discovered later:** a value read this way is fixed at
  build time. Changing the indexing posture is a rebuild and redeploy, which is what the
  launch transition of DELIVERY_PLAN.md Phase 35 already is.

> **This is the configuration counterpart of §8.1.** That rule keeps session state out of the
> cached tree; this one keeps the tree buildable without the secrets a session would need.

#### 8.3.1.1 Not every public page is prerendered

The section above describes the **prerendered** public tree, which was the whole of the public
surface while its content was code — the route registry, the message catalogues. From the first
phase that publishes **data**, the public surface has two kinds of route, and they are
constrained differently.

| | **Prerendered shell route** | **Public content route** |
|---|---|---|
| Content comes from | code, reviewed as code | records an operator changes |
| Rendering | prerendered at build time | rendered per request |
| May read configuration | the non-secret build-time projection only (§8.3.1) | the same projection; the indexing decision stays build-bound |
| May read a database | **no** — the build holds no credential | **yes**, through its owning context's service (§3.1.1) |
| May read session state | **no** | **no** |

**Only the last row is a security rule, and it does not bend.** §8.1 forbids the anonymous
public tree from reading session-derived state — "any per-user record" — and published
editorial content is not that. A content route therefore reads its own domain and **must still
reach no session service, no authorisation service and no authentication library at all**; the
guarantee is enforced as an absence from the module graph rather than as a rule about what the
page calls.

**A content route is dynamic because its data is mutable, not because it is personalised.** A
prerendered copy would keep serving a record that has since been withdrawn, and "unpublished,
staged or draft content is never publicly reachable at all" (ROUTE_MAP.md §9.5) is not a claim
a stale page can honour. Prerendering one would also put a database connection on the build's
critical path, which §8.3.1 exists to prevent.

> Caching such a route is a **later, separate decision** with its own invalidation proof
> (§8.4, DELIVERY_PLAN.md Phase 34). Serving it uncached is correct until then.

### 8.4 Validation

**Cache-leakage tests are a standing exit criterion of every feature phase**: no
session-derived value may appear in a shared cache entry, and no personalised fragment may
be served to a different visitor.

### 8.5 Authoritative state and derived work

Publication has an authoritative half and a derived half, and **conflating them produces a
false reliability claim**.

> **Publication success means one thing: the owning domain's authoritative state committed
> validly in its own database transaction.**

Everything else that publication implies — the **search/FTS projection**, the **route and data
cache**, the **sitemap**, **canonical and `hreflang` metadata**, **redirects**, **email**, and
**external provider effects** — is **derived or external work**. **None of it is atomically
committed with the authoritative transaction**, and no document in this baseline describes it
as though it were. SQL Server FTS in particular is populated asynchronously; claiming synchronous
atomicity would be false and would conceal the staleness window.

**Where correctness depends on that work actually happening**, the authoritative transaction
commits **durable derived-work intent** alongside the domain change, and the work is:

- **observable** — pending, failed and lagging work is visible to an operator;
- **retryable** — safely, idempotently, with bounded retry;
- **reconstructable** — an index or projection can be rebuilt from authoritative state;
- **safe** — failure degrades availability of the derived view, never correctness of the
  authoritative record.

**The security rule that makes staleness survivable:**

> **Private, draft, staged, unpublished or withdrawn content must never become visible because
> a cache or index is stale.** Current publication, visibility and authorisation are enforced
> **before** a sensitive or withdrawn payload is returned, wherever the architecture requires
> such a check. A stale index may omit something; it may never disclose something.

Each lifecycle transition — **publish, unpublish, archive, restore, delete, slug change,
visibility change** — defines its resulting behaviour across the canonical route, listings,
related content, cache, search, sitemap, canonical and alternate metadata, and redirects. The
owning phase delivers and tests that behaviour (DELIVERY_PLAN.md §3).

**Scheduled work** — scheduled publication being the first concrete case (DELIVERY_PLAN.md,
Phase 6) — follows the same discipline: the schedule is **durable and cancellable**, the
executor is **bounded**, **downtime catch-up is defined**, and execution **re-checks current
state, current approval and current authority** before acting, so a superseded approval can
never publish. Retry is safe. **No generic worker platform, queue product or event bus is
introduced because scheduling exists**, and multi-instance execution requires leasing
(§3.5.1).

**No distributed cache infrastructure is added.** This section defines semantics, not new
infrastructure.

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
**No Vercel. No Kubernetes. No Azure platform services in the application architecture** — no
App Service, Azure SQL, Communication Services or other managed runtime the code would depend
on. The developer-controlled pre-adoption **staging** environment runs this same self-hosted
shape on an Azure **virtual machine** by explicit owner decision (§10.6); that is IaaS hosting
of a Linux host, not an application dependency, and production hosting remains open.

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
process exists. **Phase 25 delivered the upgrade seam** — `docker/nginx/templates/default.conf.template`
on `nginx:1.30.6-alpine` pinned by digest, proven in CI. **Phase 28 extended that seam into the
staging front door** — TLS from Let's Encrypt, the environment access gate, whole-site
`X-Robots-Tag` and exact-SHA deployment automation (§10.6). The production edge — the full
security-header set (Phase 33), production TLS, DNS, monitoring and rollback runbooks (Phase 34)
— is not claimed by it.

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
| **Staging** | Production-shaped; migration dry-runs and editorial/religious QA. **Delivered in Phase 28** as a developer-controlled, pre-adoption environment at `https://minhaj.haseebliaqat.me` (§10.6) — distinct from the pre-adoption presentation origin, and not production |
| **Pre-adoption / presentation** | The **same application** on a developer-controlled origin, before official adoption. **Non-indexable**, claims no official adoption, and is **not a reduced build** (PRODUCT_SCOPE.md, *Product status and acceptance*) |
| Production | Live platform on the official origin |

These four are the **complete environment model**, reached in the order Local →
Pre-adoption/presentation → Staging (DELIVERY_PLAN.md Phase 28) → Production. There is **no
separate generic "sandbox" environment or subsystem**; a provider's own sandbox account is
adapter configuration within one of these environments, never a fifth one.

**Staging is delivered as its own foundation milestone before any live-source migration**
(DELIVERY_PLAN.md), not as part of final production hardening. Migration dry-runs and
religious QA must never run against production.

### 10.3 CI

Type check → lint → **architecture boundary rules** → unit and integration tests → build →
E2E on critical paths. Migrations are reviewed and applied deliberately, never automatically
on deploy.

### 10.4 Backups and complete recovery

SQL Server backups with **tested restores**, plus storage volume backups. **A backup that has
never been restored is not a backup.** Production retention and RPO/RTO targets are an open
decision; staging runs an approved interim policy (§10.6).

**Product recovery is not database recovery.** The platform has **two authoritative stores**,
and restoring one of them is a partial recovery that looks complete:

| Category | Examples | Posture |
|---|---|---|
| **Authoritative — SQL** | Domain records · security and permission state · audit · idempotency and deduplication records · durable communication, payment and provider state | Backed up; restored |
| **Authoritative — storage** | PDFs · images · hosted audio · message attachments · other owned files · checksums and storage metadata · quarantine and scan state where authoritative | Backed up; restored |
| **Derived — rebuildable** | Search indexes · caches · rebuildable projections · generated sitemap and metadata | **Rebuilt, not restored** (§8.5) |

> **A successful SQL restore with missing authoritative assets is not a successful platform
> recovery.**

**Conceptual restore ordering** — the order exists so that nothing is exposed or re-fired
before it has been verified:

1. **isolate** the restored environment;
2. **disable unintended outbound and provider side effects**;
3. restore **SQL**;
4. recover required **configuration and key custody**;
5. recreate **least-privilege database login mappings** where needed;
6. restore **authoritative stored assets**;
7. **reconcile asset checksums and references** against the database;
8. **fail closed on uncertain scan or private state** — an asset of unknown status stays
   unreachable;
9. verify **Identity, permission and security state**;
10. verify **privacy, consent and audit state**;
11. **reconcile external provider outcomes before any replay** — a payment already captured or
    an email already delivered is **not** re-executed because a durable intent row looks pending;
12. rebuild **published-only** search projections;
13. rebuild sitemap, cache and other derived state;
14. verify **public and private boundaries**;
15. verify representative **critical workflows**;
16. **deliberately resume schedules**;
17. **deliberately resume traffic and outbound effects**.

**Storage gains no Identity dependency from any of this** — the storage foundation stays
infrastructure, and consuming phases supply the authorisation policy (DELIVERY_PLAN.md, Phase 7).

### 10.5 Handover and portability

Two **technical** handover levels are distinguished, because they are frequently assumed to be
one. **Neither is a commercial document, and no licensing or contractual terms are recorded in
this repository.**

#### 10.5.1 Level A — source and system handover

The recipient organisation's engineers receive enough to operate the system with **their own
accounts**: the repository · the committed lockfile · the environment template · these
architecture documents · database migrations · import and migration tooling · a setup guide ·
a provider inventory · a deployment guide · the backup and restore guide (§10.4) · the admin
bootstrap procedure (SECURITY_BASELINE.md §8.3) · and operational and security notes.

#### 10.5.2 Level B — separately requested implemented deployment

The **same codebase** configured and deployed against adopter-owned official domain, DNS,
infrastructure, database, email, OAuth, payment, storage, monitoring, backup destination and
approved content sources, with authorised migration and cutover executed.

> **Level B is not automatically included in a Level A handover.** They are separate pieces of
> work.

#### 10.5.3 Production ownership and origin portability

- **Adopted production must not depend on personal developer credentials.** Every
  development-time credential is **replaceable and revocable**, and replacing one is a
  configuration change, not a code change.
- Moving to the official origin may require **DNS, TLS, a rebuild, cookie and callback
  configuration, OAuth redirect updates, sender verification and new credentials**.
- It must **never** require rewriting User business records, content records or domain
  relationships. **Origin is configuration; the data model is not.**

> **Build-time versus runtime configuration — stated accurately.** Values inlined into the
> client bundle at build time (anything `NEXT_PUBLIC_`) **do not change because an environment
> variable changed at runtime**; an already-built bundle keeps what it was built with. Origin
> changes that touch client-visible configuration therefore require a **rebuild and redeploy**,
> and this baseline does not claim otherwise.

**One organisation per deployment.** The platform is not multi-tenant, and no white-label or
generic-CMS engine is introduced. A future product reuses this foundation by **forking and
adapting** it — Quran, Hadith, Fatwa authority, the Minhaj information architecture, religious
safeguards and organisation-specific semantics are **not genericised for hypothetical future
clients**.

### 10.6 Staging — delivered in Phase 28

**What it is.** A complete, production-shaped deployment of the platform at
`https://minhaj.haseebliaqat.me`, owned and operated by the developer **before** adoption, for
development, testing, demonstration and acceptance. It is **not production**, it is not the
pre-adoption presentation origin, and it carries no claim of official adoption. Every
infrastructure choice below is an owner decision for this environment only (OPEN_DECISIONS.md
§4.1, §4.2, §4.4); production hosting, licensing, HA/DR and operations remain Phase 34's.

```
Internet ──443/80──▶ Azure VM (Ubuntu 24.04 LTS, x86, Standard_B2as_v2, Central India)
                      │  NSG: 443 + 80 public · 22 from the operator's IP only · all else denied
                      ▼
                    proxy  nginx 1.30.6 (pinned digest) — TLS · environment gate · X-Robots-Tag
                      ├──▶ web       production runtime image, by digest ─┐
                      └──▶ realtime  runtime image, by digest ────────────┤  internal network
                                                                          ├──▶ sqlserver (2022 Developer + FTS)
                                                                          └──▶ clamav (INSTREAM; no storage mount)
                    data disk /srv/minhaj: SQL files · authoritative Storage · releases · TLS
                    off-VM: private Blob container (backups) · private registry (images)
```

**Images.** `docker/web.Dockerfile`'s `runtime` stage is the production web image: `next start`
through the validated start wrapper, production dependencies only, non-root, no tests,
fixtures, docs or `.env`, a health check, and — by design — **built for one origin**, because the
canonical origin and the indexing posture are bound at build time (§10.5.3). `realtime` is the
Phase 25 runtime image unchanged. `docker/ops.Dockerfile` is the **operations image**: the
Prisma CLI and the staging lifecycle commands, never a running service. All three are built by
the staging deploy workflow from one exact commit, pushed to a **private** registry tagged with
the full SHA and deployed **by digest**. Each commit is built **once**: re-deploying it reuses the
digests its exact-SHA tag already names, and that tag is never overwritten. SQL Server is built on the host from the reviewed
`docker/sqlserver/Dockerfile`; Microsoft's, NGINX's and ClamAV's images are never republished.

**Deployment.** `.github/workflows/staging-deploy.yml`, triggered deliberately by the operator
pushing a deploy tag — `staging/deploy/<UTC time>` or `staging/migrate-and-deploy/<UTC time>` —
onto one commit that is the head of a `feature/phase-*` branch and has all five ordinary CI jobs
green. (A tag rather than `workflow_dispatch`, because a dispatchable workflow must exist on the
default branch, which this project does not change.) GitHub
reaches Azure by OIDC federation (no secret); the VM is told what to run through Azure Run
Command (no inbound SSH from GitHub). On the VM, `docker/staging/bin/fetch-release.sh` pulls the
digests with the VM's own identity and extracts that commit's bundle (`docker/staging/` plus the
staging NGINX template and SQL Server Dockerfile) from the operations image; the bundle's
`deploy.sh` proves the host, switches web, realtime and proxy, smoke-tests the real edge and
**restores the previous known-good release** on failure. **Migrations are separate**: they run
only from `bin/migrate.sh`, or when the operator pushes a `migrate-and-deploy` tag, after a backup,
and never at container start. A rollback changes images only; it never reverses a migration.
Nothing at runtime clones source or depends on the repository being public.

**Target guards.** Every mutating operation requires independent proof that the target is this
staging environment — its identity file, the Azure metadata service's resource id and tag, the
data-disk marker, and for SQL the host, database name, server machine name and a database
fingerprint (SECURITY_BASELINE.md §21.5). A database name alone is never enough.

**Recovery is SQL + Storage (§10.4).** `bin/backup.sh` takes, in one set, a checksummed
`BACKUP DATABASE` of `MinhajStaging` and an archive of the authoritative storage root, binds them
in a manifest with SHA-256 for each, and uploads all three to the private Blob container — off
the VM's disks. `bin/restore-proof.sh` downloads a set **from Blob**, verifies it, restores SQL
into a new `MinhajStagingRestore_<hex>` database and Storage into an isolated restore root —
never over the live ones — verifies migration history, schema, least privilege and the synthetic
fixture, proves every durable Asset row's bytes and checksum are present in the restored
Storage, and removes the restored copies. Interim staging policy: **daily, RPO 24 h, RTO 4 h,
14-day retention** (OPEN_DECISIONS.md §4.4). Search projections and caches are rebuilt, not
restored. Each set records the release whose schema it captured, and is proven with that
release's operations image.

**Recovery to service — stated accurately.** Phase 28's tested evidence is the isolated restore
proof above. Restoring a set **as the live database** — after losing the VM or its data disk —
is a documented manual DBA procedure, not yet an automated command: bootstrap the replacement
host with `--environment-id` set to the id in the set's manifest (the restored database's
fingerprint and the Blob prefix both carry it), deploy, restore the SQL backup into
`MinhajStaging` and the Storage archive into the storage root, re-map the runtime and operator
users to their logins (`staging-provision`, then `ALTER USER … WITH LOGIN` for any orphaned
user), and prove the result with `status.sh`. The 4-hour RTO is the owner's interim target for
that procedure; a timed, automated recovery drill belongs to Phase 34.

**Correlated-failure risk — accepted for staging only.** The VM and the Blob backups are in the
same Azure for Students subscription, which is disabled when its credit or term ends. Before the
credit runs out, the term ends, or the project is handed over, the **latest verified set is
exported off the subscription**: the operator downloads the manifest, SQL backup and Storage
archive, verifies their SHA-256 against the manifest, and keeps them in owner-controlled storage
outside Azure. Independent off-site production DR is Phase 34's.

**Seed and reset.** `bin/seed.sh` adds exactly one unmistakably synthetic stored asset, used by
the recovery proof. `bin/reset.sh` is the only destructive operation: an exact,
environment-bound confirmation, a fresh backup first, the full target proof, then database and
storage-root only.

**Migration fixture proof (Phase 29).** `bin/migration-proof.sh` runs `staging-migration-proof` in
the release's exact-SHA operations image after the full staging guard: it writes one disposable
synthetic operator, runs the Phase-29 fixture proof as the runtime principal against a loopback
fixture server inside the container — no legacy host, no DNS, no outbound request — and revokes
the operator's assignment, session and grant afterwards, also on failure (§5.1). Its audit rows
and the archived synthetic Videos stay as the record of what was proved.

**Operating posture.** Deallocated when idle (`az vm deallocate` — an operating-system shutdown
alone still bills compute); the disks, static IP and Blob storage continue to bill while
deallocated. The daily backup timer is persistent, so a run missed while deallocated happens at
the next boot. A Cost Management budget alerts the owner; the subscription's spending limit
stays on.

**Portability.** Nothing above is tied to the developer's accounts: on adoption the same images,
compose file, scripts and backup sets are deployed to adopter-owned infrastructure with new
identities, secrets, registry and DNS (§10.5). The Azure for Students subscription itself is
never transferred.

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
| **Cross-context consistency** | Owner-coordinated, durable, fail-closed — **no generic transaction port** (§3.1.2.1) | Preserves Model A: a blanket "one transaction" rule could only be honoured by laundering database capability |
| **Derived work** | Search, cache, sitemap, email and provider effects are **not** atomic with the authoritative transaction (§8.5) | A reliability claim without a mechanism invites reliance; FTS is asynchronous by nature |
| **Outbound communication** | Originating context owns the event; a shared concern owns the provider; **Resend is the first adapter** (§4.6–§4.6.1) | One sending path, no direct provider calls from business code, and no second auth-token system |
| **Design system** | Staged ownership — minimum in Phase 2, canonical in Phase 4 (§13.1) | Authentication surfaces need a foundation before the public shell exists, without inviting throw-away styling |
| **Horizontal scaling** | **Conditional**, not automatic (§3.5.1) | Statelessness is necessary, not sufficient; cache, storage, config, scheduling and limiting all have to hold |
| **Deployment portability** | One organisation per deployment; origin is configuration (§10.5) | Avoids multi-tenancy and white-labelling that nothing has asked for |

---

## 13. Experience and design system

The platform's presentation is an architectural concern, not a decoration applied at the end.
This section is the contract every routed surface is built against.

**Presentation is replaceable; it is never throw-away.** Routes, pages and components consume
the semantic owners' public contracts and services (Layer 4, §6.1) and hold no domain rule,
authorisation decision or persistence access of their own. A surface can therefore be
redesigned or rebuilt without redesigning a domain, a security control or a schema — and no
surface is built to be discarded.

### 13.1 Staged ownership — one system, delivered in stages

| Stage | Owns |
|---|---|
| **Phase 2** | The **minimum** shared visual and interaction foundation needed by authentication, Account & Security and the initial privileged entry surfaces |
| **Phase 4** | The **canonical broad product design system** and the public shell |
| **Later specialised phases** | Extensions for readers, media, editorial, religious content, learning and administrative complexity |
| **Phase 32** | The assembled UX, accessibility and SEO acceptance pass |

> **There is exactly one design system.** Phase 2 delivers a genuine subset of it, **not
> throw-away styling to be discarded in Phase 4**; Phase 4 extends that subset rather than
> replacing it; later phases extend it again. **No phase forks it**, and no phase re-implements
> a primitive that already exists.

### 13.2 Design tokens

Semantic tokens, never raw values scattered through components: **colour by role** — surfaces,
foreground and muted text, action and accent, error, warning, success, info, border — plus
**spacing**, **radius**, **shadow/elevation** where it earns its place, and **layering** only
where a real stacking problem exists.

> **No arbitrary palette is frozen here.** Brand assets, the colour palette and approved
> typefaces are an organisational input (OPEN_DECISIONS.md §6.4). The **token structure** is
> the architectural decision; the **values** arrive with accepted brand evidence, and the
> structure is what makes substituting them a configuration change.

### 13.3 Typography across three scripts

English, Urdu and Arabic — including **mixed scripts within one page** — with deliberate
decisions on long-form reading, line height, hierarchy, readable measure, loading performance
and **licensing**. Quran-specific typography remains specialised to the Quran phase and is not
generalised into the shared scale (SECURITY_BASELINE.md §16.2).

### 13.4 Component and state contract

The shared inventory: button · link · input · textarea · select/combobox where genuinely
needed · checkbox and radio · form field with help and error · card · alert · badge · tabs ·
breadcrumbs · pagination · table · dialog · drawer/sheet · menus · tooltip only where it is
accessible and useful · toast/status where justified · skeleton · and the **empty, loading,
error and confirmation** states.

**Every interactive component defines every state it can be in:** default · hover ·
**focus-visible** · active · selected · pressed · disabled · destructive · pending ·
submitting · success · error. A state that is undefined is a state that will be invented
inconsistently later.

### 13.5 Responsive layout

Small phone · phone · tablet · laptop · desktop · wide. Fluid layouts with a **maximum reading
measure**, responsive grids, responsive tables, a responsive administrative surface, and
adequate **touch targets**.

**Two absolutes:** **no horizontal overflow at any supported width**, and **RTL correctness at
every breakpoint** — not only at the width a developer happened to check (§9).

### 13.6 Navigation, scroll, focus and motion

**Skip links** · deliberate focus management · sensible sticky behaviour · a real mobile
navigation · **keyboard-operable mega menus** · scroll restoration · predictable anchor
behaviour · **focus restoration when a dialog closes** · scroll locking while it is open · and
no scroll jank.

**Motion is purposeful, subtle and consistent.** `prefers-reduced-motion` support is
**mandatory**, not optional. **No decorative animation on religious content**
(SECURITY_BASELINE.md §16.2), and none of the constant-motion behaviour of a promotional
agency site.

### 13.7 Visual character

**Premium, calm, scholarly, trustworthy, modern, clean and content-first.**

Deliberately avoided: the generic template look · a SaaS-dashboard aesthetic applied
everywhere · gratuitous gradients · excessive glassmorphism · constant animation ·
overwhelming ornament.

### 13.8 Low bandwidth

The audience is global, predominantly mobile and frequently on constrained connections
(PRODUCT_SCOPE.md §5). Image optimisation · responsive images · lazy loading · font
discipline · **Server Components by default** · minimal client JavaScript · stable layout
without shift · bounded lists · route-level loading states · graceful media degradation.

### 13.9 Data scale

**No claim of unlimited scale is made.** The posture is a substantial multilingual corpus, met
by discipline:

bounded queries · bounded page sizes · **deterministic ordering with explicit tie-breakers** ·
relevant indexes · **no whole-corpus filtering in the client** · bounded administrative bulk
actions · **cursor/keyset scans** where appropriate · batched migration and backfill · bounded
memory use · and validation against **representative mixed-script data** with long text and
sparse translation coverage.

> **A phase claims only the scale it has actually exercised.** Foundation work that has not run
> against a large corpus is **not** described as load-proven; large-corpus validation belongs to
> Phases 31 and 34 (DELIVERY_PLAN.md).

### 13.10 Browser testing

**Playwright 1.55.x is introduced in Phase 2**, the first genuinely browser-critical phase,
subject to compatibility proof at introduction (TECH_STACK.md §1.5).

It is introduced there because that phase is the first whose correctness genuinely lives in the
browser: real cookies · session transitions · CSRF and browser behaviour · sign-out ·
verification and reset confirmation · authentication navigation and return paths · the
Account & Security surface · focus and error behaviour · and locale and RTL flows.

**It is not installed before that phase.**
