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
   self-applicable, requires step-up reauthentication, and is audited.

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

### 5.2 Hadith

1. **Text, reference numbers, narrator chains and gradings are sourced data — never inferred,
   generated or assigned by the platform.**
2. Editing requires `hadith.editCanonical` and **step-up reauthentication**.
3. Grading changes are audited with the authorising source recorded.
4. Imported Hadith requires human verification before publication.
5. **Conflicting variants are escalated, never silently resolved.**

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
   inherit Server Action protections.
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
| **Fatwa publication** | `fatwa.publish` |
| **Migration publication** | `migration.publish` |
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

**Zod 4.5.x at every trust boundary** — Server Actions, Route Handlers, socket events, the
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
socket input Zod-validated. **Typing state is ephemeral and never persisted.**

---

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
| **Migration** | Import runs, approvals, merges, **publications and rollbacks** |
| **Administrative** | Configuration changes, bulk operations, redirect changes |
| **Data access** | Access to private Fatwa questions, student personal data, and **moderation evidence** |

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

No payment provider is selected in this pass. Webhook endpoints follow **protocol model B**
(§7.2), not browser CSRF semantics. When integration exists, it **must**:

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

**Membership and Donations are separate implementation slices** (DOMAIN_MODEL.md §17). An
unresolved payment provider must never block Membership.

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
operations.

Progressive backoff on repeated failures; account lockout with a documented,
administrator-assisted recovery path. **Rate-limit responses never leak whether an account
exists.**

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

### 19.2 Logging

**Pino**, structured, with correlation identifiers. **Redaction is configured at the logger
level**, not left to call sites — a call-site convention will eventually be forgotten, and one
omission is a credential leak.

**Never logged:** passwords (including failed attempts) · session, OAuth and reset tokens ·
API keys · database credentials · **Fatwa question content** · message content · **meeting
URLs** · full request bodies containing personal data · full email addresses in general logs.

### 19.3 Under-18 safeguarding

**A genuine external policy decision** (OPEN_DECISIONS.md) that **blocks implementation** of:

- Teacher/student live learning
- One-to-one messaging
- Student-to-student messaging where relevant

Before those phases Minhaj must decide: whether minors are supported · age thresholds ·
parental/guardian consent · **teacher vetting** · one-to-one communication rules ·
reporting and escalation · moderation requirements · retention requirements.

**This does not block Phase 0B tooling or foundation work.** It gates the specific phases
above and nothing else.

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
