# Security Baseline — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit
**Document type:** Planning only. No security controls are implemented in this phase.

Security is designed in from the beginning. It is not a hardening pass appended before
launch. **Security controls are exit criteria of every feature phase**; the later hardening
phase is final assurance, not the first time security is implemented.

---

## 1. Threat surfaces

### 1.1 Public web surface

Content injection via imported HTML · XSS through unsanitised legacy content · injection and
denial of service through search parameters · form spam and abuse · malicious embed
parameters · clickjacking · path traversal via locale segment manipulation · **personalised
data leaking into shared caches**.

### 1.2 Authentication surface

Credential stuffing and brute force · user enumeration · automated account creation · email
bombing via verification and reset · reset token leakage and reuse · OAuth state/CSRF
attacks · **account linking abuse** · session fixation and theft · **open redirect via
`returnTo`** · **CSRF on sign-out and every browser-initiated application mutation**.

### 1.3 Authenticated user surface

**Horizontal privilege escalation** — reading another user's bookmarks, notes, history,
progress · **exposure of private Fatwa questions** · unauthorised conversation access ·
message injection and attachment abuse · mass assignment on profile and settings.

### 1.4 Teacher surface

Access to students outside the teacher's current assignment · **messaging a student after an
assignment is revoked** · attendance falsification · **leakage of Google Meet URLs** ·
unauthorised access to teaching resources.

### 1.5 Admin and CMS surface

Unauthorised publication and workflow bypass · **unauthorised modification of Quran, Hadith
or Fatwa** · **Fatwa publication by a non-authorised party — the highest-consequence threat
in the platform** · privilege escalation and self-elevation · account takeover via admin
action · stored XSS through editor payloads · malicious file upload · path traversal ·
content-type confusion.

### 1.6 Migration surface

**Stored XSS from untrusted legacy markup — the single largest injection vector** ·
**stored XSS against administrators viewing raw snapshots** · malicious or oversized imported
assets · **SSRF and DNS rebinding** via operator-supplied source configuration · staged
content leaking publicly · incidental personal data in raw snapshots.

### 1.7 Infrastructure surface

SQL injection · excessive database privilege · unencrypted backups · **unauthenticated socket
connections** · message flooding · cross-conversation leakage · direct object access bypassing
authorisation · header injection · missing security headers · TLS misconfiguration · secrets
in source control, client bundles or logs · **forged webhooks**.

---

## 2. Authentication model

### 2.1 Methods

Google OAuth and email/password via Better Auth 1.7.x, with email verification and password
reset for the credentials path.

**These have separate external prerequisites.** Email/password requires an email provider;
Google sign-in requires **Google OAuth application credentials**. Neither blocks the other, and
the delivery plan gates them separately (Phases 2 and 2G).

**Within the current V1 delivery plan, Google OAuth application credentials are required for
Google sign-in and are not required for the manual Google Meet URL flow** — in which a teacher
pastes a link they created themselves in Google, and the application only validates and stores
a string, never calling a Google API (§11).

**Any future explicitly approved Google API integration — Calendar, Meet or otherwise — will
have its own credential requirements.** Such integrations remain deferred and are out of scope
for V1.

### 2.2 Rules

- **The internal Minhaj User record is authoritative** for identity, roles and application
  state. The identity provider authenticates; it does not own the user.
- **Google sign-in never creates a Minhaj email address.**
- **A User account is not automatically a public Person profile** (DOMAIN_MODEL.md §5.2).
- **Account linking requires verified ownership of the email address.** Unverified
  auto-linking is an account takeover vector.
- Passwords are hashed with a modern memory-hard algorithm — never plaintext, never
  reversible encryption, never a fast hash.
- **Failed sign-in responses are generic and uniform** — never "no such user" versus "wrong
  password".
- Reset tokens are single-use, short-lived, and invalidated on use or password change.
- **Address identity is compared by one defined canonical rule**, applied consistently at
  signup, sign-in, email change, reset and linking, and **uniqueness is enforced by the
  database** so concurrent signups cannot both succeed. **Provider-specific rewriting —
  Gmail-style dot-stripping or plus-tag removal — is not used as a global canonicalisation
  rule**, because applying one provider's behaviour universally merges distinct people's
  accounts (DOMAIN_MODEL.md §4.6).
- **The final usable authentication method cannot be removed**, and **sessions are revoked
  after a high-risk security or privilege change** (§2.3).
- **Account closure does not restore prior grants or private data** on later re-registration,
  and closure is coordinated across semantic owners rather than performed by one context
  reaching into another's data (§19.1).

The complete set of account lifecycle invariants — status, suspension, reactivation, closure,
collision handling and verified email change — is in **DOMAIN_MODEL.md §4.6**.

### 2.3 Sessions

HTTP-only, `Secure`, `SameSite` cookies · server-side session records permitting revocation ·
rotation on privilege change · absolute and idle expiry · sign-out invalidates **server-side**
· users can view and revoke their active sessions.

---

## 3. Authorisation model

### 3.1 Permissions are the single source of truth

There is **one enforcement path**. Code checks granular permissions:

```
can(user, 'fatwa.publish')          ✔ correct
user.role === 'admin'               ✘ prohibited
teacherProfile.canTeach === true    ✘ prohibited
```

**Competing boolean authorisation systems are prohibited.** The prior revision alternated
between profile flags, role names and permissions — three gates that could disagree, with a
high-consequence permission checkable through the weakest representation.

### 3.2 Capability projections

`canTeach`, `canReceiveQuestions`, `canReviewContent` and `canIssueFatwa` are **named
read-only projections** derived from permission grants (DOMAIN_MODEL.md §4.5). They are
presentation and query conveniences. **They are never stored booleans and never an
enforcement path.**

| Projection | Enforced permission |
|---|---|
| `canTeach` | `teaching.perform` |
| `canReceiveQuestions` | `question.receive` |
| `canReviewContent` | `content.review` |
| `canIssueFatwa` | **`fatwa.publish`** |

### 3.3 Profiles grant nothing

> **A profile alone confers no privilege.**

A TeacherProfile is a public description; it is not authorisation. **Teacher approval must
create an auditable RoleAssignment** granting `teaching.perform`. Revocation removes that
assignment and **takes effect immediately**, including in messaging (§12.2).

### 3.4 Enforcement rules

1. **Server-side always.** Client-side checks are presentation only.
2. **Every protected mutation involving an authenticated principal re-checks authorisation
   independently.** Route protection is navigational convenience, not a security boundary.
3. **Default deny.** Absence of a grant is denial.
4. **Ownership is verified at the data layer.** Every personal-data query is scoped to the
   requesting user's identifier — the primary defence against horizontal privilege escalation.
5. **Scoped assignments are evaluated per request**, never cached into the session.
6. **No self-elevation.** `permissions.grant` is required to change permissions, is never
   self-applicable, requires step-up reauthentication, and is audited. **Since Phase 20 this
   covers the bundle route too:** an administrator may narrow a custom role they hold but may not
   add any permission to it — refused inside the transaction against the live assignment, because
   widening one's own role is self-elevation from the next sign-in.

### 3.5 Externally gated permissions — catalogued, bundled into no role (Phase 20)

`question.receive`, `fatwa.answer` and `fatwa.publish` are **externally gated**: which named
individuals hold them is the organisation's decision (OPEN_DECISIONS.md §1.4, §6.3). They are in
the permission catalogue and grantable through the ordinary audited lifecycle — a custom role,
`permissions.grant`, step-up, never self-applicable — but they are **excluded from the protected
Platform Administrator bundle**, which is otherwise every catalogued key. An administrator keeps
the authority to grant them once a holder is named; an administrator is not thereby a triage
officer, answerer or Fatwa publisher. There is no boolean beside the permission and no second
authorisation system. The Phase-20 migration therefore extends no bundle and invalidates no
session, and a database it migrates has **no holder** of any of the three until a real, audited
grant is made.

**Phase 23 adds the fourth: `teaching.perform`** (OPEN_DECISIONS.md §6.3, with §2.1 open). It is
catalogued, externally gated, bundled into no role and held by nobody; and it opens nothing on its own —
a teacher also needs a current typed Course teaching scope, which `learning.classes.administer` makes
only for an account Identity already reports live (DOMAIN_MODEL.md §13.5). The two class keys are
ordinary and bundled.

**Phase 24 adds the fifth and sixth: `messaging.support` and `messaging.moderate`**
(OPEN_DECISIONS.md §6.6). Both are catalogued, externally gated, bundled into no role and held by
nobody, so the migration extends no bundle and invalidates no session. Neither is needed for
ordinary messaging, which a person reaches only through their current relationship
(DOMAIN_MODEL.md §15.6); neither implies the other; and neither can switch Messaging on, which only
the owner-written activation row does.

**Phase 27 adds the seventh: `donations.refund`** (OPEN_DECISIONS.md §5.4). Who may return a
donor's money is the organisation's finance decision, part of the production merchant activation that
stays open, so the key is catalogued, externally gated, bundled into no role and held by nobody.
Moving money is not editing a campaign: the two ordinary Donations keys — `donations.read` (records,
refunds, reconciliation state and export) and `donations.administer` (campaign lifecycle and an
operator's provider re-check) — confer no refund. Every refund also needs a fresh `donation-refund`
step-up (§8.1), and the database re-checks both the live key and the live grant when the refund row is
inserted (§14).

**Phase 29 adds the eighth: `migration.publish`** (OPEN_DECISIONS.md §3.4). Who may put migrated
content into the live platform, take it out again and approve a promotion is the organisation's
decision, so the key is catalogued, externally gated, bundled into no role and held by nobody.
Preparing is not publishing: the two ordinary Migration keys — `migration.read` (every migration
screen and the run-status read; never a raw body) and `migration.administer` (fixture sources, run
cancellation, review, duplicates, mappings, errors, disappearances, asset rights, the audited
raw-evidence reads and disposal, preparing manifests and promotions) — join the Platform
Administrator bundle and confer no publication. Every publish, rollback and promotion approval also
needs a fresh `migration-publication` step-up (§8.1), checked three times: by the Server Action
through Identity's privileged-action gate, by the service re-verifying that exact actor, and by the
database trigger re-checking the live key and the live grant when the manifest or promotion moves.
Migration publication never substitutes for a target's own authority — Media's `media.administer`
still decides a migrated Video — nor for religious review (MIGRATION_STRATEGY.md §8.4).

---

## 4. CMS publishing permissions

**Separation of duties:** creating, reviewing and publishing are distinct permissions. By
default an author cannot approve their own work; exceptions are explicit, granted and
audited — never an implicit consequence of seniority.

**Workflow enforcement is server-side in the domain layer.** No API path, admin route, import
path or bulk operation moves content to published without passing its required review stages.

Permissions are per content type and per action. Broad wildcards are avoided; where they exist
for practical administration, their use is audited.

---

## 5. Religious content safeguards — Quran and Hadith

### 5.1 Quran

1. **Arabic text is immutable in normal operation.** Modification requires
   `quran.editCanonical`, **step-up reauthentication** (§8), a documented authoritative
   source, and a full audit entry.
2. Translation, tafsir, transliteration and recitation are separate works with their own
   permissions — editing a translation never touches the Arabic text.
3. **No AI generation or completion of Quranic text or translation.**
4. Imported content is verified against an authoritative source where available;
   **character-level mismatch blocks import**.
5. **Quran owns Recitation** (DOMAIN_MODEL.md §8.1); Media cannot author a competing record.

**As delivered (Phase 18, engineering — DOMAIN_MODEL.md §8.3).** Rule 1 is a database property,
not only an application check: the application principal holds no INSERT, UPDATE or DELETE on
canonical structure, text, history or verification evidence, and the only canonical writes are
two procedures that re-check — from the authoritative rows, after the service has verified the
Identity-minted actor — a current `quran.editCanonical` assignment of an active role held by an
active account, and an unexpired step-up grant for the dedicated `quran-canonical-edit` purpose
bound to a live session of that account (§8.1). A grant earned for any other purpose authorises
nothing here. The "documented authoritative source" is a registered `QuranSource` that only the
owner/operator principal can create, so the external approval of rule 4 is never equivalent to an
application permission. Rule 4's mismatch blocking is exact: code points in the verifier, UTF-16
bytes in the database, and canonical text is copied from the registered source's own rows only
after the candidate matched them. Layered works carry `quran.administer`, isolated from canonical
text; no `content.*`, `library.*` or `media.*` key confers Quran authority, and no profile does.

### 5.2 Hadith

1. **Text, reference numbers, narrator chains and gradings are sourced data — never inferred,
   generated or assigned by the platform.**
2. Editing requires `hadith.editCanonical` and **step-up reauthentication**.
3. Grading changes are audited with the authorising source recorded.
4. Imported Hadith requires human verification before publication.
5. **Conflicting variants are escalated, never silently resolved.**

**As delivered (Phase 19, engineering — DOMAIN_MODEL.md §9.1).** Rule 2 is a database property, not
only an application check: the application principal holds no INSERT, UPDATE or DELETE on source,
activation, structure, record, history, grading, verification, citation or conflict tables (beyond
display-name versions), and every canonical write is a procedure that re-checks — from the
authoritative rows, after the service has verified the Identity-minted actor — a current
`hadith.editCanonical` assignment of an active role held by an active account, and an unexpired
step-up grant for the dedicated `hadith-canonical-edit` purpose bound to a live session of that
account (§8.1). A grant earned for any other purpose, `quran-canonical-edit` included, authorises
nothing here. Rule 3: every grading belongs to one immutable record version with its grader, label
and published reference, and every version names the evidence it rests on. Rule 4: a citation is
public only while its record carries a human verification of its current version, so a correction
always requires fresh verification. Rule 5: the database records byte-exact conflict evidence between
candidates for one citation, and such a citation can be neither mapped nor published; the platform
has no resolution path (OPEN_DECISIONS.md §1.6). Source systems, editions and activation are
owner/operator-only, so external approval is never equivalent to an application permission, and a
record or layered work is shown only beside an activation of its own source's authority. Layered
records carry `hadith.administer`, isolated from every sourced fact; no `quran.*`, `content.*`,
`library.*` or `media.*` key confers Hadith authority, and no profile does.

### 5.3 Structural safeguard

Religious content is administered through **its own admin surfaces with their own
permissions** (ROUTE_MAP.md §7) — never through the general editorial CMS and never through
an arbitrary WYSIWYG editor. **Tiptap is for editorial content only**; canonical religious
text uses purpose-built structured editors with validation.

---

## 6. Fatwa safeguards

1. **Publication requires `fatwa.publish`, enforced in the domain layer**, with **step-up
   reauthentication**.
2. **Every bypass path is closed:** no direct API, no admin route, **no import path**, no
   bulk operation.
3. **No AI system may issue, draft, generate or publish a Fatwa.** An assistant may at most
   locate and link existing published rulings.
4. **Questions are private personal data.** Access is limited to the asker and explicitly
   authorised personnel. They never appear in listings, search, logs or caches.
5. Publication publishes the ruling with an **anonymised question** — never the asker's
   identity, contact details or personal circumstances without explicit consent.
6. **Published Fatawa are immutable in substance**; corrections create a visible new version.
7. Every publication is audited: who published, when, under which authority.

**As delivered (Phase 20, engineering — DOMAIN_MODEL.md §12.1).** Each rule is a database property,
not only an application check.

- **Rules 1–2.** The application principal holds no INSERT, UPDATE or DELETE on any question,
  ruling, revision, topic, publication, review-decision or tally table. Every write is a procedure
  that re-checks — from the authoritative rows, after the service has asked Identity — the actor's
  live assignment of an active role carrying the one key its stage needs, held by an active account.
  **There is one publication operation** (`FatwaPublishRevision`), reached from one adapter module;
  it re-checks `fatwa.publish`, an unexpired grant for the dedicated **`fatwa-publication`** step-up
  purpose bound to a live session of the same account (§8.1), the service activation, the expected
  version, that the exact revision is the one under review, and that the publisher is neither that
  revision's author nor the asker. No other purpose — `hadith-canonical-edit`,
  `quran-canonical-edit` or `privilege-administration` — authorises it. Withdrawal is the same
  authority. There is no bulk path, no importer and no "publish without review"; a future importer
  must call the same operation.
- **Rule 3.** No language-model, generation or rewriting dependency or code path exists in the
  context, its contract, its adapter, its administration or its public pages, and an architecture
  test keeps it so. Ruling text and the anonymised public question are typed by people and stored
  exactly as typed.
- **Rule 4.** Every question read is scoped in SQL — to its asker, or to the stage that needs it
  now (intake for `question.receive`; the current assignee for `fatwa.answer`; the ruling under
  review for `fatwa.publish`). A revoked or reassigned answerer loses access on the next request.
  Lists never select the text; each detail read that returns it writes a `fatwa.question.accessed`
  audit row naming the stage (§13.2 *Data access*). Owner, intake and administration pages are
  authenticated, `noindex` and dynamic; public pages read no question, set no cookie and are
  shared-cache safe; a question id is opaque and its text is never in a URL.
- **Rule 5.** The public question is a separate field a person writes; nothing redacts, detects names
  in or anonymises text automatically, and no public page, Search document, sitemap or metadata reads
  the original.
- **Rule 6.** Revisions, their topics, publications and review decisions refuse UPDATE and DELETE;
  a published ruling keeps its address and never returns to unpublished; corrections are new
  revisions with a public reason and stay visible on the same URL.
- **Rule 7.** Publication audits publisher, time, the permission and step-up purpose, the step-up
  grant (`authorisingSource`), the question reference and the revision — never text.
- **Fail-closed intake.** Until the operator records an activation, no question is captured and
  nothing can be published, whoever holds which key (OPEN_DECISIONS.md §1.4).

---

## 7. Mutation safety — four distinct protocol security classes

A complete policy, absent from the prior revision, which relied on `SameSite` alone.

**Not every state-changing request is a browser form.** Classifying an authentication callback
or a signed webhook as an ordinary browser POST produces either a false security claim or a
false "CSRF bypass" finding. **Four protocol security classes** are distinguished below — **A**
browser mutations, **B** signed machine callbacks, **C** authentication/OAuth callbacks and
**D** emailed verification and reset links — each with its own authenticity mechanism.

> **Every endpoint and trust boundary requires endpoint-appropriate server-side validation and
> the security controls appropriate to its protocol class.** The four classes are not
> interchangeable, and applying one class's controls to another is an error in both directions.

Two consequences are stated explicitly, because blanket wording gets them wrong:

- **Authorisation** is required wherever an **already-authenticated principal and a protected
  resource or action** are involved. An **authentication-establishing** callback (Class C)
  instead relies on its protocol's authentication and callback guarantees — **requiring a
  logged-in principal in order to complete sign-in would be incoherent.**
- **Zod and application validation apply to application-owned inputs** where appropriate. The
  application does **not** claim to independently re-validate opaque provider or library
  protocol material in a way that would break the configured protocol; that material is
  validated by the protocol implementation itself.

### 7.1 A — Browser-initiated state-changing mutations

Every ordinary application mutation a person triggers from the platform's own UI — Server
Actions and Route Handler mutations alike. **This is where the blanket browser rules belong.**

1. **Server-side authorisation** wherever the operation requires an **authenticated principal**,
   re-checked independently (§3.4). Default deny.
2. **No state-changing GET.** Every Class-A mutation is POST or a Server Action. **Sign-out is a
   POST/action, never a GET route** (ROUTE_MAP.md §2.4).
3. **Origin/Host validation** on every state-changing request; mismatches are rejected.
4. **Framework-appropriate browser CSRF protection**, using the framework's built-in protections
   rather than hand-rolled alternatives.
5. **`SameSite` and session protections where relevant.** `SameSite` is necessary but not
   sufficient — one layer, not the policy.
6. **Route Handler and REST mutations carry explicit anti-CSRF protection** — they do not
   inherit Server Action protections. As implemented (Phase 11), a Route Handler mutation
   requires all of: `POST`; an `Origin` header present and **equal to the configured
   application origin** (not to `Host`, which a proxy rewrites and DNS rebinding controls);
   `Sec-Fetch-Site: same-origin` wherever the browser sends it; and a custom intent header,
   which no HTML form can set and which a cross-origin page could send only after a CORS
   preflight the platform never approves. These are checked before the session is consulted.
7. **Cross-origin requests are rejected by default.**

> **These seven rules are Class-A rules.** They are not blanket-applied to Class B, Class C or
> the emailed-link GET in Class D. A Class-D flow's confirming browser mutation is separately a
> Class-A request and carries these protections (§7.4).

### 7.2 B — Signed machine callbacks and webhooks

Inbound requests from an external system that holds no browser session and sends no browser
Origin — payment webhooks and equivalents (§14).

1. **Signature / authenticity verification before any processing.**
2. **Timestamp / window verification** where the provider supplies one.
3. **Replay prevention** — event-identifier tracking.
4. **Idempotency** — the same event delivered twice produces exactly one effect.
5. **Server-side payload validation**, including verification of the substantive values against
   the provider (§14).

**Class B does NOT require**, and must not be assessed against:

- browser CSRF protection
- an existing logged-in browser principal
- ordinary browser Origin/Host semantics

> **This is a distinct protocol security model, not a CSRF bypass.** Origin validation and
> `SameSite` are meaningless for a caller that is not a browser and holds no session; the
> equivalent guarantee is cryptographic. **A machine callback that skips signature verification
> is the real defect**, because an unsigned webhook endpoint is an unauthenticated one.

### 7.3 C — Authentication and OAuth callbacks

Provider redirects and authentication-library callback routes (`/api/auth/*`, ROUTE_MAP.md §8).

These are secured by **the actual protocol guarantees**, as applicable to the flow:

- **`state`** — binding the callback to the request that began it
- **PKCE** — for authorisation-code flows
- **`nonce`** — for ID-token flows
- **Provider callback validation** — issuer, audience, signature and expiry
- **Verified, pre-registered redirect URI** — never a value taken from request input (§9.3)
- **Linking ownership checks** — account linking requires **verified ownership of the email
  address** (§2.2); unverified auto-linking is an account-takeover vector

**Class C does NOT require an already-authenticated principal.** These endpoints *establish*
authentication; demanding a logged-in user in order to complete sign-in would be incoherent, and
**no blanket browser-form CSRF language is applied where the auth protocol supplies its own
callback security semantics**.

**Class C does still require server-side trust-boundary validation appropriate to the configured
authentication library and protocol** — of the application-owned inputs it handles, and of the
protocol material through the library's own verification path (§7 umbrella).

> **An OAuth or authentication callback is not blindly classified as an ordinary browser POST
> form.** `state` and PKCE are its cross-site-request defence. Applying browser form semantics
> instead would both miss the real threat and mis-report a correct implementation as a bypass.

> **No Better Auth endpoint behaviour is locked here.** The exact callback surface, its
> parameters and its verification steps are established in **Phase 2**, at Better Auth's genuine
> introduction and compatibility validation (TECH_STACK.md §1.5). This section states the
> security properties the flow must exhibit, **not** an implementation contract asserted in
> advance of that proof.

### 7.4 D — Email verification and password-reset links

A link in an email arrives as a **GET**, with no Origin the application controls.

**GET may render:** a confirmation UI · token-status UI (valid, expired, already used) · safe
informational state.

> **GET must not silently perform a protected mutation** where the approved contract requires an
> explicit confirmation action. The consuming mutation — setting the new password, marking an
> address verified — is a **POST/action** carrying the Class-A protections of §7.1.

**Token consumption semantics — the platform's chosen integration contract:**

- Tokens are **single-use and short-lived** (§2.2).
- A token is **consumed at the confirming mutation**, not by the act of rendering the page — so
  a mail scanner or link prefetch cannot burn a user's reset token.
- A completed reset or password change **invalidates outstanding tokens**, and the session rules
  of §2.3 apply.

> **This is the platform's chosen integration contract, subject to Phase 2 compatibility proof.
> It is not a claim that Better Auth itself always behaves this way.** Phase 2 establishes
> whether the configured library and flow can implement this contract without unsafe or custom
> divergence (TECH_STACK.md §1.5).
>
> **If the exact Better Auth mechanism cannot support the approved flow without unsafe or custom
> divergence, Phase 2 STOPS for an explicit architecture decision** (TECH_STACK.md §1.2). The
> contract is not quietly bent to fit, and it is not assumed satisfied before the proof.

**Non-negotiable regardless of the mechanism chosen:** **expired, reused and otherwise invalid
tokens remain unusable**, and say so without revealing whether an account exists (§15.2).

---

## 8. Privileged operations, second factor and step-up authentication

A long-lived session is not sufficient authority to publish a religious ruling. **Two distinct
controls apply, and they are not alternatives:**

- **An enrolled second factor** is required *before a high-consequence capability may be
  exercised at all* (§8.2).
- **Step-up / recent reauthentication** is required *at the moment* a sensitive operation is
  performed, where the operation warrants it (§8.1).

### 8.1 Operations requiring step-up

| Operation | Permission |
|---|---|
| Permission and role grants | `permissions.grant` |
| **Canonical Quran edits** | `quran.editCanonical` |
| **Canonical Hadith edits** | `hadith.editCanonical` |
| **Fatwa publication** | `fatwa.publish` — dedicated purpose `fatwa-publication` since Phase 20, also required to withdraw a published ruling |
| **Donation refund** | `donations.refund` — dedicated purpose `donation-refund` since Phase 27, required for every full or partial refund and re-checked by the database |
| **Migration publication** | `migration.publish` — dedicated purpose `migration-publication` since Phase 29, required to publish a manifest, roll one back and approve a promotion; checked by the action, re-verified by the service and re-checked by the database |
| User account administration | Admin permissions |
| Destructive bulk operations | Admin permissions |

Recent-reauthentication windows are short and configurable. **This requirement does not block
Phase 0B scaffolding**; it is a production requirement documented now so it is designed in
rather than retrofitted.

### 8.2 Privileged multi-factor authentication — a V1 production requirement, precisely scoped

> **High-consequence privileged capabilities require an enrolled second factor before those
> capabilities may be exercised.**

This covers **permission and grant administration** · **sensitive account-security
administration** · **the first and other privileged administrator functions** · **canonical
Quran authority operations** · **canonical Hadith authority operations** · **Fatwa
publication** · and **equivalent high-consequence religious publishing or privilege and
security operations**.

**It is deliberately not universal.**

- **General-user MFA is not mandatory in V1.** A visitor who bookmarks an ayah is not an
  administrator, and requiring a second factor of everyone because the library supports one
  would add friction with no matching risk.
- **Passkeys remain an optional future**, not a V1 commitment.
- **SMS-based MFA is not introduced by this baseline.**

**Preferred V1 privileged mechanism: TOTP plus single-use recovery / backup codes** — **subject
to actual Phase-2 proof** of compatibility with Better Auth 1.7.x, Prisma 7.10.0, SQL Server and
the accepted Identity schema.

> **No Better Auth API, plugin, schema, session or recovery behaviour is asserted here.** The
> exact storage, encryption, schema, plugin surface, session behaviour and recovery API are
> established at that phase's compatibility proof (TECH_STACK.md §1.5). This section states the
> **security properties the mechanism must exhibit**, not an implementation contract claimed in
> advance of evidence.

**Recovery and security invariants — independent of the mechanism chosen:**

- **Recovery and backup codes are authentication secrets**, handled as such.
- **Backup codes are single-use**, and **regeneration invalidates every prior code**.
- **TOTP secrets are sensitive secrets.**
- **Neither backup codes nor TOTP secrets are ever logged** (§19.2).
- Recovery material is **never persisted or handled casually by application code**. Plaintext
  recovery material is shown **only** through the compatibility-proven flow, and **only** at an
  appropriate authenticated setup or regeneration moment.
- **No administrator or helpdesk action may silently disable a second factor to restore
  privileged access.** Privileged recovery requires an **explicit, audited recovery procedure**.
- If the chosen version offers a **"trusted device"** feature, it **must not bypass required
  step-up authentication** for high-consequence operations.
- **Recovery must never create a permanent password-only privileged bypass.**
- **No hidden master factor. No permanent break-glass account.**

### 8.3 Initial privileged operator bootstrap

A system with no administrator cannot grant the first permission, and the usual answers — a
seeded superuser, a hard-coded credential, an open setup endpoint — are each a standing
vulnerability.

**The bootstrap is:**

- **controlled** and **one-time**;
- **race-safe**, so concurrent attempts cannot produce two initial operators;
- **audited**;
- **unavailable after successful initial provisioning** — it stops existing as a usable path.

**It is never:**

- ✘ a **public, permanently open** bootstrap endpoint;
- ✘ a **hard-coded admin identity** or **hard-coded master credential**;
- ✘ a **secret committed to the repository** (§18.1);
- ✘ a route to **self-elevation** (§3.4).

**After bootstrap, all privilege changes use the normal Permission and RoleAssignment path**
(DOMAIN_MODEL.md §4.4).

**The initial privileged operator may be provisioned before enrolling a second factor, but
cannot exercise protected high-consequence capabilities until the required second factor and
recovery setup are complete** (§8.2).

**Lockout recovery does not create a universal bypass.** It is an explicit, audited procedure
for a named account, not a mode the system can be put into.

Phase 2 owns the concrete mechanism; **Phase 33 independently re-assures it**
(DELIVERY_PLAN.md).

---

## 9. Input validation, output encoding and redirects

### 9.1 Validation

**Zod 4.6.x at every trust boundary** — Server Actions, Route Handlers, socket events, the
import pipeline, environment configuration. **Server-side validation of application-owned inputs
is mandatory and independent**; client validation is a UX affordance with no security value.

**Opaque provider and library protocol material is validated by its protocol implementation**,
not re-parsed by the application in a way that would break the configured protocol (§7). The
requirement is endpoint-appropriate validation, not a uniform re-implementation of every
protocol.

**Allowlist, not denylist.** **No mass assignment** — explicitly pick permitted fields.
**Parameterised queries only.** Type, size and range limits on every field.

### 9.2 Output encoding

React escapes by default. `dangerouslySetInnerHTML` is **prohibited except for sanitised
rich-text content**, and every use is reviewed. All rendered HTML — editorial or imported —
passes **server-side sanitisation with a tag and attribute allowlist**.

### 9.3 Safe redirects

Open redirects enable phishing under Minhaj's trusted domain — a particular reputational risk
for a religious organisation.

`returnTo` and equivalents are **validated against an allowlist of internal paths**; absolute
and protocol-relative URLs (`//evil.example`) are rejected; only same-origin relative paths
are permitted; invalid values fall back to a safe default. **Legacy 301 targets resolve only
from the internal mapping table**, never from user input.

**Stored outbound addresses** (Phase 9 citations, Phase 13 media-coverage sources) are parsed
on write by the platform's URL parser and kept only when absolute HTTPS without credentials, in
their normalised form, with a database CHECK behind the validator. They render as described
links a visitor chooses to follow (`rel="external noopener noreferrer"`, marked as leaving the
site) — never a redirect through the platform, an embed, a preload or a server-side fetch — so
an outlet's downtime never breaks the page that names it.

---

## 10. Uploads, attachments and imported binaries

### 10.1 Untrusted uploads

1. **Validate declared type and size.**
2. **Sniff actual content** — never trust the extension or client-supplied MIME type.
3. **Quarantine before publication or access.** An uploaded file is not reachable by any
   user until it clears validation and scanning.
4. **Malware scanning is part of the production security design.** Content sniffing and
   extension checks alone are insufficient.
5. **Storage keys are generated server-side** — never derived from a user-supplied filename.
6. Stored outside the web root and served through **authorisation-checking routes**.
7. Checksum stored. Archives and executables rejected by default.

**No malware scanner is selected or installed in Phase 0A.** Provider and tool selection occur
in the phase that implements the storage foundation.

**Selected in Phase 7: ClamAV (`clamd`), pinned to an exact version** (TECH_STACK.md §18.2). It
runs as a Compose sidecar and is reached over its socket with `INSTREAM`, so the scanner is never
given access to the storage root.

**Scanning is fail closed.** A scanner that is unreachable, unresponsive or unintelligible leaves
the upload quarantined; none of those outcomes is a pass. Retries are bounded and apply only to a
transient unavailability — an `infected` or `unscannable` verdict is an answer, not a failure to
retry. A clearance names the CHECKSUM it cleared, so bytes that changed after the scan do not
inherit the verdict, and a scan that did not transfer the whole file never yields a clean result.

**An asset is servable only in the `clean` state**, and the database enforces what `clean`
requires: a CHECK constraint refuses any row that claims it without a media type, a byte size and
a checksum. That holds against any writer, not only the application.

**Phase 7 delivers the serving MECHANISM, default-deny, and no policy.** The route takes an
injected allow/deny decision and treats anything that is not an explicit `allow` — including a
throw or a malformed answer — as a denial. It reads the asset identifier from the path and
nothing else from the request, so no query parameter, header, cookie or filename can influence
it. Each Identity-aware consuming phase supplies and tests its own policy.

**Phase 8 (Library) is the first consumer.** It serves Edition bytes on its own routes and
both halves must allow: Library's decision (public Work and Edition, the asset being the one
recorded for that exact purpose, the reading or download decision permitting it) and
Storage's technical decision (clean custody, matching checksum, bytes present). A privileged
preview requires a live `library.administer` and still only serves an asset already recorded
against that Edition.

**Browser uploads are bounded by the Server Action transport.** A Server Action body is capped
by the framework (1 MB by default) and that cap is **global** — it also bounds the anonymous
correspondence action. It is **not** raised to admit large files: doing so would enlarge what
every public action must accept before it can refuse. Browser-attached edition files are
therefore limited accordingly, and large files enter through the authorised migration pipeline
(Phase 30), which writes through `StorageService` directly. A dedicated streaming upload route
with explicit Class-A anti-CSRF protection (§7.1 rule 6) is the path when a phase needs large
browser uploads; it is a decision for that phase, not a default. Uploads are rate limited per
account (§15.2).

**Phase 11 (Media audio) is the first such route**, `POST /api/admin/media/audio/{id}/asset`.
It applies §7.1's checks, then a live `media.administer`, a per-account upload budget and a
declared length bounded before any byte is read; the body is streamed into `StorageService`,
which bounds it again while writing and never buffers it. The browser's declared type and
filename can only refuse or display, never admit. Only a `clean` result is attached, under the
track's expected version; anything the scanner could not clear stays quarantined and
unreferenced. Both halves must allow before a track's bytes are served — Media's policy (the
exact asset recorded on a published track, or a live administrator's preview) and Storage's
custody — and a `Range` request is decided identically, after both. Responses are
`private, no-store`, `nosniff` and `Cross-Origin-Resource-Policy: same-origin`.

**Phase 12 (Media photographs) uses the same route pattern**,
`POST /api/admin/media/photos/{id}/asset`, with its own upload budget. Its policy admits only
JPEG and PNG — never SVG, an active document — and Storage refuses a malformed or truncated
image and a header declaring more than the pixel bound, and removes hidden metadata (location,
device, owner, embedded thumbnails, trailing data) before the bytes are measured, scanned or
served (ARCHITECTURE.md §4.2). Public images are `private, no-cache` with the checksum as their
validator, and a `304` is sent only after both allows, so withdrawal takes effect for a browser
that already holds the image; previews are `private, no-store`.

**Phase 24 (Messaging attachments)** is the first consumer that RELEASES what it stores. Uploads
arrive at `POST /api/messaging/conversations/{id}/attachments` by the same streamed Class-A pattern —
origin, intent header, session, the conversation's CURRENT send authority, a per-account budget and
a declared length of at most 5 MiB, all before any byte is read. The policy admits JPEG and PNG
(Phase 12's image validation and metadata removal) and PDF only, at most four per message. Before
storing, Messaging records the upload with a 256-bit release token; Storage keeps only its SHA-256
(`Asset.releaseDigest`). `StorageService.release(token)` withdraws that asset from service, removes
its bytes and then its record — **an asset id alone releases nothing**, so no consumer can release
another's asset, and every asset stored without a token stays unreleasable. Rejected and uncleared
uploads are released at once; an upload never sent is released by a bounded sweep after 24 hours,
which also closes the crash window between storing and recording. Bytes are served at
`/assets/messaging/attachments/{id}` (participants), `/assets/messaging/support/{id}` (live
`messaging.support`, audited) and `/assets/messaging/evidence/{reportId}/{id}` (live
`messaging.moderate`, inside that report's evidence only, audited). Each request re-decides
Messaging's access NOW and Storage's custody; images are `inline`, PDFs `attachment`; every response
is `private, no-store`, `nosniff`, `Cross-Origin-Resource-Policy: same-origin` and `noindex`, and
every denial is the same 404.

### 10.2 Imported HTML — the largest injection vector

Legacy content is **untrusted input**, regardless of Minhaj owning the source site. Those
sites were built by third parties over many years and may contain injected or compromised
markup.

Every imported HTML fragment is **sanitised server-side at the normalisation stage, before
staging**, with a strict allowlist: no `<script>`, no `<iframe>` except explicitly allowed
video providers, no event handlers, no `javascript:` URLs, no behavioural styles, no
`<object>`, `<embed>` or `<form>`.

**Sanitisation happens before storage, not at render time.** Storing raw markup and sanitising
on output means one missed render path becomes a stored XSS.

### 10.3 Raw snapshots render inertly

Preserved raw snapshots are deliberately **never sanitised** — they are the immutable
evidentiary record (DOMAIN_MODEL.md §16.1). They must therefore **never be rendered as live
HTML anywhere**, including admin tooling.

> **Raw material is displayed only as escaped text or as a sandboxed download.**

Restricted admin access is not a defence: rendering attacker-controlled legacy markup to an
administrator is stored XSS against the highest-privileged user in the system.

### 10.4 Imported binary assets

Risk-appropriate validation and scanning before publication: type and size validation, content
sniffing, checksum verification, and malware scanning consistent with §10.1.

### 10.5 As delivered (Phase 29) — the migration framework, over fixtures only

Every Phase-29 source is a `fixture` source on `*.fixture.invalid` hosts (DOMAIN_MODEL.md §16.5).
The controls below are built for authorised sources and proven against the fixtures.

- **SSRF and DNS rebinding.** `scripts/migration/safe-fetch.ts` checks, in order: the URL before any
  network activity (`http`/`https` only, no `user:password@`, no literal IP host, the host EXACTLY one
  of the source's hosts — no suffix or subdomain match — and only the scheme's default port); then
  resolution through an injected resolver, where **every** returned address must pass the address
  policy (one public and one private answer is refused outright); then a connection **pinned to the
  validated address** through a `lookup` that can answer nothing else, so the name is never
  re-resolved between check and connect. Redirects are never followed by the transport: each
  `Location` goes through all three checks again, up to the source's `maxRedirects`. For an
  authorised source only `public` addresses pass; loopback, private, link-local, cloud metadata
  (`169.254.169.254`, `fd00:ec2::254`), shared, reserved, multicast, unspecified, documentation and
  unparseable addresses are refused, and IPv4-mapped, IPv4-compatible and NAT64 (`64:ff9b::/96`) IPv6
  addresses are judged by the IPv4 address they carry. One deadline covers the whole exchange; the
  body is capped by the source's `maxBodyBytes` and the connection destroyed at the cap; only
  allowlisted provenance headers are kept; no cookie, credential or authorisation header is sent;
  the User-Agent is honest and identifying. In fixture mode the resolver answers only
  `*.fixture.invalid`, the address policy admits only the loopback fixture endpoint, and the
  connector refuses any other target — three independent refusals of a real host.
- **Retry classification.** Only `408`, `429`, `500`, `502`, `503`, `504`, network failures and
  timeouts are retried, within the source's `maxAttempts`. `401`/`403` are `access-denied` — never
  retried and never retry-eligible, in the service and by CHECK; `404` is `not-found`, `410` `gone`,
  any other `4xx` `client-error`; a policy refusal (scope, address, redirect, size) is final. A valid
  `Retry-After` (delta-seconds or IMF-fixdate) is respected; one beyond 300 seconds defers the item
  (`nextAttemptAt`) instead of holding the run; a malformed, past or absurd (over a day) value falls
  back to exponential backoff with jitter (500 ms base, 30 s cap). `minIntervalMs` separates requests
  to a source. Every wait goes through injected clocks, so the policy is proven deterministically.
- **Sanitisation before staging** (§10.2). Normalisation runs `sanitize-html` with an allowlist of
  `p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `blockquote` and `a` with an `http`/`https` or
  site-relative `href` and a forced `rel="noopener noreferrer"`; `script`, `style`, `iframe`,
  `object`, `embed`, `form`, `svg`, `math`, `noscript`, `template`, `meta`, `link`, `textarea`,
  `select`, `option`, `title` and `head` are discarded with their contents. Links are judged by the URL
  parser, as a browser would resolve them. The staged payload stores only the sanitised result; the
  raw snapshot keeps the exact bytes.
- **Raw evidence is inert** (§10.3). A snapshot is never rendered as HTML: an administrator may ask
  for an escaped-text preview of at most 64 KiB, rendered as React-escaped text, or download it from
  `GET /api/admin/migration/snapshots/{id}` with `Content-Type: application/octet-stream`,
  `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox; default-src 'none'` (also declared in `next.config.ts`, because a
  configuration header would otherwise override the handler's) and `Cache-Control: private,
  no-store`. Both need `migration.administer`; **every read is audited** in the same transaction as
  the read itself (`migration.snapshot.read`, with purpose and byte counts). The route refuses a
  cross-site Fetch-Metadata request first, and every refusal is the same empty 404. A legacy address
  is shown as text, never a link. **Disposal** removes only the body, for a stated reason, and is
  audited (`migration.snapshot.disposed`); metadata and checksum remain.
- **Staged isolation.** Staged records are reachable only under `/admin/migration` (`migration.read`;
  the subtree is `noindex, nofollow` and per request) — no public route, public API, sitemap segment
  or Search kind reads one. `/api/admin/migration/*` answers GET reads only; every mutation is a
  Class-A Server Action that re-resolves the session and re-checks its key (§7.1).
- **Imported assets** go through the Storage foundation's custody — sniffed, size-capped (still
  images and PDFs, 8 MiB), quarantined, scanned and cleared against the checksum scanned — and are
  stored exactly as fetched. No route serves a migrated asset.
- **Audit.** Every operator act writes its audit row in the same transaction: `migration.source.*`,
  `migration.run.*` (started, resumed, completed, cancelled), `migration.staged.reviewed`,
  `migration.duplicate.decided`, `migration.topic-mapping.decided`, `migration.legacy-mapping.decided`,
  `migration.error.decided`, `migration.record.classified`, `migration.rights.decided`,
  `migration.snapshot.read`, `migration.snapshot.disposed`, `migration.manifest.*` (created,
  discarded, publication started, each entry published or refused, published, rollback started,
  each entry rolled back or rollback-refused, rolled back) and `migration.promotion.*` (created,
  approved, withdrawn, completed). Rows carry identifiers and states only — never a body, payload,
  URL, header value, note or personal detail (§13.4). A refusal names a category, never content.
- **Incidental personal data** is flagged and redacted before staging (§19.1.8).

No `authorised` source exists, so no real response, page, asset or personal data has entered the
system; activating one is Phase 30's and requires written authorisation per source
(OPEN_DECISIONS.md §3.1).

---

## 11. Live class and meeting URL security

| Requirement | Rule |
|---|---|
| Provider consistency | `meetingProvider` and `meetingUrl` **must be consistent**; a mismatch is rejected |
| URL allowlist | For the Google Meet provider, **only HTTPS `meet.google.com` URLs are accepted** |
| Disclosure | Meeting URLs are exposed **only to authorised participants and administrators** |
| Caching | **Never placed in public caches** — they appear only on private-cached authenticated pages |
| Logging | **Not logged unnecessarily**; excluded from general application logs |
| Automation | **Google Meet creation is not automated in the V1 foundation** |

**As delivered (Phase 23).** The provider abstraction accepts exactly one provider and canonicalises
an address by the standard URL parser after refusing a backslash or percent escape in the raw text:
HTTPS, hostname exactly `meet.google.com`, a meeting code as the whole path, no credential, port,
query or fragment; the database CHECK repeats the shape, requires the provider beside the address and
forces the address to NULL once the session is completed or cancelled. **Disclosure is one operation
per surface** — the session's current teacher, a current participant (a confirmed trial Booking or a
current Enrolment on a published Course), or `learning.classes.read` — and only while live learning is
activated and the session is scheduled; a revoked or replaced teacher, a cancelled Booking or a
withdrawn Enrolment closes it on the next request. The address is in no list, log, audit row, export
or email: service mail links to the person's own private class page. The platform calls no Google API
and holds no Google credential (OPEN_DECISIONS.md §5.2, §5.3).

---

## 12. Messaging security

### 12.1 Single ownership

All authorisation and mutation invariants are **owned by the Messaging context**. Its
application services are **hosted and exported through `packages/server-core`** so the web and
realtime processes call one implementation — that package is a **server-only host, not an
owner** (ARCHITECTURE.md §3.1). **The realtime process never accesses the database directly
and never reimplements a rule.**

**`packages/server-core` is server-only and is never imported into a client bundle** —
enforced by lint, because shipping server authorisation code to the browser would expose
internal logic and invite client-side trust.

**A hosted service never returns raw persistence capability to its caller.** It persists
internally through its own context's persistence port (ARCHITECTURE.md §3.1.1). The realtime
process may invoke such a service; it **never acquires a Prisma client, delegate, transaction
handle, raw-query facility or persistence adapter**, directly or through any intermediate
package (ARCHITECTURE.md §3.1.2). **Invoking a service that persists is not holding database
access**, and no wrapper may launder one into the other.

### 12.2 Current relationship, not historical membership

> **Every authorisation check validates the currently allowed relationship, not merely
> historical conversation membership.**

Participant membership is not authorisation, because relationships end.

| Conversation | Re-checked on conversation creation **and every send and event** |
|---|---|
| Student ↔ teacher | The teacher **still** holds a current, valid assignment where policy requires it |
| Student ↔ student | The relationship **currently** satisfies the approved course/class/community policy |
| Support | The staff participant **currently** holds the support permission |

**Required negative tests:** unrelated teacher · **former teacher** · **revoked assignment** ·
blocked user · unauthorised student · **removed class/course membership**.

### 12.3 Safety controls

**Block** — a blocked pair cannot initiate or continue a conversation. **Report** — any
participant may report a message or conversation. **Moderation** — first-class state;
**moderation evidence access is restricted to authorised moderators and audited**.
**Attachment retention** — defined retention and disposal policy. **Student ↔ student is
disabled by default** pending policy approval.

### 12.4 Transport security

Socket connections **authenticated at handshake** — no anonymous connections. **Authorisation
re-checked on every event.** **Conversation membership and current relationship verified
server-side before any delivery.** Per-connection rate limiting. Payload size limits. All
socket input Zod-validated. **Typing state is ephemeral and never persisted.** (Phase 25; Phase
24 has no socket.)

### 12.5 As delivered (Phase 24)

- **One decision, every request.** The Messaging service hosted in `server-core` decides each
  list, open, history page, catch-up, send, read mark, report, upload and attachment byte request
  from the kind's activation and the CURRENT relationship (Learning's two halves), the requester's
  own conversation, or a live `messaging.support`. Participant rows are history: a revoked teacher,
  an ended scope and a withdrawn learner are refused on the next request, history and attachments
  included. A non-participant, an inactive kind and a missing id are refused identically.
- **Fail closed.** No `MessagingActivation` row exists; the runtime can read the table and never
  write it. Student-to-student stays off behind a peer policy that denies every pair.
- **Block and report.** A block in either direction stops starting and continuing a direct
  conversation, decided again under the conversation's lock so a racing send cannot slip past.
  Only a current participant reports, with a controlled reason; one open report per target.
- **Evidence is bounded.** A moderator reads only the window one report authorises; a moderation
  decision is immutable, withholds without editing, and suspends nobody.
- **Audit.** Opening support content or history, opening a support attachment, claiming and
  resolving, and every moderation-evidence read and decision record an audit row of identifiers and
  states — never a body, a filename or a token. Ordinary messages are not audited.
- **Class-A.** Every person, teacher and operator mutation is an Origin-protected Server Action
  or a same-origin, intent-headed Route Handler that re-resolves the session; reads of catch-up are
  Fetch-Metadata-guarded GETs; no state changes on GET. Starting, sending, uploading, opening
  support, reporting, blocking, staff reads and moderation are rate-limited per account on the
  single-instance limiter (§15; no cross-instance claim is made).

---

### 12.6 As delivered (Phase 25)

- **Handshake.** WebSocket transport only. The `Origin` must equal the canonical application origin
  exactly — a missing or other origin is refused even with a valid cookie, which is the Cross-Site
  WebSocket Hijacking defence. The person is the session the browser's own cookie resolves through
  the SAME `SessionService`; query strings and Socket.IO auth payloads never authenticate, and no
  token is issued for the socket. Disabled, suspended and closed accounts are refused.
- **Every event, now.** Strict Zod parse, a per-connection budget, then the session re-resolved for
  the same active account — or the event is refused and the socket disconnected — then the Messaging
  service decides. Nothing about authority is cached for a connection's lifetime.
- **Every outbound event, now.** Before a message, presence or typing frame reaches a socket, that
  socket's session is re-resolved and Messaging decides for THAT recipient (the message is read from
  SQL for them). Room membership grants nothing; a revoked teacher, a withdrawn learner, a blocked
  pair, a closed or moderated conversation and a revoked support key receive nothing new.
- **Bounds.** Frames are capped at 64 KiB — no attachment bytes travel the socket — with 20
  subscriptions and per-event budgets per connection, on the single instance (no cross-instance
  claim). Unknown events are ignored; malformed input never reaches a service.
- **Privacy.** Presence and typing are process memory only, never persisted, logged or audited;
  typing carries no text. Logs carry operation, outcome and a correlation id — never a cookie,
  header, token, body or name. Support staff do not use the socket, so their audited access remains
  the only one.
- **Proxy.** NGINX proxies only the canonical host, sets Host and forwarding headers itself and
  clears client-supplied `X-Forwarded-Host`/`Forwarded`; the socket path is GET-only and uncached.

## 13. Audit requirements

Audit logging is a **domain requirement**, distinct from application logging.

### 13.1 Realistic integrity baseline

The prior revision claimed the audit log was "tamper-evident" without defining a mechanism.
A claim without a mechanism is worse than no claim, because it invites reliance. **That claim
is withdrawn** in favour of a production baseline that is actually implementable:

1. **Append-oriented audit records** — the application inserts; it never updates or deletes.
2. **Restricted mutation permissions** — the application database account holds no UPDATE or
   DELETE rights on audit tables.
3. **Sensitive administrative actions are audited** (§13.2).
4. **Defined retention policy.**
5. **Controlled export and backup** of audit data.

**Cryptographic hash chaining or signing may be considered later if a specific requirement
justifies it.** It is not mandated for V1 merely because a review suggested it — an
unimplemented cryptographic scheme provides no protection, while restricted permissions and
append-only discipline provide real protection today.

### 13.2 Audited events

| Category | Events |
|---|---|
| **Religious content** | Every create, edit, publish, unpublish and delete of Quran, Hadith and Fatwa records — with before and after state |
| **Fatwa publication** | Publisher, timestamp, authority, question reference |
| **Permissions** | Every grant, revocation and role change, with actor |
| **Teacher approval** | RoleAssignment creation and revocation |
| **Authentication** | Sign-in success and failure, password change, reset, account linking, session revocation, **step-up challenges** |
| **Content publishing** | Publication and unpublication across all types |
| **User management** | Creation, suspension, deletion, email change |
| **Migration** | Import runs, approvals, merges, **publications and rollbacks** — since Phase 29 every operator act, each manifest entry's publication and rollback, promotions, and every raw-snapshot read and disposal, by identifier and state (§10.5) |
| **Administrative** | Configuration changes, bulk operations, redirect changes |
| **Data access** | Access to private Fatwa questions, student personal data, **moderation evidence**, and **membership applications and member lists** (Phase 26) |
| **Membership** | Type creation, edit, publication and archiving; the start of review; approval and rejection; an operator's closure of a Membership — by identifier and state (Phase 26) |

Each record captures actor, action, target type and identifier, before and after state where
applicable, timestamp, IP address, and the authorising source where relevant.

For Better Auth password reset, password change and verified email change, the
required audit cannot depend on the request process surviving after the vendor
write. Identity prepares a token-free operation marker, the private adapter
stamps it atomically with the authoritative mutation, and immediate/restart
reconciliation commits the audit and required communication intent once. A
failed or stale pre-mutation marker is fenced before cancellation, so it cannot
later authorize a write or fabricate a success event. Account closure commits
its state, mandatory audit and communication intent in one private Identity
transaction.

### 13.3 Audit identifiers are historical evidence, not relational references

The audit actor and target identifiers are **not** the polymorphic `targetType + targetId`
pattern prohibited by DOMAIN_MODEL.md §6.2. That prohibition addresses **relational domain
references** that bypass referential integrity and typed ownership. Audit identifiers are:

- **historical evidence** — a snapshot of who acted and what the event concerned
- **intentionally capable of outliving** deletion or change of the records they name
- **not relational navigation** — nothing joins from an audit row into a domain table
- **not a shortcut for cross-domain persistence**
- **not a polymorphic business relationship**

An audit record must stay readable and truthful after its target is archived, renamed, purged
or reassigned. A foreign key would either block a lawful purge (DOMAIN_MODEL.md §14.3) or
destroy the very evidence the record exists to preserve.

> **The `AuditLog` representation established in the Phase 1 database foundation is therefore
> explicitly allowed, carries no foreign keys, and is unchanged** (DOMAIN_MODEL.md §6.2.1).

### 13.4 Audit payloads are minimised

§13.2 requires "before and after state where applicable". Read carelessly, that turns a
general-purpose audit table into **a second copy of every sensitive record** — private Fatwa
questions, message content, personal data — held under different access rules, retained for a
different period, and exported by a different route.

> **A generic audit payload must not become a full sensitive record snapshot.**

**Rules:**

1. **Audit payloads are minimised.** They record **which fields changed** and enough context to
   understand the action and hold the actor accountable — not a wholesale serialisation of the
   record.
2. **Sensitive content is referenced, not copied**, into generic audit rows: private question
   bodies, message content, attachment content, recovery material and credentials never appear
   there (§19.2).
3. **Where richer evidence is genuinely required** — a religious-content revision history, where
   the previous exact wording *is* the evidence — it is held as **that domain's own revision
   record**, with the owning context named, **permission-restricted access**, and a **defined
   retention period**. It is not smuggled into the general audit log.
4. **Retention and export rules follow the sensitivity of the payload**, not the convenience of
   the table.

This does not weaken auditability: who acted, on what, when, under what authority, and what
changed all remain recorded (§13.2).

---

## 14. Webhooks and payment security

No production payment provider is selected (OPEN_DECISIONS.md §5.4). Webhook endpoints follow
**protocol model B** (§7.2), not browser CSRF semantics. Every integration **must**:

1. **Verify the signature** of every inbound webhook before any processing.
2. **Be idempotent** — the same event delivered twice produces one effect.
3. **Resist replay** — timestamp validation and event-identifier tracking.
4. **Verify amount, currency and status server-side against the provider** before recording a
   donation as successful. Client-reported outcomes are never trusted.
5. **Store no card or payment credential data.**
6. Log no payment credentials or full payloads containing personal data.
7. **Deduplicate provider events durably**, and **handle out-of-order delivery** so that a late
   event cannot overwrite a newer state.
8. **Reconcile ambiguous, delayed and missing events.** An outcome that was never confirmed is
   **never assumed successful**.
9. **Scope provider transaction and event identifiers to the provider account and
   environment**, so a sandbox identifier can never be mistaken for a live one.
10. **A browser redirect never proves payment success.** Success is established from verified
    provider state, never from the URL the donor lands on.

**The same reliability rules apply to provider events for email delivery** — authenticity
verification, idempotency and replay resistance (ARCHITECTURE.md §4.6.1). A provider callback
is a Class-B request wherever it appears (§7.2).

**As delivered (Phase 27) — the Stripe sandbox engineering adapter.** Phase 27 meets every rule
above against one real sandbox protocol, recorded as a **sandbox engineering adapter, not a production
provider selection** (TECH_STACK.md §18.4):

- **Signature first, over the exact bytes.** `POST /api/webhooks/stripe` accepts POST only, refuses
  a declared body over 64 KiB before reading and stops reading at 64 KiB regardless, and never parses
  before verifying. `Stripe-Signature: t=…,v1=…` is checked as HMAC-SHA256 over `t`, `.` and the raw
  bytes with the endpoint secret, compared in constant time against every `v1` (rotation), ignoring
  every other scheme; a timestamp more than 300 seconds from now either way is refused as stale. Only
  then is the body strictly parsed. A missing, forged, wrong-secret, tampered or stale signature
  answers 401 and writes nothing; signed but malformed JSON answers 400 and writes nothing.
- **Scope from configuration, never from the payload.** The adapter is built for exactly one
  provider, environment and NON-SECRET account key; an event or object whose live/test mode differs
  is refused. Provider checkout, payment, refund and event identifiers are unique per (provider,
  environment, account key), so a sandbox identifier can never match a live one. There is no fallback
  between environments, and a sandbox key cannot configure production or the reverse.
- **Durable dedup, replay-safe.** Each verified event is admitted once by its scoped event id; a
  duplicate or replayed delivery of a completed event is acknowledged with no effect, while an event
  whose processing failed stays admitted-not-completed and is processed when the provider retries. No
  payload, signature or header is stored — the event row keeps identifiers, type, instants, the
  SHA-256 of the verified bytes and the result.
- **The event is a hint; provider truth decides.** A verified event only names which checkout,
  payment or refund to re-read. The server retrieves it from the provider and accepts success only
  when scope, checkout, the provider's client reference (this donation), currency and the exact
  expected minor amount all match and a capture of exactly that amount is reported; any mismatch
  raises an attention flag and changes nothing else.
- **Out of order converges.** Donation facts are monotonic — captured set once, refunded only
  grows, a dispute only moves forward — and the state is derived from them by one rule the database
  re-checks, so any arrival order ends in the same state and a late "pending", "failed" or "expired"
  never regresses a verified success.
- **Reconciliation.** Missing, delayed or unanswered events are recovered by a bounded SQL-leased
  sweep with backoff (1 minute to 24 hours, then an `unresolved` attention flag); an unknown provider
  answer is never assumed to be success or failure. An ambiguous checkout creation is resolved only by
  repeating it under its ORIGINAL idempotency key with byte-identical parameters, which the provider
  answers with the original outcome, within a 20-hour window — never by a fresh attempt. An ambiguous
  refund request is never repeated: it is found at the provider by this platform's own refund id, and
  only after that window, with the provider still holding no such refund, is it recorded as failed and
  its reservation released.
- **Refunds cannot exceed the capture.** A refund is reserved against the captured amount under the
  donation's lock; the database refuses live refunds above the capture, a refund in another currency
  or scope, and a requester who does not hold `donations.refund` with a live `donation-refund`
  step-up at that moment.
- **The browser proves nothing.** Checkout is provider-hosted; the return URL is a constant page
  that reads no query string and mutates nothing. A donor's "check again" asks the provider through
  the same verified path.
- **No credentials anywhere.** No card number, security code, expiry, wallet or bank credential,
  billing address or payer email is collected, proxied, stored or logged. Secrets, signatures, status
  tokens, checkout URLs and card-shaped field names are redacted at the logger.
- **Activation fails closed.** Without the owner-written activation row matching the configured
  scope, no payment can start (and the database refuses the donation row). A non-production
  environment needs `fixture` authority; `production` needs `approved` authority with recorded
  external evidence, which neither the runtime nor any Donations key can write. None exists.
- **Protocol limits recorded honestly.** Stripe documents no account identifier on the objects
  this adapter reads, so the account key scopes identifiers by configuration. The anonymous sandbox
  the official Stripe CLI provisions issues a restricted `rkcs_test_` key that cannot read
  `GET /v1/account`, so the proof's account key is the one Stripe's own sandbox-creation output
  names rather than a value re-read through the API. Stripe's current currency page no longer states
  the final-digit rule for three-decimal currencies; the adapter keeps refusing a three-decimal amount
  whose last minor digit is not zero, the conservative direction.
- **Proven against the real sandbox (2026-10-19), locally and never in CI.** With an anonymous
  sandbox created by the official Stripe CLI (`stripe sandbox create`, test mode only, credentials
  in ignored local configuration): checkout creation with the exact expected amount read back,
  resume, cancellation, a captured test payment (Stripe's documented `pm_card_visa` test method — no
  card number), a partial and then the remaining refund, each observed by reference and by this
  platform's refund id. And a real Stripe-signed `checkout.session.expired`, delivered by the
  official `stripe listen --forward-to` over its own outbound connection to a loopback-only receiver
  (no tunnel), reached the production build's `/api/webhooks/stripe` on a disposable database: the
  signature was verified over the raw bytes, the donation moved only after the server re-read the
  session from Stripe, a byte-identical redelivery had no further effect, a tampered body and a
  missing signature were refused with nothing written, and no secret, signature, token or checkout
  URL reached the database or the server log. Payment success and dispute events were not driven
  live (a hosted-checkout payment needs a person at Stripe's page); the deterministic signed fixtures
  and the protocol simulator remain the authoritative CI evidence for those.

**Membership and Donations are separate implementation slices** (DOMAIN_MODEL.md §17). An
unresolved payment provider must never block Membership. **Phase 26 delivered Membership with no
payment code path**: no provider, amount, currency, fee, transaction, webhook or payment state, and
no Donations dependency in either direction (§19.1.6).

---

## 15. Rate limiting

### 15.1 A RateLimiter abstraction

**Distributed, SQL Server-backed rate limiting is not a mandatory V1 architectural
dependency.** The strategy sits behind a `RateLimiter` abstraction so it can change without
touching call sites.

| Stage | Strategy |
|---|---|
| **Initial single-instance deployment** | NGINX coarse per-IP throttling **plus** process-level application limits, acceptable for lower-risk flows |
| **Before horizontal scaling, or where a security-critical flow requires cross-instance consistency** | Introduce a shared limiter store/strategy behind the same abstraction |

**Redis remains explicitly not required initially and must not be added prematurely.**

The limitation is stated honestly: with multiple web instances, in-process counters are
per-instance. That is why the abstraction exists and why a shared strategy is required
**before** horizontal scaling, not after.

### 15.2 Protected flows

Sign-in (credential stuffing) · registration · password reset and verification resend (email
bombing) · search (expensive query denial of service) · Fatwa question submission · message
send (flooding) · contact, feedback and newsletter (spam) · file upload · admin bulk
operations · membership application, withdrawal, self-closure and export (per account,
Phase 26).

Progressive backoff on repeated failures; account lockout with a documented,
administrator-assisted recovery path. **Rate-limit responses never leak whether an account
exists.**

**Search (Phase 17).** Expensive-query protection is layered rather than single:

- **Bounded query shape** — at most 200 characters and 8 words, each word letters, marks and
  digits only; a prefix match only for words of 3+ letters; 20 results a page and at most 50
  pages, so the engine never ranks more than 1,000 results per word breaker.
- **Grammar is never built from input.** The query box yields words; quotes, operators,
  wildcards and SQL are separators. The engine adapter composes its own grammar from those
  words and passes it as a parameter (tested with hostile input against the live engine).
- **Per-client throttling at the request boundary** — thirty queries a minute per client
  address, enforced by the request proxy through the existing RateLimiter, keyed by a **keyed
  digest** so no raw address is stored. A request with nothing typed spends nothing.
- **No search history, no analytics, no query text in any log.** A failure is logged as the
  operation and the database's error class only.
- **A stale index never discloses** (ARCHITECTURE.md §8.5): every result page is rechecked
  against its owners' current public state before anything is returned.

---

## 16. Accessibility as a security-adjacent requirement

**Target: WCAG 2.2 AA.** Accessibility is a requirement, not a polish item, and is an exit
criterion of every feature phase.

### 16.1 Baseline

Full keyboard navigation · **visible focus indicators** · contrast ratios meeting AA · text
resizing to 200% without loss of content or function · semantic landmarks and headings ·
screen reader testing in all three locales · `prefers-reduced-motion` honoured · correct
`lang` and `dir` on mixed-direction content.

### 16.2 Domain-specific acceptance criteria

| Surface | Requirements |
|---|---|
| **Quran reader** | Correct Arabic rendering at all sizes · **readable line length and reading controls** (font size, script, spacing) · ayah-level navigation by keyboard · screen-reader-correct verse announcement · translation and Arabic distinguishable non-visually · **no decorative animation on scripture** |
| **Long-form book reader** | Reading controls · progress indication · keyboard pagination · reflow at 200% zoom · resumable position |
| **PDFs** | Accessible alternatives where available · never the sole format for essential content · downloadable with a described link, not an unlabelled icon |
| **Video and audio** | **Captions and transcripts surfaced when available** · keyboard-operable player · no autoplay with sound |
| **RTL** | Every page verified in Urdu and Arabic — **not merely those checked during development** |
| **Forms** | Labels, error identification, and instructions meeting AA |

### 16.3 Software conformance and content conformance are accepted separately

The platform can be accessible before every authoritative content asset is. Conflating the two
produces either a false conformance claim or a permanently deferred one.

| Dimension | What it means | When it can be accepted |
|---|---|---|
| **Software accessibility capability** | The application supports captions, transcripts, alternative text, reading controls, keyboard operation and correct semantics wherever content supplies them | When the software meets **WCAG 2.2 AA** for its delivered surfaces |
| **Content conformance** | The actual corpus carries the alternatives the guidelines require | Only when the authoritative source supplies them |

**Rules:**

- **An alternative is never fabricated.** No invented caption, transcript, alternative text or
  description is generated to close a gap — for media generally, and emphatically for religious
  content (§5, §6).
- **A missing alternative is recorded, not hidden.** Phase 32 maintains a content-conformance
  register of the gaps (DELIVERY_PLAN.md).
- > **No unqualified whole-product WCAG 2.2 AA claim is made while required source-content
  > alternatives are missing.** The software claim is made on its own terms, and the content
  > position is stated honestly alongside it.
- Where a provider or source **does** supply captions or transcripts, they are **surfaced**
  (§16.2) — availability is the constraint, not effort.

---

## 17. Public caching boundary

**The anonymous public render tree must never read session-derived state**
(ARCHITECTURE.md §8).

Prohibited in the cached public tree: private user preferences · saved state, bookmarks and
notes · **meeting URLs** · **private Fatwa questions** · messages · notification state · any
per-user record.

Personalised content renders in **explicitly uncached, private authenticated boundaries**.
`/my/*`, `/teacher/*`, `/admin/*` and authenticated API responses carry private, no-store
directives.

**Cache-leakage tests are a standing exit criterion of every feature phase**: no
session-derived value in a shared cache entry, and no personalised fragment served to a
different visitor.

---

## 18. Secrets, database and dependency security

### 18.1 Secrets

**None in source control, client code or logs.** Supplied as environment variables, validated
at startup with Zod so the process fails fast. `NEXT_PUBLIC_` variables are understood to be
public and never carry sensitive values. Different secrets per environment; rotation without
code change; `.env` git-ignored with a valueless `.env.example`.

### 18.2 Database

Least-privilege application account — **not `sa`** — with no runtime schema-modification
rights and **no UPDATE or DELETE on audit tables** (§13.1). Parameterised queries via Prisma.
Encrypted connections. **Encrypted backups with tested restores.** Restricted network access.
Migrations reviewed and applied deliberately, never automatically on deploy.

SSMS administrative access is limited to authorised developers and DBAs and is **not a
production application path**.

### 18.3 Dependencies

Stable, well-maintained packages only. **No canary, beta, RC, preview or experimental
dependencies** without a written architecture decision. Automated vulnerability scanning in
CI. Genuine Dependabot commits only. **Deliberate, reviewed and tested upgrades — never
opportunistic majors during feature work.** Lockfiles committed and respected.

#### 18.3.1 The dependency-audit gate

CI's **Dependency audit** job runs the real `npm audit` over the committed lockfile through
`scripts/verify-dependency-audit.mjs`. **Every Critical finding fails. Every High finding
fails**, except an advisory recorded as a reviewed exception in
`scripts/shared/dependency-audit-policy.mjs`. Moderate and lower findings are reported and do
not fail, which is the same threshold as the `npm audit --audit-level=high` gate it replaced.
There is no lowered threshold, no severity-wide suppression and no global ignore setting.
An audit that cannot run, or a report the gate cannot read, fails.

An exception is narrow by construction. It names one advisory on one package, with that
advisory's severity and affected range. It also records the exact dependency chain that
carries the package, and the one package npm reports as High only because it depends on it.
**The exception fails the gate again** when:

- the advisory is no longer reported (the exception is stale and must be removed);
- the advisory's package, severity or affected range changes;
- the chain changes in any way: a version, a link, a second copy, or a new dependent;
- any manifest declares the covered packages directly;
- committed source imports what it covers, or configures the feature it covers.

**Current exception — GHSA-xcx6-jx8p-x3h5 (High), `@azure/msal-node` 5.6.0** (pre-Phase-30
security maintenance, October 2026):

- **Advisory.** MSAL Node's authorization-code flow (`acquireTokenByCode`) can disclose
  parameters to an attacker-controlled endpoint. Affected `>=5.0.0-beta.0 <7.1.0`; patched in
  7.1.0.
- **How it arrives.** Only transitively, through SQL Server's driver: `mssql` 12.7.0 →
  `tedious` 20.3.6 → `@azure/identity` 4.13.2 → `@azure/msal-node` 5.6.0. This is the code
  path tedious uses for Azure AD sign-in to SQL Server.
- **Why One Minhaj is not exposed.**
  - Every environment signs in to SQL Server with SQL logins.
  - No source imports Azure Identity or MSAL, and no committed configuration enables Azure AD
    authentication. The gate scans committed source and configuration for both and fails if
    either appears.
  - Even with Azure AD enabled, tedious only builds client-secret, managed-identity,
    username/password and default credentials. None of them runs the authorization-code flow.
- **Why it is an exception rather than a patch.** No stable supported chain reaches a patched
  MSAL. The newest `@azure/identity` (4.14.0) still declares `@azure/msal-node ^6.0.0`, which
  is inside the affected range. `tedious` 20.x still requires `@azure/identity ^4.13.1`.
  Forcing MSAL 7 with an override would break the parent's declared major range on an
  authentication path. That is a larger runtime risk than an unused, fail-closed transitive
  finding.
- **Removal condition.** Remove the exception, and this entry, as soon as the owning chain
  resolves to `@azure/msal-node` 7.1.0 or later through its own declared ranges. The gate
  forces the review: it fails when the advisory stops being reported and when the chain
  moves.

---

## 19. Privacy and safeguarding

### 19.1 Privacy rules

**Data minimisation** · **purpose limitation** (onboarding data personalises; it is not
repurposed) · **defined retention** for logs, audit records and personal data · **user
rights** — view, export, correct, delete, revoke sessions.

**Deleting personalisation is not platform-wide erasure.** A previous revision described
account deletion mainly in terms of personalisation records, which understates it: a person's
data lives in several contexts, each with its own lawful basis and retention rule.

> **Every semantic data owner owns the disposition of its own data.**

- **Identity & Access owns account closure** and the authentication and security state
  (DOMAIN_MODEL.md §4.6).
- **Layer 4 may coordinate a cross-domain user request and report its status.** It gains **no
  direct ownership of another context's tables** by doing so (DOMAIN_MODEL.md §3.3), and the
  coordination follows the durable, fail-closed pattern of ARCHITECTURE.md §3.1.2.1.
- Anonymised aggregates and **legally required audit records are preserved** (§13).

**For each class of personal data, the owning context defines** access · correction where
applicable · export · retention · archive · anonymisation · purge · deletion · any legally or
operationally retained state · and any **pending disposition**. The classes this covers:

Identity · sessions · profile · saved items · notes · history · learning and progress ·
**private Fatwa questions** · messages · attachments · **ContactInquiry** · **Feedback** ·
**NewsletterSubscriber** · **email delivery metadata** · donor data · **migration raw
snapshots** (MIGRATION_STRATEGY.md §8.3) · and audit evidence.

> **Erasure is not reported as complete while required owner work remains pending.** A status of
> "pending" is honest; a status of "done" while records remain is not.

**Consent evidence.** Where consent is the basis — newsletter subscription being the clear case
(DOMAIN_MODEL.md §14.5) — the record retains **the purpose, the notice or version consented to,
the timestamp, the source, and revocation history where applicable**.

**No automatic behavioural tracking is introduced, and no cosmetic cookie banner is added.** A
consent surface exists only where genuine non-essential processing requires one
(ARCHITECTURE.md §4.7.1).

**Fatwa questions are sensitive** — strictest access control, never exposed in listings,
search, logs or caches. **Student data** is limited to teachers with a **current** assignment.

#### 19.1.1 Phase-6 general correspondence

ContactInquiry and Feedback have separate private storage and lifecycles. `correspondence.read`
authorises bounded operator access; `correspondence.administer` authorises version-checked
triage and private notes. Editorial author/reviewer/publisher grants do not imply either.
Anonymous intake uses the existing digest-keyed limiter and Origin-protected Server Actions.
There is no public lookup, download/export endpoint, search entry or sitemap record; an
on-site acknowledgement carries no message body. No automatic outbound copy is sent.
Requests for access/export require the privacy owner's verification process; this anonymous
form is not an identity-verification or data-subject request portal.

Intake remains inactive until OPEN_DECISIONS §2.3.1 is resolved. Stored deadlines govern
exclusion and bounded purge (25 records of each kind per sweep). The purge deletes contact
identity, body and operator notes together. No private correspondence text enters audit,
application diagnostics or shared caches. Backup retention/disposition remains separately
owned under OPEN_DECISIONS §4.4.

#### 19.1.2 Phase-21 personalisation and the newsletter

Engineering defaults only; **OPEN_DECISIONS §2.2 (applicable jurisdictions) stays open**, so no
retention period, legal hold, residency rule, statutory deadline, age rule or compliance claim is
made, and no cookie banner is added — there is no non-essential processing to consent to.

- **Owner-only.** Saved items, notes, private collections, history, the Quran position, onboarding
  answers, notification preferences and notifications are readable and writable only by their
  account, with the account in every query's own predicate; a guessed id answers like a missing one.
  **No staff permission reads them** — there is no `personalisation.*` key — and the newsletter keys
  reach only subscription state. Future verified data-subject support must be an owner-specific
  workflow, never universal browsing.
- **Minimised by default.** History is off until the person turns it on and is one row per target
  (newest 500 kept); onboarding stores explicit choices of public areas only; nothing is inferred
  from behaviour and no third-party analytics, pixel or fingerprinting exists.
- **Export and disposition.** `GET /api/my/export` returns the person's Personalisation data as
  deterministic JSON (typed target identities, never content copies), private and `no-store`,
  rate-limited and never written to disk. Closure disposition is the owner's bounded, idempotent,
  resumable delete of a CLOSED account's rows, coordinated at Layer 4 after Identity commits and
  reported as pending until complete; it never touches a newsletter subscription.
- **Newsletter consent.** Double opt-in; submissions are anti-enumerating and limited per address
  digest and per client. Link tokens are HMACs under `NEWSLETTER_TOKEN_KEY` over per-issuance random
  salts; only their SHA-256 is stored, they are single-purpose, the confirmation expires after 48
  hours and is consumed once by a POST, and they carry no authentication authority. Consent evidence
  (purpose, notice version, source, locale, instant, revocation) is append-only. A marketing
  unsubscribe or suppression never reaches verification, reset or account-security mail, which a
  newsletter state cannot express — and a provider complaint about a newsletter message is recorded
  in the marketing scope only, so a confirmation sent to somebody else's address cannot be turned
  into a block on their password reset.
- **Cache boundary.** Public content pages render the same for everyone; their private island reads
  and writes through `/api/my/*` after hydration, so no personal state enters a shared render or a
  public GET's cookies.
- **Logging.** Note text, addresses, tokens, history and export bodies are never logged; failures are
  logged by operation name only, and operator audit rows carry identifiers and states, not addresses.

#### 19.1.3 Phase-22 learning and progress

Engineering defaults only; OPEN_DECISIONS §2.1 (under-18 safeguarding) and §2.2 (applicable
jurisdictions) stay open, so no age rule, guardian consent, retention period or compliance claim is
made, and the platform is not declared adults-only.

- **Owner-only.** Enrolments, lesson Progress and trial-class requests are readable and writable only
  by their account, with the account in every query's own predicate; another person's Course state
  answers exactly like an absent one. `learning.read` and `learning.administer` govern the catalogue
  and show **counts** of enrolments and requests per Course — never who. No key edits a learner's
  Progress, and nothing confirms, schedules or assigns a request.
- **Profiles and attribution grant nothing.** A Course's teachers are public attribution to People;
  no TeacherProfile, attribution or Learning key is teaching authority, which remains Phase 23's
  `teaching.perform` (not catalogued).
- **Minimised by default.** A learner record holds the account, the Course or lesson and an instant —
  no name, address, contact, age, note or free text is copied or asked. Progress is recorded only by
  the learner's explicit act, never inferred from a view.
- **Class-A mutations.** Enrolling and requesting a trial class from a public Course page go through
  the same-origin-checked `/api/my/*` transport (§7.1 rule 6); leaving, completing a lesson and
  withdrawing a request are Origin-protected Server Actions that re-resolve the session. Every write is
  rate-limited per account.
- **Cache boundary.** The public Learn tree reads no session, Enrolment, Progress or request: its
  knowledge content is the same for every visitor, and a signed-in person's state arrives only through
  the private island after hydration. Lesson bodies are read on private, `no-store`, `noindex` My
  Learning pages by an enrolled account.
- **Export and disposition.** `GET /api/my/export/learning` returns the person's Learning data as
  typed identifiers, private and `no-store`, rate-limited and never written to disk. Closure
  disposition is Learning's bounded, idempotent, resumable delete of a CLOSED account's Enrolments,
  Progress and requests, coordinated at Layer 4 after Identity commits and reported as pending until
  complete; it never deletes a Course or a path.
- **Logging and audit.** Catalogue audit rows carry identifiers, states and counts — never a title,
  description or lesson body; learner acts are not audited and are logged, on failure, by operation
  name only.

#### 19.1.4 Phase-23 live classes

Engineering defaults only; OPEN_DECISIONS §2.1, §2.2, §5.3 and §6.3 stay open, so no age, guardian,
vetting, retention or adults-only rule exists and no real teacher is named (DOMAIN_MODEL.md §13.5).

- **Fail closed until activated.** No window, session or Booking exists and no address is disclosed
  while `LiveLearningActivation` holds no row; the runtime cannot write that row.
- **Default-deny teaching.** A teacher read or write needs a live `teaching.perform` RoleAssignment
  (Identity, re-read every request) and a current typed scope on the exact Course; the Teacher area,
  the students, the sessions, the windows and the addresses close on revocation or scope end. A
  TeacherProfile, a CourseTeacher attribution and a role name grant nothing. A teacher sees only
  learners enrolled on the Courses they currently teach, and only Learning-owned facts — enrolment,
  progress, class and attendance history — never contact, account, Fatwa or Personalisation data,
  and no free-form note is stored about anybody.
- **Participant authorisation.** A learner reaches a session through a current Enrolment on a
  published Course or their own confirmed Booking; a guessed id answers like a missing one. A learner
  cancels only their own trial Booking.
- **Audited identity access.** Every read that names learners or requesters — a teacher's student
  list or detail, an operator's request list or participant list — records an audit row of
  identifiers only (§13.2 "data access"); scope grant and end, confirmation, cancellation,
  scheduling, rescheduling, completion, teacher replacement and attendance correction are audited by
  identifier and state, never with an address, a body or a payload.
- **Concurrency.** One Booking per request and per session, one live claim per window, one current
  scope per account and Course (unique keys); no overlapping windows or sessions for one teacher
  (triggers), serialised on the teacher before the first protected write; expected versions on every
  session, Booking, window and scope mutation; a refusal is never reported as a serialisation
  failure (DOMAIN_MODEL.md §19.8).
- **Class-A mutations.** Every teacher, learner and operator class mutation is an Origin-protected
  Server Action that re-resolves the session and re-reads authority; teacher and learner writes are
  rate-limited per account; no state-changing GET exists.
- **Service mail.** Learning commits durable intent in the class transaction; the dispatcher relays
  it only after re-checking activation, session state and the recipient's current relationship, and
  Identity resolves the recipient's current address at relay and at send. A marketing unsubscribe
  never suppresses it. The intent row and the message carry no address, body or meeting link.
- **Export and disposition.** The person's export adds their Bookings, class participation,
  Attendance, windows and scopes by typed identifier — never another participant and never an
  address. A closed learner's future Bookings and trial sessions are cancelled and their Attendance
  and intents removed; a closed teacher's scopes are ended, windows removed and future sessions left
  replacement-required; no session or scope is deleted and no other participant's history changes.
- **Logging.** Structured, by operation name; no meeting address, participant list, requester,
  recipient address or reminder body.

#### 19.1.5 Phase-24 messaging

Engineering defaults only; OPEN_DECISIONS §2.1, §2.2, §2.5 and §6.6 stay open, so no age, guardian,
vetting, retention, escalation or adults-only rule exists and no real support or moderation staff is
named (DOMAIN_MODEL.md §15.6).

- **Minimised.** Messaging stores account ids, roles, plain-text bodies, attachment metadata and
  safety states — no email, name, phone, age, guardian, address, device, Course title or meeting
  link. Display names are resolved at Layer 4 for people already in the conversation; support
  staff appear as "Minhaj Support".
- **Private surfaces.** `/my/messages/*`, `/teacher/messages/*` and `/admin/messaging/*` are
  per-request, `no-store` and `noindex`; nothing of Messaging enters Search, a sitemap or a shared
  cache, and no message content is sent by email.
- **Export.** `GET /api/my/export/messaging` returns the person's participation, their OWN messages
  with their text, their attachments' metadata (never bytes), their read state, blocks and reports —
  never another person's message — private, `no-store`, rate-limited and never written to disk.
- **Disposition and the terminal-history rule.** After Identity commits a closure, Messaging's
  bounded, idempotent, resumable disposition (reported as pending until complete) closes the
  account's conversations, ends its participation and removes its read state, blocks and unsent
  uploads. The REMAINING participant keeps read-only access to the immutable history while their
  own half of the relationship is current; ordinary revocation, withdrawal or a block never does
  this. A conversation is disposed, attachments released from Storage, once every non-support
  participant has left through closure and no report names it; a reported conversation is kept as
  evidence pending §2.2. A new registration is a new account and reaches nothing old.
- **Logging.** By operation name only — never a body, filename, token, storage key or address.

#### 19.1.6 Phase-26 membership

Engineering defaults only; OPEN_DECISIONS §2.2 stays open, so no retention period, legal hold,
residency rule or compliance claim is made, and no cookie banner is added.

- **Application and member state is personal.** Which account applied for which type, when, and
  what was decided is private. The public `/membership` page carries none of it: it reads no session
  and renders the same for every visitor.
- **Minimised.** An application holds the applicant account, the type, its status, a withdrawal
  source and its instants. **No questionnaire exists** — no name, address, phone, email, age, date of
  birth, guardian, identity document, occupation, free text, note, photograph or upload is asked for
  or copied; the account already is the applicant. **No payment data of any kind exists.**
- **Owner-only self-service.** `/my/membership` reads and writes only the signed-in account's own
  applications and Memberships, with the account in every query's own predicate; a guessed id
  answers like a missing one. An applicant needs no staff key.
- **Staff access.** `membership.read` opens the type catalogue in every state, the application queue
  and the member list; `membership.administer` creates, edits, publishes and archives types, begins
  review, approves or rejects, and closes a Membership. Both are ordinary keys in the protected
  Platform Administrator bundle; `people.*`, `global.*` and `content.*` confer nothing here. An
  operator sees an applicant's display name, resolved by Identity at Layer 4 — never an address.
- **Audited access.** Opening an application and every queue or member listing records an audit row
  of identifiers and filters only (§13.2 "data access"); type changes, review, decisions and an
  operator's closure are audited by identifier and state, never with words, a name or an address.
- **Service mail.** Membership commits durable intent in the transaction that owes it; the
  dispatcher relays it only while the message is still owed and Identity resolves an active
  recipient. It is transactional mail: a marketing unsubscribe never suppresses it. The intent and
  the message carry no address, body or token, and the message links only to `/my/membership`.
- **Export and disposition.** `GET /api/my/export/membership` returns the person's applications and
  Memberships by typed identifier and instant, private, `no-store`, rate-limited and never written to
  disk. After Identity commits a closure, Membership's bounded, idempotent, resumable disposition
  (reported as pending until complete) withdraws the account's open applications and removes its owed
  mail. **Closing the account is not resigning the organisational Membership**: an active Membership
  stays active under its own lifecycle, and a later registration is a new account that reaches
  nothing old.
- **Logging.** By operation name only — never an account, a type's words, a decision or an export.

#### 19.1.7 Phase-27 donations

Engineering defaults only; OPEN_DECISIONS §2.2 and §5.4 stay open, so no retention period, legal
hold, tax or Gift Aid rule, or compliance claim is made.

- **An anonymous donation is anonymous.** It holds no account, email, phone, billing address, IP
  address, provider shopper identity, card brand or last digits. No address is collected for a
  receipt: an anonymous donor reads status on-site through a 32-byte status token whose SHA-256
  digest alone is stored. The token travels in an HttpOnly, SameSite=Lax cookie scoped to
  `/{locale}/donate` and in the donor's own `/donate/status/{token}` link (`noindex`,
  `no-referrer`, `no-store`); it reads one donation's status and can ask the provider again or
  abandon an open checkout — nothing else. A provider identifier is never an access token, and
  rate-limit subjects are keyed digests.
- **A linked donation is a choice.** It exists only when a signed-in, active account starts it from
  `/my/donations`; it keeps the account id alone, and names are resolved through Identity when an
  operator needs them. An anonymous donation never links later, by email or otherwise.
- **Owner-only reads.** `/my/donations` lists only the account's own linked donations, bounded and
  newest first; another account's donation resolves to nothing.
- **Staff access.** `donations.read` opens records, refunds, reconciliation state and the bounded
  CSV export; `donations.administer` operates campaigns and asks the provider for a donation's
  current state; neither refunds. Every listing, detail and export is an audited access of
  identifiers and filters only; provider references appear as their last six characters.
- **Service mail for linked donors only.** Success, partial-refund and refund acknowledgements are
  transactional intents committed with the fact they announce, re-checked at relay and send, sent to
  the address Identity reports at that moment, and never suppressed by a newsletter unsubscribe. They
  are payment acknowledgements, never tax receipts, and link only to `/my/donations`.
- **Export and disposition.** `GET /api/my/export/donations` returns the account's linked donations
  by identifier, campaign, exact amount text, state and instant — no anonymous donation, no provider
  reference, no event. After Identity commits a closure, Donations' bounded, resumable disposition
  removes the account's owed mail and **releases the account link** of its donations; every amount,
  state, event and refund record is kept unchanged as financial history, and a later registration with
  the same address reaches nothing old.
- **Logging.** By operation and safe category only — never a token, secret, signature, payload,
  checkout URL, email or amount tied to a person.

#### 19.1.8 Phase-29 migration raw snapshots and incidental personal data

Engineering defaults only. No real source has been contacted, so no real personal data is held;
OPEN_DECISIONS.md §2.2 stays open, and **no retention period for raw snapshots is set**.

- **Flagged and redacted before staging.** Normalisation detects email addresses and phone-like digit
  runs (ASCII, Arabic-Indic and Extended Arabic-Indic digits) in titles and descriptions, replaces each
  with `[redacted]` in the staged payload and flags the revision; **a flagged revision cannot be
  approved** (CHECK), so it is held for a person rather than carried forward. Detection is
  conservative: a false positive only holds a record.
- **Raw evidence is kept exact and flagged.** The snapshot's bytes are never edited; a snapshot whose
  decoded body carries such data is flagged, readable only under `migration.administer` through the
  audited preview or download (§10.5), and never part of a listing, an audit row or a log.
- **Disposal is deliberate.** An administrator may dispose of a snapshot's body for a stated reason;
  the database admits that as the only change to a snapshot and keeps who, when, why and the
  checksum. **Phase 29 delivers the mechanism, not a period**: when raw snapshots must be disposed of
  remains OPEN_DECISIONS.md §2.2's decision.
- **Operators are distinct and audited.** Migration work needs the migration keys; listing screens
  show titles and identifiers, never bodies; staged payloads are shown as escaped text.
- **Logging.** By operation name only — never a body, payload, header value, URL or personal detail.

### 19.2 Logging

**Pino**, structured, with correlation identifiers. **Redaction is configured at the logger
level**, not left to call sites — a call-site convention will eventually be forgotten, and one
omission is a credential leak.

**Never logged:** passwords (including failed attempts) · session, OAuth and reset tokens ·
API keys · database credentials · **Fatwa question content** · message content · **meeting
URLs** · full request bodies containing personal data · full email addresses in general logs.

### 19.3 Under-18 safeguarding

**A genuine external policy decision** (OPEN_DECISIONS.md §2.1) that gates the **production
activation** of:

- Teacher/student live learning
- One-to-one messaging
- Student-to-student messaging where relevant

Minhaj must decide: whether minors are supported · age thresholds · parental/guardian consent ·
**teacher vetting** · one-to-one communication rules · reporting and escalation · moderation
requirements · retention requirements.

**It is an implementation gate only for the behaviour the policy itself determines** — a
guardian-consent flow, an age threshold, a minor-specific retention or communication rule — and
that behaviour is not built until the policy defines it (DELIVERY_PLAN.md §3.1). It is **not** a
blanket block on building the phases above: their policy-independent mechanics may be engineered
fail-closed while production activation stays blocked, as Phases 23 and 24 did. **This does not
block Phase 0B tooling or foundation work** either.

**What engineering may build before the policy arrives.** The absence of a final policy does not
prevent implementing the **policy-independent, default-deny mechanics** that any policy will
require: current teaching-assignment checks · enrolment and relationship checks · default-deny
access · participant authorisation · private meeting-URL handling · attendance mechanics ·
blocking · reporting infrastructure · moderation primitives · message persistence and security ·
teacher revocation behaviour · class and session data protection · and the absence of accidental
public disclosure.

**The fail-closed pre-policy state.** Until a safeguarding policy explicitly permits otherwise:

- **under-18-specific production capability remains disabled**;
- **student-to-student messaging remains disabled** (§12.3);
- **no guardian-consent rule, age threshold, teacher-vetting policy, one-to-one minor
  communication rule or special minor-retention rule is invented by engineering.**

> **This is a fail-closed pre-policy state, not a declaration that the platform is
> adults-only.** When the policy exists, any behaviour it genuinely requires becomes an
> implementation requirement for that behaviour, and is **implemented and tested before the
> corresponding production capability is activated** (DELIVERY_PLAN.md §3.1).

**The safeguarding gate is not closed by an engineering exit.**

### 19.4 Multi-jurisdiction

An international organisation with users in many jurisdictions — including the EU and UK —
faces GDPR and equivalent obligations. Which regimes apply is an organisational decision
(OPEN_DECISIONS.md); the architecture supports export, deletion and consent tracking
regardless.

---

## 20. Security testing requirements

**Security tests are exit criteria of every feature phase**, not a final sweep. Required
coverage:

- Permission checks on every protected mutation involving an authenticated principal,
  **including negative tests proving denial**
- **Capability projections never bypass permission checks**
- **A profile without a RoleAssignment grants nothing**
- **Horizontal privilege escalation** — one user attempting another's data
- **Fatwa publication authorisation** — every bypass path
- **Religious content workflow bypass attempts**
- **Step-up reauthentication required for privileged operations**
- **Class A — browser CSRF on Server Actions, Route Handlers and sign-out** (§7.1)
- **Class A — no ordinary browser mutation is performed by GET.** Scoped to Class A: Classes B,
  C and D are asserted against their own protocol contracts below, never against this rule
- **Class B — signed callbacks:** forged signature rejected, replay rejected, stale timestamp
  rejected, duplicate delivery produces exactly one effect (§7.2). **Not** asserted against
  browser CSRF or a logged-in principal
- **Class C — authentication callbacks:** missing or mismatched `state` rejected, PKCE enforced,
  redirect URI not taken from request input, linking requires verified email ownership (§7.3).
  **Not** asserted against an already-authenticated principal
- **Class D — verification and reset links:** a GET renders but performs no silent protected
  mutation; the token is consumed at the confirming action; **expired, reused and invalid tokens
  remain unusable** (§7.4). The confirming-action contract is proven in Phase 2
- Open redirect attempts on `returnTo` and legacy redirects
- XSS via imported and editorial content
- **Raw snapshots render inertly in admin tooling**
- Upload of disallowed types; quarantine enforcement
- Rate limiting effectiveness
- Session expiry, rotation and revocation
- **Socket authorisation across conversations, with current-relationship negative tests**
- **SSRF and DNS rebinding attempts through importer source configuration**
- **Cache-leakage validation** — no session-derived data in shared cache entries
- **Meeting URL disclosure limited to authorised participants**
- **Privileged second factor required before a high-consequence capability can be exercised**;
  **backup codes are single-use**; **regeneration invalidates prior codes**; **no administrator
  path silently disables it**; **no permanent break-glass account exists** (§8.2)
- **Initial bootstrap is one-time, race-safe, audited and unavailable after first success**;
  **self-elevation fails** (§8.3)
- **Account lifecycle:** signup collision under concurrency · email-change collision ·
  canonical-equivalent address · final authentication method protected · sessions revoked after
  a high-risk change · closure does not restore prior grants (DOMAIN_MODEL.md §4.6)
- **Communication durability:** a crash after the domain commit but before delivery is retried
  idempotently, **without minting a second verification or reset token**; suppression, bounce
  and complaint handling; duplicate and out-of-order provider events (ARCHITECTURE.md §4.6.1)
- **Newsletter:** submission alone does not subscribe · replayed and expired confirmations fail
  · enumeration resistance · unsubscribe without sign-in · **marketing suppression does not
  suppress security mail** (DOMAIN_MODEL.md §14.5)
- **Cross-context purge:** fail-closed, resumable, leaves no broken reference, and **no
  persistence capability crosses a context boundary** (ARCHITECTURE.md §3.1.2.1)
- **Concurrency:** stale publish, stale approval and stale grant updates are rejected
  (DOMAIN_MODEL.md §19.8)
- **Search and cache staleness never discloses** withdrawn, unpublished or private content
  (ARCHITECTURE.md §8.5)
- **Audit payloads are minimised** and carry no sensitive full-record snapshots (§13.4)
- **Recovery:** database and authoritative assets restore together; restored access controls
  hold; **already-completed external effects are not blindly replayed** (ARCHITECTURE.md §10.4)

**A permission check without a negative test is an untested permission check.**

---

## 21. Staging environment security (Phase 28)

The staging environment (ARCHITECTURE.md §10.6) is a **complete deployment of the platform**
that real people use for testing, demonstration and acceptance. It is therefore secured as a
real environment, and every rule below is an exit criterion of Phase 28.

### 21.1 Two independent layers: the environment gate and the application

**Layer 1 — the environment gate.** NGINX HTTP Basic Authentication over HTTPS
(`docker/nginx/staging/default.conf.template`) admits only people holding the staging
credential. It covers **every** path the host serves — pages, `/my`, `/admin`, assets, APIs,
sitemaps, unknown paths and the `/socket.io/` WebSocket handshake. The one exemption is
`/robots.txt`, which must be readable by the crawlers it addresses and reveals nothing (plus
the port-80 ACME challenge, which serves only the CA's token files).

**Layer 2 — the application.** Behind the gate, Identity sessions, RBAC, step-up and every
rule in this document apply exactly as anywhere else. **The environment credential is not an
application credential**: NGINX clears `Authorization` before proxying, so the application
never sees it, and holding it grants no role, permission or session. `/my` still requires a
session, `/admin` still requires a permission, and the realtime handshake still requires an
authenticated session after the edge has admitted the connection.

- The credential is 40 random characters, stored as a **bcrypt** hash (cost 6 — NGINX re-checks
  it on every request, so a slower hash would cost the server on every asset while adding no
  strength to a random credential), generated on the staging host, stored in a root-only file
  and **never printed, committed, logged or sent to CI**. An operator reads it on the host.
- **The credential is replaceable, and a suspected disclosure means immediate rotation.**
  `docker/staging/bin/rotate-edge-credential.sh` replaces it on the staging host itself, run
  as root on the host or through Azure Run Command with no parameters:
  - **Preconditions.** It proves the staging host, takes the host lock, and requires the live
    files to have their provisioned owners and modes.
  - **Generation.** It generates the new value from the host's CSPRNG and hashes it with bcrypt
    from stdin.
  - **Switch.** It switches the htpasswd file first, then the root-only netrc, each by
    same-filesystem rename, and reloads only the NGINX proxy. No database, application or
    other secret changes.
  - **Secrecy.** Neither the old nor the new value enters CI, chat, a URL, an argument or a
    log. Probes authenticate only through `--netrc-file` and report status codes only.
  - **Proof.** It must show the previous credential refused, the new one admitted, an
    unauthenticated request refused, `robots.txt` readable, and the application layer
    unchanged behind the gate.
  - **No restore.** A replaced credential is **never restored**. If any step or proof fails
    after the switch, the command **stops the edge proxy** and staging fails closed until the
    operator investigates (or deallocates the VM).
  - **History.** Earlier disclosure in tool output or a Run Command result is contained by the
    rotation, not by attempting to rewrite that output.
- A per-client request budget on the gated server bounds credential guessing and the hashing
  work an unauthenticated client can demand (`limit_req`, 429 when exceeded).
- A TLS client that negotiated the approved name but sends a different `Host` is answered
  `421` by the catch-all server, never proxied.
- **No `return` directive is used in a gated location**: NGINX evaluates `return` before
  `auth_basic`, so one would answer unauthenticated callers. This is asserted by test.
- Basic Authentication was explicitly approved by the owner for this **pre-adoption** staging
  environment. It is not a production access-control decision.

### 21.2 Non-indexability is not access control

The whole environment is non-indexable — `X-Robots-Tag: noindex, nofollow, noarchive` on
**every** response at the edge (401s, 404s, redirects, assets and the handshake included), a
robots file that disallows `/` and advertises no sitemap, and the application's own
build-time posture (`PUBLIC_INDEXING_ENABLED=false`: `noindex` metadata, no canonical or
hreflang towards any official origin, sitemaps 404). **None of this is relied on to keep
anyone out**; §21.1 does that.

### 21.3 Network exposure

Only **443** (HTTPS) and **80** (ACME challenge and a fixed-host redirect to HTTPS) are open to
the internet. **SSH is open only to the operator's current IPv4 address**, key-only, with root
login, passwords and forwarding disabled; the host key was verified through the Azure control
plane before first use, and `StrictHostKeyChecking=no` is never used. SQL Server, ClamAV and the
realtime process publish no port; SQL Server and the operator commands sit on a Docker network
with **no route out at all**. A TLS client asking for any host name other than the approved one
is refused at the handshake. **Containers cannot reach the Azure Instance Metadata Service**: a
`DOCKER-USER` rule, installed at boot before Docker starts any container, drops container
traffic to it, so a compromised web, realtime, scanner or certbot process cannot mint the VM's
managed-identity tokens. Docker starts only once the data disk is mounted.

### 21.4 Deployment identity and secrets

- **GitHub → Azure** is OIDC federation to a user-assigned managed identity, trusted only for
  this repository's `staging` environment (immutable repository and owner ids in the subject).
  **No client secret exists.** It holds exactly two rights: a custom role, assigned on the
  staging VM alone, that can read that VM and invoke Run Command on it; and push (write) on the
  registry's `minhaj/` repositories. It cannot create, delete, resize, start or reconfigure any
  resource.
- **GitHub → registry** uses a short-lived token exchanged from that identity, limited by an
  ABAC condition to the `minhaj/` repositories. **The registry has no admin user and no
  anonymous pull.**
- **VM → registry and VM → backup storage** use the VM's own system-assigned identity:
  pull-only on `minhaj/`, and read, list and write on the private `backups` container only. **No registry
  password, storage key or SAS exists on the host**; storage-account shared-key access is
  disabled.
- The deploy workflow runs **only** when the operator pushes a deploy tag onto one **exact,
  CI-green commit** that is the head of a `feature/phase-*` branch — never on a branch push or a
  pull request — serialised, with no `pull_request_target`, no fork access, no repository
  secret, actions pinned by commit SHA and images deployed **by digest**. The `staging`
  environment admits only the two deploy-tag patterns.
- Every staging secret (SQL `sa`, the runtime and operator principals, `AUTH_SECRETS`, the HMAC
  keys, the environment credential) is **generated on the staging host**, root-only, and
  **distinct from every other environment's**. None is a build argument, an image layer or a
  workflow value.

### 21.5 Target guards and data isolation

Every mutating staging operation proves its target with **independent signals**, never a name
alone: the host's identity file (`environment=staging` and an environment id), the Azure
Instance Metadata Service (this VM's resource id and its `environment=staging` tag), the data
disk's marker, and — for SQL — host `sqlserver:1433`, database `MinhajStaging`, the server's
machine name and a database-level fingerprint carrying the same environment id. Local names
(`MinhajPlatform`, `MinhajPhase1*`) are refused outright. Migrations, provisioning, seed and
reset run **only** as explicit operator commands from the exact-SHA operations image — never at
container start, never during a deploy unless the operator chose `migrate-and-deploy`. The
runtime and operator principals cannot reset. **Staging email is disabled, no payment provider
is configured, no production credential exists, and no real person's data is seeded.**

### 21.6 `PUBLIC_TO_PRIVATE_HANDOFF_CHECK`

The repository is public during active engineering. If it becomes private, the **runtime is
unaffected** — images are in the private registry and the VM pulls with its own identity — but
the following are re-checked **before** the visibility change:

1. GitHub Actions minutes, storage and billing for a private repository on the owner's plan;
2. environment features on the plan: the **required-reviewer rule is not available to private
   repositories on Free, Pro or Team plans** — it is extra protection today, never the only
   deploy control, and is removed or replaced deliberately if GitHub requires it;
3. the remaining controls stay in force: the deliberate deploy tag, exact SHA, the environment's
   deploy-tag rule, OIDC federation and least-privilege roles, the concurrency lock. Note what
   each control rests on: the branch-head and CI-green checks run from the tagged commit's own
   copy of the workflow, so they guard against mistakes, not against someone who can push; the
   controls a pushed commit **cannot** rewrite are the `staging` environment's protection rules,
   the federated credential's subject, and who may push branches and tags at all (today, the
   owner alone);
4. one staging deployment is re-proven from the private repository.

**A repository transfer or rename changes the OIDC subject**: the federated credential must be
updated deliberately; it does not follow the repository.
