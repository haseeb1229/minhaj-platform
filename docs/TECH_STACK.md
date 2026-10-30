# Technology Stack — One Minhaj Platform

**Status:** Living canonical baseline for the current accepted repository. Updated in the same
task as any accepted change that directly affects it (DELIVERY_PLAN.md §5.1).
**Origin:** Phase 0A Architecture Freeze, revised after independent architecture audit, and
revised continuously through the delivered phases.
**Document type:** Locked stack decisions and the accepted dependency record. Each dependency is
installed in its owning phase (§1.3, §1.5); the exact resolved versions are in the committed
lockfile, and the "As delivered" notes and §18 inventories record what has been introduced.

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
| Motion · React Hook Form · Tiptap · Cheerio · shadcn/ui source | First genuine use, in the phase that needs them — Tiptap in Phase 6 (§18.1), Cheerio in Phase 29 (§18.6) |

**The policy at every one of those points is identical** (§1.2, §16):

- **no prerelease substitution**
- **no automatic downgrade**
- **no speculative dependency installation**
- a discrepancy means **STOP → investigate → explicit architecture decision**

---

## 2. Locked stack — summary

| Technology | Version | Status | Role | Installed |
|---|---|---|---|---|
| Node.js | **24.22.1 LTS** | LOCKED | Runtime | Phase 0B |
| Next.js | **16.4.2** | LOCKED | Runtime | Phase 0B |
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
| Zod | **4.6.x** | LOCKED | Runtime | Phase 0B |
| React Hook Form | **7.x** | LOCKED | Runtime | **When needed** |
| Tiptap | **3.x** | LOCKED | Runtime | **Phase 6** — first genuine use (§18.1) |
| Socket.IO | **4.8.3** | LOCKED | Runtime | **Phase 25 — realtime runtime** |
| Google Meet | — | LOCKED | Runtime (external) | Live class phase |
| YouTube / Vimeo embeds | — | LOCKED | Runtime (external) | Media phase |
| **Stripe** (sandbox **engineering** `PaymentProvider` adapter — **not a production provider selection**) | HTTPS API, `Stripe-Version: 2026-09-30.endive`; **no SDK** | ENGINEERING ADAPTER behind the abstraction; the production provider stays OPEN (OPEN_DECISIONS.md §5.4) | Runtime (external) | **Phase 27 — Donations** |
| SQL Server Full-Text Search | — | LOCKED | Runtime | Search foundation phase |
| StorageService abstraction | — | LOCKED | Runtime | Storage foundation phase |
| Cheerio (migration HTML parsing; the source fetch boundary is Node's `node:http`/`node:https`/`node:net`, not global `fetch` — §11, §18.6) | **1.2.0** | LOCKED | Development | **Phase 29 — Migration & Provenance** |
| Playwright | **1.55.x** | LOCKED | Development | **Phase 2 — first browser-critical phase** |
| Pino | **10.3.1** | LOCKED | Runtime | Phase 0B |
| Vitest | **4.1.x** | LOCKED | Development | Phase 0B |
| ESLint | **10.x** | LOCKED | Development | Phase 0B |
| Prettier | **3.x** | LOCKED | Development | Phase 0B |
| Docker / Compose | current stable | LOCKED | Infrastructure | Phase 0B (local) |
| NGINX | stable — **1.30.6** (`nginx:1.30.6-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5`) | LOCKED | Infrastructure | **Phase 25** — the `/socket.io/` WebSocket seam; production edge in the deployment phases |
| Linux self-hosting | — | LOCKED | Infrastructure | Deployment phase |

**Ranges vs pins.** Where an `x` appears (TypeScript 5.9.x, Better Auth 1.7.x, Zod 4.6.x,
Motion 13.1.x, next-intl 4.14.x, React Hook Form 7.x, Tiptap 3.x, Playwright 1.55.x, Vitest
4.1.x, ESLint 10.x, Prettier 3.x), the **range is the locked architectural choice** and the
**exact resolved patch is recorded in the committed lockfile**.

---

## 3. Runtime

**Node.js 24.22.1 LTS** — LOCKED.

LTS is required for production: predictable security patching and a defined support window.
Node 24 provides native `fetch` (used by the Donations payment adapter, §18.4), the `node:http`,
`node:https` and `node:net` clients the migration source fetch boundary is built on (§18.6),
modern ECMAScript, and current framework requirements.

The production runtime must match. **Odd-numbered Node releases are never used in
production.**

> **Node.js moved from 24.20.0 to 24.22.1 as a security patch within the locked 24 LTS line**
> (pre-Phase-30 security maintenance, October 2026). 24.22.1 is the Node 24 line's fix in the
> 2026-10-21 Node.js security releases. The official advisory rates four of its fixes High:
> a Brotli decoder out-of-bounds write (CVE-2026-111497), NUL-byte truncation in
> `dns.resolve*`/`dns.reverse` (CVE-2026-105482), and two `tls.checkServerIdentity` IP-form
> confusions (CVE-2026-105483, CVE-2026-106069). It also fixes Medium and Low issues,
> among them CVE-2026-106072 (Medium), where non-canonical IPv4 spellings let a DNS name in
> a certificate authenticate an IP endpoint. (The 24.22.1 release notes group 106069 and
> 106072 under one fix labelled High; the advisory's per-CVE ratings are recorded here.) One
> Minhaj's exposure was low — no application code decompresses Brotli or calls `dns.resolve*`, and the migration fetcher pins its own lookup and requests
> uncompressed bodies — but the runtime moves anyway. Every pin moves together: `engines`,
> the version policy, CI's `NODE_VERSION`, and the web, realtime and operations images
> (`node:24.22.1-bookworm-slim`). No Node 26 or odd-numbered release.

---

## 4. Web application

**Next.js 16.4.2** · **React 19.2.8** · **TypeScript 5.9.x strict** — all LOCKED.

> **Next.js moved from 16.3.3 to 16.3.8 as a security patch within the locked 16.3 line**
> (October 2026): advisories published after 16.3.3 was locked — among them a critical
> remote-code-execution defect in `next/og` (GHSA-vcvr-r3jv-pc5j) and cache-poisoning and
> image-optimisation SSRF defects — are fixed in 16.3.8, and the required `npm audit
> --audit-level=high` gate fails without it. No API, configuration or behaviour change was
> adopted; the flagged transitive packages moved only within their declared ranges.
>
> **Next.js then moved from 16.3.8 to 16.4.2 by explicit owner decision**: Vercel's
> 2026-10-14 security release made every Next.js 16.0.0–16.4.0 unsafe — unauthenticated RCE
> through `use cache` functions returning typed arrays (GHSA-673q-mjm6-r5xr), RCE through SVG
> image optimisation (GHSA-2464-fhr4-w9xw) and a Server Actions denial of service
> (GHSA-p3m5-59mp-jv5r) — with no 16.3.x fix, and 16.4.1 the first patched release. 16.4.2
> is the current stable patch of the 16.4 line. React stays **19.2.8**: the related React
> Server Components advisories affect only the `react-server-dom-*` packages, which this
> repository does not install; the App Router uses the copy Next.js vendors, patched in 16.4.1.
> No 16.4 feature, configuration or behaviour change was adopted.

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

> **Zod moved from the 4.5 line to 4.6.x by explicit owner decision** (pre-Phase-30 security
> maintenance, October 2026). GHSA-mrhx-c7xc-m3w5 (High) lets an oversized array exhaust
> memory while Zod collects one issue per failing element; every release before 4.6.6 is
> affected and there is no 4.5.x backport. Every workspace declares **4.6.7 exactly**, and
> the version policy rejects 4.5.x, 4.7.x, prereleases and any caret that could leave 4.6.
> Better Auth 1.7.4 declares `zod ^4.5.4`, so the family stays compatible. No schema was
> changed and no validation was relaxed.

> **Better Auth patch moved 1.7.4 → 1.7.7** (Phase 30, October 2026). Three Critical advisories
> were published against 1.7.4–1.7.6 after Phase 29 closed: GHSA-r4xp-prcw-77qf (OAuth Proxy
> sign-in as another user), GHSA-965c-763c-88jm (OAuth state usable as a magic link) and
> GHSA-44jh-23m7-hpcf (Drizzle adapter rate limits). None of those features is configured here
> — no OAuth Proxy, no magic link, no Drizzle — but the audit gate fails every Critical, so the
> dependency is patched rather than excepted (SECURITY_BASELINE.md §18.3.1). 1.7.7 is the first
> patch that clears all three; 1.7.5–1.7.7 change no table, column or plugin schema, keep
> `zod ^4.5.4` and `@better-auth/utils` 0.4.2, and the `@better-auth/*` family moves with it
> exactly. The 1.7.x range, the TOTP and email-OTP plugins and the Identity schema are
> unchanged; the Identity proofs re-ran on the new patch.

**Zod 4.6.x** — LOCKED. Every trust boundary — Server Actions, Route Handlers, socket events,
import pipeline, environment configuration validated at startup. Schemas shared via
`packages/contracts`, with **server-side validation always authoritative**.

**React Hook Form 7.x** — LOCKED, **installed when needed**. Only for complex multi-step or
highly interactive forms. **Not forced onto simple server forms**, better served by Server
Actions with progressive enhancement.

**Tiptap 3.x** — LOCKED, **installed when needed** — in Phase 6 (§18.1). **Editorial content
only.** **Religious canonical texts require specialised structured editors with validation and mandatory review
workflows, never arbitrary WYSIWYG editing.** All editor output is sanitised server-side
before storage.

---

## 9. Realtime, live classes, video

**Socket.IO 4.8.3** — LOCKED, **introduced and compatibility-validated in Phase 25**, when the
owning Messaging/realtime work actually introduces it — not in Phase 0B (§1.5).

**Delivered in Phase 25**: `socket.io` 4.8.3 in `apps/realtime` (with `engine.io` 6.6.11 and `ws` 8.21.3
beneath it) and `socket.io-client` 4.8.3 in `apps/web`'s authenticated Messaging pages only — all MIT
licensed, from the npm registry, recorded in the lockfile. Runs in `apps/realtime`; Phase 24 delivered
Messaging without it. WebSocket transport only; connection-state recovery off. **SQL Server is the
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
part of the production security design** — **no scanner was selected or installed in Phase 0A**;
Phase 7 selected ClamAV (§18.2, SECURITY_BASELINE.md §10).

---

## 11. Migration tooling

**The source fetch boundary is Node's `node:http`, `node:https` and `node:net`** — built in, no
dependency. As delivered in Phase 29 (`scripts/migration/safe-fetch.ts`, SECURITY_BASELINE.md
§10.5) it is **not** the global `fetch`: it validates every resolved address, pins the request's
`lookup` to the validated address, which the global `fetch` does not offer, and re-validates every
redirect (§18.6).
**Cheerio 1.2.0** — LOCKED, installed in Phase 29 as a development-only dependency of the
`scripts/migration/` tooling (MIT; it brings parse5, htmlparser2 and undici). Fast and
sufficient for the majority of legacy pages; Phase 29 parses only synthetic fixtures with it.
**Playwright 1.55.x** — LOCKED, **only where JavaScript rendering is genuinely required** and
the source is authorised — never a way around access, authentication or anti-bot controls.
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

**No Vercel. No Kubernetes. No Azure platform services in the application.** The pre-adoption
staging environment (Phase 28, ARCHITECTURE.md §10.6) runs the same locked shape on an Azure
virtual machine — with Azure Blob Storage holding its backups and a private Azure Container
Registry holding its images — by explicit owner decision for that environment only. The code
has no Azure dependency and runs unchanged on any Linux Docker host; production hosting remains
open (OPEN_DECISIONS.md §4.3).

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
| **Azure platform services as application dependencies** (App Service, Azure SQL, Functions, managed identity SDKs in the app, …) | Self-hosted Linux Docker is the architecture. Phase 28 staging uses Azure only as IaaS hosting (a VM, Blob backup storage, a private registry) by owner decision — §13, §18.5 |
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
| **Payment provider SDKs** (Stripe, Safepay, JazzCash or other) | Native `fetch` and `node:crypto` implement the narrow protocol exactly; an SDK would add a dependency and a second HTTP stack for nothing the adapter needs |
| **Card fields, embedded payment iframes, saved instruments** | Checkout is provider-hosted; One Minhaj never sees, proxies or stores a card number, security code, expiry or wallet/bank credential, and no CSP frame source is widened for payment |

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
Node.js 24.22.1 · Next.js 16.4.2 · React 19.2.8 · Tailwind CSS 4.3.3 · shadcn/ui (copied
source) · Motion 13.1.x · next-intl 4.14.x · Prisma ORM 7.10.0 · @prisma/client 7.10.0 ·
**@prisma/adapter-mssql 7.10.0** · Better Auth 1.7.x · **Resend (first `EmailProvider`
adapter)** · Zod 4.6.x · React Hook Form 7.x · Tiptap 3.x · Socket.IO 4.8.3 · Pino 10.3.1
**Infrastructure:** Microsoft SQL Server 2022 · NGINX · Docker · ClamAV · Let's Encrypt
(certbot, staging edge — §18.5)
**External services:** Google OAuth · Google Meet · YouTube / Vimeo

### Development — builds and tests, does not ship
TypeScript 5.9.x · Vitest 4.1.x · Playwright 1.55.x · ESLint 10.x · Prettier 3.x · Cheerio 1.2.0 ·
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
| `sanitize-html` | 2.18.1 | MIT; [source](https://github.com/apostrophecms/sanitize-html). Server-only allowlist sanitisation after schema-validated rendering. |
| `@types/sanitize-html` | 2.16.1 | MIT; [DefinitelyTyped source](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/sanitize-html). Development-only type declarations. |

Only Article/Page authoring imports the Tiptap client island. The supported schema is bounded
paragraphs, headings 2–4, lists, quotations, emphasis/strike and HTTP(S) or internal links.
Images, embeds, raw HTML, scripts and custom styles are refused. Tiptap CSS injection and
unused cursor extensions are disabled; typography uses the shared stylesheet and tokens.
No font, icon, image, religious corpus or third-party content was introduced with this editor.

### 18.2 Phase-7 storage foundation inventory

| Tool | Exact version | Use and provenance |
| --- | --- | --- |
| ClamAV (`clamav/clamav`) | 1.5.2 | GPL-2.0; [Cisco Talos images](https://github.com/Cisco-Talos/clamav-docker), [engine source](https://github.com/Cisco-Talos/clamav). The malware scanner SECURITY_BASELINE.md §10.1 rule 4 requires and defers to "the phase that implements the storage foundation". Self-hosted, Linux, Docker Compose, no paid cloud service and no Azure dependency. Pinned to an exact version tag, never `latest`, matching the `node:24.22.1-bookworm-slim` precedent. |

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

### 18.4 Phase-27 payment sandbox adapter inventory

**SANDBOX ENGINEERING ADAPTER — NOT PRODUCTION PROVIDER SELECTION.** Phase 27 proves the
provider-neutral Donations lifecycle against one real provider sandbox. Which provider, merchant
account, currencies and regions Minhaj uses in production remains OPEN (OPEN_DECISIONS.md §5.4); a
production deployment needs its own adapter decision and an `approved` activation row, and this
choice does not make one.

| Item | Exact version / value | Use and provenance |
| --- | --- | --- |
| Stripe HTTPS API | `Stripe-Version: 2026-09-30.endive` (GA), `https://api.stripe.com`, hosted Checkout on `https://checkout.stripe.com` | Called by `packages/database/src/adapters/donations-stripe` with Node's native `fetch` (bounded timeout, streamed response cap, Zod-validated reads) and `node:crypto` (`Stripe-Signature` HMAC-SHA256 over `t.` + the exact raw body, timing-safe, 300-second tolerance). Used under Stripe's own services terms through a sandbox account the organisation or engineer creates; no Stripe package, SDK or licence-bearing code is vendored. |
| Local Stripe-protocol simulator | repository file `scripts/shared/stripe-simulator.mjs` | Deterministic, loopback-only, synthetic secrets; serves the adapter's subset of the protocol to CI and the browser suite, which never need credentials or internet. |

**Why Stripe and not the preferred candidate.** Safepay was checked first against its current
official material and failed required properties: its official Node SDK verifies webhooks by HMAC
over `JSON.stringify` of the already-parsed `data` object (so verification needs the body parsed
and re-serialised, not the exact bytes), carries no timestamp, compares with `===`, and documents no
refund API. JazzCash publishes no verifiable public developer documentation, signs parsed and sorted
form fields, and its refund API is undocumented. Stripe documents every required property: a
separate sandbox with no financial effect, hosted checkout, raw-byte timestamped signatures with
constant-time comparison, durable event ids, server-side retrieval, full and partial refunds,
idempotency keys retained for 24 hours, and an explicit zero- and three-decimal currency table.

**No npm dependency was introduced.** The live sandbox proof
(`npm run donations:sandbox:proof`) reads credentials only from ignored local configuration and is
never run in CI. The anonymous sandbox it ran against was provisioned with the official **Stripe CLI
1.54.0** (`@stripe/cli`, MIT, installed globally on the engineering workstation — a tool, not a
project dependency), whose `stripe sandbox create` issues a test-mode `rkcs_test_` restricted key that
the adapter accepts in the sandbox environment only, and whose `stripe listen --forward-to` delivered
real signed events to a loopback receiver (SECURITY_BASELINE.md §14).

### 18.5 Phase-28 staging infrastructure inventory

**PRE-ADOPTION STAGING ONLY — NOT A PRODUCTION HOSTING OR LICENSING DECISION.** Every item below
serves the developer-controlled staging environment (ARCHITECTURE.md §10.6). **No npm dependency
was introduced and no locked application version changed.**

| Item | Exact version / value | Use and provenance |
| --- | --- | --- |
| Let's Encrypt client (`certbot/certbot`) | v5.8.0, pinned by digest `sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20` | Apache-2.0; [EFF certbot](https://github.com/certbot/certbot). Staging-host only, run as a one-shot container (`acme` profile) for HTTP-01 webroot issuance and the twice-daily renewal timer. No account e-mail is registered. |
| ClamAV (`clamav/clamav`) | 1.5.2 — the accepted version — now pinned by digest `sha256:1b6443c4a7b456baa1abfaf9796815f8d21e2fb558dbaed5b682fd4552d8b0c3` for staging | As §18.2. Signature updates enabled on staging. A newer 1.5.x exists and is a separate maintenance decision, not part of Phase 28. |
| NGINX | 1.30.6-alpine, the Phase 25 digest unchanged | The staging template (`docker/nginx/staging/`) extends the seam; no upgrade. |
| SQL Server 2022 Developer + FTS | 16.0.4265.3, the §18.3 image, built on the staging host | **Developer edition is permitted for this non-production development, test, demonstration and acceptance environment only.** It is not the production licence (OPEN_DECISIONS.md §4.1). `MSSQL_MEMORY_LIMIT_MB=3072` is the documented SQL Server on Linux setting. |
| Host OS image | Canonical `ubuntu-24_04-lts:server` 24.04.202610160 (x64, Gen2, Trusted Launch) | No Marketplace plan or charge. |
| Host Docker | Docker Engine 29.9.1, Compose plugin v5.6.0, Buildx 0.38.0 (Docker's signed apt repository, key fingerprint `9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88`, versions held) | Container runtime on the staging host. |
| Host tools | `jq`, `openssl`, `curl`, `apache2-utils` (`htpasswd -B`, bcrypt cost 6 — see SECURITY_BASELINE.md §21.1) from Ubuntu's archive | Shell tooling for the staging scripts; the environment credential is hashed on the host. |
| Azure (owner's Azure for Students subscription) | VM `Standard_B2as_v2`, 2 × 64 GiB Standard SSD, one Standard static IPv4, StorageV2 LRS (private `backups` container, 14-day lifecycle), Container Registry **Standard** (the subscription's included 12-month free allocation, ABAC repository permissions), a user-assigned identity with GitHub OIDC federation, a Cost Management budget | IaaS hosting for staging only; the subscription's spending limit stays on and it is never transferred. |
| GitHub Actions used by `staging-deploy.yml` | `actions/checkout` v5.1.0 (`fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09`), `azure/login` v3.1.0 (`a641126d1b8aa4d1fa005f4f92df94a3a4c4c906`) | Pinned by commit SHA in the secret-adjacent deploy workflow; `azure/login` is MIT, [source](https://github.com/Azure/login). |

### 18.6 Phase-29 migration tooling inventory

| Direct dependency | Exact version | Use and provenance |
| --- | --- | --- |
| `cheerio` | 1.2.0 (pinned exactly; version policy) | MIT; [source](https://github.com/cheeriojs/cheerio). **Development-only** (`devDependencies`): the HTML reader of the `scripts/migration/` fixture adapters, never imported by the application. Its notable transitive packages, all development-only in the lockfile: `parse5` 7.3.0 (MIT, the HTML-specification parser the adapters read with source locations), `htmlparser2` 10.1.0 (MIT), `undici` 7.30.1 (MIT), `cheerio-select` 2.1.0 with `css-select` 5.2.2, `css-what` 6.2.2, `nth-check` 2.1.1, `domhandler` 5.0.3, `domutils` 3.2.2 and `entities` (BSD-2-Clause), `encoding-sniffer` 0.2.1 with `iconv-lite` 0.6.3, `whatwg-encoding` 3.1.1 and `whatwg-mimetype` 4.0.0 (MIT), and `boolbase` 1.0.0 (ISC). Phase 29 parsed only synthetic fixtures with it; since Phase 30 it is also the HTML reader of the real authorised-source adapters, which run only as operator tooling (locally, or on staging in the exact-SHA operations image, whose `npm ci` installs development dependencies) — still never imported by the application. |

**No other npm dependency was introduced.** The safe fetch boundary uses Node's `node:http`,
`node:https` and `node:net` — a request whose `lookup` is pinned to the validated address, which the
global `fetch` does not offer — and the synthetic executable export runs in Node's built-in
`node:sqlite`, in memory. Sanitisation reuses the already-locked `sanitize-html` 2.18.1 (§18.1).
**No corpus, dataset or legacy asset was introduced**: every fixture page, export row and asset is
synthetic, written for the proof; the pages and assets are served from loopback under
`*.fixture.invalid`, and the export exists only in memory.

### 18.7 Phase-30 second-factor setup inventory

| Direct dependency | Exact version | Use and provenance |
| --- | --- | --- |
| `qrcode-generator` | 2.0.4 (pinned exactly) | MIT; [source](https://github.com/kazuhikoarase/qrcode-generator). **No transitive dependencies.** Encodes the one-time TOTP provisioning URI as a QR matrix on the account security page (`/my/settings/security`), which the page draws itself as a single SVG path — no raw HTML, no image request, no network. The URI never leaves the page that received it; the same secret is also shown as a grouped typeable key. Added after the first real staging enrolment showed the URI as raw text with no code to scan. |

### 18.8 Phase-30-R brand and imported-picture inventory

**No dependency is added.** No image library, decoder, optimiser, CDN or remote image host: the
pictures are already web-sized, Storage's existing structural pipeline strips their metadata, and
the Next build bundles the brand files.

| Asset | Source and retrieval | Original | Stored copy | Use and rights |
| --- | --- | --- | --- | --- |
| `apps/web/src/shell/brand/mqi-logo.png` — the official logo and wordmark | `https://www.minhaj.org/images/logo.png`, retrieved 2026-10-29 | PNG raster, 444×65 RGBA, 12,424 bytes, SHA-256 `ffbf13f368bb90d01bec27cfcbe4a9c50e0bcd0a5fdf9a07b46c9c4674076ae2` | 11,410 bytes, SHA-256 `3357d2995baff253d7943a782a6cfa1f02996dab6d0b420d31a5aa92c4ad55d1` — only the `tEXt` ("Software: Adobe ImageReady") and `iTXt` (XMP) chunks removed; pixels, dimensions and colours untouched | Header and footer brand lockup of the pre-adoption build, by the owner's authorisation (OPEN_DECISIONS.md §3.7, §6.4). The page states "Minhaj-ul-Quran International. 2026" (its `copyright` meta). Provisional brand evidence, **not** the accepted brand pack; never redrawn, recoloured or re-proportioned |
| `apps/web/src/app/icon.png` — the official favicon | `https://www.minhaj.org/favicon.ico`, retrieved 2026-10-29 (served as an `.ico` name, actually a PNG) | PNG raster, 64×66 RGBA, 10,545 bytes, SHA-256 `41a2138b4b4ecd7a4de081b962a7775ea9a63e3a2771cb1500f1a59ce5d8aee2` | 9,690 bytes, SHA-256 `e68e6b43cfbe41f62bdfd9514ed1350949dd26646ba2a2cc76392b31da5a5bbd` — the same two metadata chunks removed | The App Router icon, same authorisation and status |

Not used: no SVG of the logo is published; a 900×828 crest with an opaque grey background
(minhaj.net, the pages' `og:image`) exists but would need modifying to sit on the header, so it is
not shipped. No official brand stylesheet or guideline was found, so no palette or typeface was
taken from the logo.

**Imported legacy pictures** (lead images, covers, posters, portraits) are not repository files:
each is a stored Storage asset carrying its own per-asset provenance — source URL, source record,
fetch time, evidence and public-copy checksums, media type, measured box, licence claim with the
page's copyright notice as evidence, and the person's rights decision — in
`MigrationAssetProvenance` (MIGRATION_STRATEGY.md §15). On staging after the macro: 461
acquisitions — 222 lead images, 3 portraits, 104 book covers, 63 issue covers and 69 video posters
— each with a metadata-stripped public copy and each decided `public-eligible` by a person; none
left restricted, none of unknown rights cleared (MIGRATION_STRATEGY.md §15.1).
