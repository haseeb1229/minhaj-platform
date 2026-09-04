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
`returnTo`** · **CSRF on sign-out and every mutation**.

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
2. **Every mutation re-checks independently.** Route protection is navigational convenience,
   not a security boundary.
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

## 7. CSRF and mutation safety

A complete policy, absent from the prior revision, which relied on `SameSite` alone.

### 7.1 Rules

1. **No state-changing GET.** Every mutation is POST or a Server Action. **Sign-out is a
   POST/action, never a GET route** (ROUTE_MAP.md §2.4).
2. **Origin/Host validation** on every state-changing request; mismatches are rejected.
3. **`SameSite` cookies are necessary but not sufficient.** They are one layer, not the
   policy.
4. **Framework-safe mutation patterns** for Server Actions, using the framework's built-in
   protections rather than hand-rolled alternatives.
5. **Route Handler and REST mutations carry explicit anti-CSRF protection** — they do not
   inherit Server Action protections.
6. **Webhooks are exempt from CSRF but require signature verification** (§14).
7. **Cross-origin requests are rejected by default.**

---

## 8. Privileged operations and step-up authentication

The highest-consequence operations require **MFA or step-up/recent reauthentication before
production**. A long-lived session is not sufficient authority to publish a religious ruling.

Operations requiring step-up:

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

---

## 9. Input validation, output encoding and redirects

### 9.1 Validation

**Zod 4.5.x at every trust boundary** — Server Actions, Route Handlers, socket events, the
import pipeline, environment configuration. **Server-side validation is mandatory and
independent**; client validation is a UX affordance with no security value.

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

---

## 14. Webhooks and payment security

No payment provider is selected in this pass. When integration exists, it **must**:

1. **Verify the signature** of every inbound webhook before any processing.
2. **Be idempotent** — the same event delivered twice produces one effect.
3. **Resist replay** — timestamp validation and event-identifier tracking.
4. **Verify amount, currency and status server-side against the provider** before recording a
   donation as successful. Client-reported outcomes are never trusted.
5. **Store no card or payment credential data.**
6. Log no payment credentials or full payloads containing personal data.

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

Account deletion removes personalisation records (DOMAIN_MODEL.md §14.2) while preserving
anonymised aggregates and legally required audit records.

**Fatwa questions are sensitive** — strictest access control, never exposed in listings,
search, logs or caches. **Student data** is limited to teachers with a **current** assignment.

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

### 19.4 Multi-jurisdiction

An international organisation with users in many jurisdictions — including the EU and UK —
faces GDPR and equivalent obligations. Which regimes apply is an organisational decision
(OPEN_DECISIONS.md); the architecture supports export, deletion and consent tracking
regardless.

---

## 20. Security testing requirements

**Security tests are exit criteria of every feature phase**, not a final sweep. Required
coverage:

- Permission checks on every mutation, **including negative tests proving denial**
- **Capability projections never bypass permission checks**
- **A profile without a RoleAssignment grants nothing**
- **Horizontal privilege escalation** — one user attempting another's data
- **Fatwa publication authorisation** — every bypass path
- **Religious content workflow bypass attempts**
- **Step-up reauthentication required for privileged operations**
- **CSRF on Server Actions, Route Handlers and sign-out**
- **No state-changing GET endpoints exist**
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

**A permission check without a negative test is an untested permission check.**
