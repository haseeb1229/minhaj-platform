# Open Decisions — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit

---

## Purpose and discipline

This document records **only genuine external, business, organisational or infrastructure
decisions that the project cannot resolve internally.**

It is **not** a place to defer engineering decisions. Where a question can be answered by a
competent engineering team, it is answered in the other nine documents — and **§8 records the
engineering decisions that have since been closed**, including several this document previously
left open.

Each item records what is needed, why it is external, which phase it gates, and what happens
if it remains unanswered.

**Owner:** *Minhaj* = Minhaj-ul-Quran International · *Dev* = development team · *Joint* = both.

---

## How to read an entry — category and gate type

Two independent things have to be known about any decision: **whose decision it is**, and **what
it actually blocks**. Conflating them is what produces both of the failure modes this baseline
guards against — waiving a religious-authority decision to keep building, or stalling the entire
roadmap because an external corpus has not arrived.

**Decision category — whose decision is it?**

| Category | Meaning |
|---|---|
| **A — Engineering-controlled now** | Settled by engineering; recorded here only where this document previously implied otherwise |
| **B — Development / pre-adoption selectable, production-replaceable** | Engineering may choose one now; an adopting organisation replaces it in production |
| **C — Adopter-specific** | Belongs to whoever adopts and operates the platform |
| **D — Religious, legal or safeguarding authority** | Belongs to an authority; **no engineering judgement substitutes for it** |
| **E — Production infrastructure or credential gate** | Requires provisioning, access or credentials the project does not control |

**Gate type — what does it actually block?** (DELIVERY_PLAN.md §3.1)

| Gate | Blocks |
|---|---|
| **Implementation** | Building and proving the software |
| **Activation** | Switching a delivered capability on in production |
| **Content acceptance** | Publishing authoritative real content |
| **Launch** | Going live on the official origin |

> **A decision that gates activation, content or launch does not necessarily gate
> implementation.** Where it genuinely determines required software semantics — a guardian
> consent rule, an age threshold — it **does** gate implementation of that behaviour, and the
> capability stays fail-closed until it exists (SECURITY_BASELINE.md §19.3).
>
> **A development substitute never closes a production gate.** Choosing an email provider does
> not prove deliverability; a sandbox payment account is not a merchant account; a non-
> authoritative fixture is not a corpus.

---

## 1. Religious authority

The most consequential group. **These require consultation that cannot be compressed later —
raise them first.**

### 1.1 Authoritative Quran text source
**Owner:** Minhaj · **Gates:** Phase 18 · **Priority:** Critical

Required: which Quran text Minhaj considers authoritative, in which encoding and script, and
against which reference imported Arabic must be verified character-by-character.

**Why external:** **A religious authority decision. Emphatically not an engineering choice,
and no engineering judgement may substitute for it.**

**Category D · Gate: content acceptance and activation.**

**If unanswered:** **no real Quran corpus is imported, published or activated — ever, on
assumption.** Phase 18's **engineering implementation** may still proceed against controlled,
**unmistakably non-authoritative fixtures** that prove schema, reader, permissions, audit,
search and the character-level verification *mechanism* (DELIVERY_PLAN.md, Phase 18). **Fixtures
are never represented as Quranic scripture**, and an engineering exit is **never** described as
corpus approval.

### 1.2 Approved translations, tafsir and recitations
**Owner:** Minhaj · **Gates:** Phase 18 · **Priority:** High

Which translation works, tafsir works and reciters are approved for publication, plus any
licensing or attribution requirements.

### 1.3 Authoritative Hadith sources and grading authority
**Owner:** Minhaj · **Gates:** Phase 19 · **Priority:** Critical

Which collections and editions are authoritative, which grading system is used, and **who
holds authority over gradings**.

**Why external:** Hadith grading is a scholarly discipline. **The platform never infers,
generates or assigns a grading** — it stores what an authority provides.

**Category D · Gate: content acceptance and activation.**

**If unanswered:** **no real Hadith corpus is published or activated.** Phase 19's **engineering
implementation** may proceed against non-authoritative fixtures proving hierarchy, reference and
edition identity, sourced grading and chain fields, permissions, audit, search and conflict
escalation. **No grading is ever invented and presented as real**, and an engineering exit is
never scholarly acceptance.

### 1.4 Authorised Fatwa scholars
**Owner:** Minhaj · **Gates:** Phase 20 · **Priority:** Critical

**Which named individuals receive the `fatwa.publish` permission**, the approval process, who
triages questions before assignment, and the escalation path for sensitive questions.

**Why external:** **The highest-consequence permission in the platform.** An incorrect grant
means a religious ruling published under Minhaj-ul-Quran's name by an unauthorised person.

**Category D · Gate: content acceptance and activation.**

**If unanswered:** **no real `fatwa.publish` grant is issued and no real Fatwa is published.**
Phase 20's **engineering implementation** may proceed against clearly synthetic questions,
rulings and test identities, proving the private workflow, publication authorisation, step-up,
anonymisation, audit and the absence of every bypass path. **Synthetic material is never
presented as a genuine Fatwa.**

### 1.5 Religious content review capacity
**Owner:** Minhaj · **Gates:** Phases 18, 19, 30 · **Priority:** High

Who performs religious QA during migration, and their realistic capacity.

**Why it matters:** **The most likely schedule constraint in the entire project.** Review
cannot be accelerated by engineering effort, which is why the delivery plan carries no fixed
deadline.

### 1.6 Source-conflict escalation path
**Owner:** Minhaj · **Gates:** Phase 30 · **Priority:** Medium

Who decides when authoritative sources disagree on religious content.

**Interim position:** Conflicts are surfaced and blocked — **never silently resolved**.

---

## 2. Safeguarding and legal

### 2.1 Under-18 learners — safeguarding policy
**Owner:** Minhaj · **Gates:** Phases 23, 24, 25 · **Priority:** Critical

Required decisions: **whether minors are supported** · age thresholds · parental/guardian
consent · **teacher vetting** · one-to-one communication rules · reporting and escalation ·
moderation requirements · retention requirements.

**Category D · Gate: activation — and implementation only for behaviour the policy itself
determines.**

**Why external:** A safeguarding policy decision with legal and child-protection dimensions.

**What engineering may build meanwhile.** Phases 23–25 may implement and test the
**policy-independent, default-deny mechanics** — current-assignment checks, relationship checks,
participant authorisation, private meeting-URL handling, attendance, blocking, reporting,
moderation primitives, message security and revocation behaviour. Until the policy exists,
**under-18-specific capability and student-to-student messaging remain disabled** as a
**fail-closed pre-policy state**, and **no consent rule, age threshold, vetting policy or
minor-retention rule is invented by engineering** (SECURITY_BASELINE.md §19.3).

**This is not a declaration that the platform is adults-only**, and it does not close this gate.

**Still OPEN after Phase 22.** Phase 22 delivered the Course catalogue, self-enrolment, lesson
progress and trial-class REQUESTS with no age, guardian, minor or vetting field and no rule about any
of them; a trial request schedules nothing and no teacher reaches a learner (DOMAIN_MODEL.md §13.4).
Teacher/student live learning — this gate's first subject — remains Phase 23's.

**Still OPEN after Phase 23.** Phase 23 delivered the policy-independent, default-deny mechanics
only (DOMAIN_MODEL.md §13.5): typed teaching scopes under a live `teaching.perform` grant, bookable
windows, conflict-safe trial confirmation, sessions, attendance, revocation and replacement,
private meeting addresses and service mail. It invented no age threshold, guardian consent, vetting,
one-to-one or retention rule, stores no note about a learner, and ships **no activation**: the
`LiveLearningActivation` row that switches live learning on is absent, and an `approved` row records
this decision when it is made. Student-to-student messaging does not exist (Phase 24 not started).

**Still OPEN after Phase 24.** Phase 24 delivered non-realtime Messaging as policy-independent,
default-deny mechanics (DOMAIN_MODEL.md §15.6): current-relationship authorisation on every read and
write, blocking, reporting, bounded moderation evidence, attachment security and the
account-closure terminal-history rule. It invented no age, guardian, vetting, one-to-one or
retention rule, and ships **no activation**: `MessagingActivation` holds no row for any kind, so
teacher↔student and support messaging are OFF, and student-to-student stays off behind a peer
policy that denies every pair.

**Still OPEN after Phase 25.** Phase 25 added the realtime transport over the same services — live
delivery, ephemeral presence and typing, all re-authorised per event and per recipient — and decided
nothing above. No activation row exists, so nothing is delivered live in production.

**Why it matters:** It **materially changes** consent flows, messaging policy, moderation and
data handling. Far cheaper to know before Phase 23 than after.

**Gates specifically:** teacher/student live learning · one-to-one messaging ·
student-to-student messaging.

> **This does NOT block Phase 0B tooling or foundation work**, nor any content domain. All
> other phases proceed.

### 2.2 Applicable jurisdictions
**Owner:** Minhaj · **Gates:** Phases 21, 33 · **Priority:** High

Which data protection regimes apply. An international organisation with EU and UK users faces
GDPR and equivalent obligations.

**Why it matters:** Determines consent handling, data subject rights, retention, breach
notification and any residency constraints.

**Interim position:** The architecture supports export, deletion and consent tracking
regardless.

**Still OPEN after Phase 21.** Phase 21 delivered export, closure disposition, newsletter double
opt-in and consent evidence on privacy-minimising engineering defaults (SECURITY_BASELINE.md
§19.1.2). It decides none of the questions above: no retention period, legal hold, residency rule,
statutory deadline, age rule or named-jurisdiction compliance claim exists, and this gate still
applies to Phase 33. Phase 22 added Learning's export and closure disposition on the same defaults
(SECURITY_BASELINE.md §19.1.3) and decided nothing above either. Phase 23 extended both to classes on
the same privacy-minimising defaults (§19.1.4) and decided nothing above either. Phase 24 added
Messaging's export and disposition (§19.1.5): a reported conversation is kept as evidence and every
other conversation is disposed once all its non-support participants have closed their accounts —
an engineering lifecycle, not a retention period, which this decision still owns.

### 2.3 Legal document content
**Owner:** Minhaj · **Gates:** **Phase 6 — publication.** Phase 4 reserves the routes only ·
**Priority:** Medium

Privacy policy, terms of use, cookie policy and accessibility statement content.

Routes are reserved in Phase 4 (ROUTE_MAP.md §3.10). **The Page aggregate and the editorial
workflow that publishes this content are introduced in Phase 6, not Phase 4**
(DELIVERY_PLAN.md), so the true publishing owner is Phase 6.

> **Route reservation is not publication authority.** Phase 4 shell configuration may carry
> labels, titles, UI chrome and **non-authoritative placeholders** only. **Legal document bodies
> are never delivered as Phase 4 configuration**, and a placeholder is **replaced** by a genuine
> Page record rather than migrated into an informal configuration store. The Phase 6 workflow —
> revisions, review permissions, sanitisation and audit — is the **only** production publication
> route for this content.

**Content is an organisational and legal responsibility — engineering will not draft them.**

### 2.3.1 Correspondence retention and intake activation
**Owner:** Minhaj privacy/legal and support owners · **Gate:** Phase-6 correspondence
activation · **Status:** Open.

Approve the retention period for ContactInquiry and Feedback before enabling public intake.
Engineering provides the server-only `CORRESPONDENCE_RETENTION_DAYS` gate; absence disables
submission. Its 1–3650 whole-day range is an engineering bound, not an accepted retention
policy. Synthetic disposable tests use their own explicit test value and confer no approval.

Each accepted submission fixes its own UTC retention deadline. Later configuration changes
apply only to new submissions. Expired rows are excluded from operator reads and triage and
are purged in bounded batches, including contact details, body and private notes. Audits retain
only action/state/opaque identifiers, never correspondence text. Backup disposition remains
part of the approved backup/retention policy (§4.4), so restoring a backup does not reactivate
expired data. No legal-hold or minors-specific policy is inferred.

### 2.4 Content licensing and attribution
**Owner:** Minhaj · **Gates:** Phases 8, 18, 19, 30 · **Priority:** Medium

Licensing for third-party translations, tafsir works and recitations · required attribution ·
whether content may be downloaded or only read online · **per-asset licensing for migrated
binaries** (MIGRATION_STRATEGY.md §4.9).

### 2.5 Student↔student messaging policy
**Owner:** Minhaj · **Gates:** Phase 24 · **Priority:** Medium

Whether students may message one another, under what approval, and the moderation and
reporting policy.

**Interim position:** Disabled by default. The model supports it "where policy permits"; the
policy must exist before it is enabled.

**Still OPEN after Phase 24.** The mechanics exist and are proven only against a disposable test
policy: the `student-student` conversation kind, its activation row (absent) and a peer-policy seam
whose production wiring refuses every pair. No "same Course" or other relationship is recorded as
approved policy, no learner directory exists, and no permission or setting can enable it. Phase 25
added no realtime shortcut: the transport asks the same peer policy, which still refuses every pair.

---

## 3. Content migration authorisation

### 3.1 Written authorisation per source
**Owner:** Minhaj · **Gates:** **Phase 30 — not Phase 29** · **Priority:** Critical

**Explicit written authorisation for each source**: main Minhaj.org, Minhaj Books, TheFatwa,
Minhaj.TV, Irfan-ul-Quran, magazines and publications, eLearning catalogue, and any other.

**Why external:** **Minhaj owning a site is not itself authorisation.** Some may be operated
by third parties, carry licensing constraints, or contain content Minhaj does not wish to
migrate.

**What this does NOT block.** **Phase 29 — migration framework development — proceeds without
it**, working exclusively against:

- local fixtures
- synthetic fixtures
- previously approved test fixtures
- **no live legacy-source access of any kind**

**What this DOES block — mandatory before any of the following:**

- **Phase 30 live-source adapters and access**
- **fetching any real legacy Minhaj source for migration**
- **copying any real asset**
- **running live ingestion**

**If unanswered:** the framework is built and proven against fixtures; **no real source is
ever contacted.** The requirement for written authorisation before real source access is
absolute and is not weakened by this clarification.

### 3.2 Source, API or export access
**Owner:** Minhaj · **Gates:** Phase 30 · **Priority:** High

Whether any legacy system can provide database exports, API access, admin exports or
structured content dumps — per source.

**Why it matters:** Structured export is **dramatically** more reliable than reconstructing
records from published HTML.

> **No legacy database dump or export is currently available or assumed. Minhaj may later
> provide exports, API access, source access or other authorised migration sources.** This
> possibility is not foreclosed; it is simply not assumed.

**If unanswered:** Migration proceeds via authorised public-content ingestion, with higher
parsing effort and review burden.

### 3.3 Migration scope per source
**Owner:** Minhaj · **Gates:** Phase 30 · **Priority:** Medium

What to migrate, what to leave behind, what is obsolete or superseded, and what Minhaj wishes
to retire rather than carry forward.

### 3.4 Legacy domain control and cutover
**Owner:** Minhaj · **Gates:** Phase 35 · **Priority:** Medium

**DNS control** and **access to legacy hosting** to implement redirects · whether legacy
domains redirect to Minhaj.org · timing · whether any legacy site continues operating ·
**who can execute a cutover rollback** (MIGRATION_STRATEGY.md §7.3).

**Why it matters:** Preserving inbound links and citations depends on access this project does
not control.

---

## 4. Infrastructure and hosting

### 4.1 Staging and production SQL Server infrastructure
**Owner:** Minhaj / Joint · **Gates:** **Phases 28 and 34 — not Phase 1** · **Priority:** High

> **Local development SQL is NOT an open decision.** It is engineering-controlled and is
> explicitly separated below, because conflating the two would block foundation work on an
> unprovisioned production server.

#### Engineering-controlled — not an open decision, proceeds now

- **Microsoft SQL Server 2022 Developer edition** on a **local developer instance**
- Local credentials and configuration
- Local schema, migrations, seed data and restore rehearsal

**This requires nothing from Minhaj and may proceed immediately during foundation work.
Phase 1 depends on it and on nothing else.**

#### Genuine external decisions — these remain open

| Decision | Gates |
|---|---|
| **Staging** SQL Server instance and access | Phase 28 |
| **Production** SQL Server instance and access | Phase 34 |
| Hosting arrangement (containerised, dedicated host, or managed) | 28, 34 |
| **Production licensing** where applicable | 34 |
| **Company DBA ownership and responsibility** | 28, 34 |
| **Backup and restore responsibility** — who operates and verifies it | 28, 34 |
| **Network and firewall access** to the database hosts | 28, 34 |
| **HA/DR expectations**, if any apply | 34 |
| Staging and production **connection details** | 28, 34 |

**Why external:** Licensing, hosting, network access and operational ownership carry cost,
contractual and staffing implications.

> **Phase 1 is not blocked because production infrastructure is unprovisioned.** It is
> blocked only if a local Developer edition instance cannot be stood up — which is within
> engineering's control.

**If unanswered:** Local development and Phase 1 proceed normally. **Staging (Phase 28) and
production (Phase 34) cannot.**

### 4.2 Staging environment
**Owner:** Minhaj · **Gates:** Phase 28 · **Priority:** High

**Why it matters:** Migration dry-runs and religious QA must **never** run against production.
Phase 28 delivers staging **before** migration needs it.

### 4.3 Production hosting
**Owner:** Minhaj · **Gates:** Phase 34 · **Priority:** High

Linux host provisioning and specifications · network access · TLS certificate management · who
administers the host.

### 4.4 Backup, retention and recovery targets
**Owner:** Joint · **Gates:** Phases 28, 34 · **Priority:** High

Backup frequency and retention · offsite storage · RPO and RTO targets · **log, audit and raw
snapshot retention periods** (MIGRATION_STRATEGY.md §8.3).

**Why external:** Retention is a policy and compliance decision.

**Interim position:** Daily backups with tested restores and conservative retention defaults.
**A backup that has never been restored is not a backup.** **Local restore rehearsal in
Phase 1 is engineering-controlled and proceeds regardless** (§4.1).

---

## 5. External services

### 5.1 Transactional email provider
**Owner:** Joint · **Gates:** **Phase 2 — and, transitively, every phase downstream of Phase 2**
· **Priority:** High

The provider for verification, reset and notification email · sending domain · SPF, DKIM and
DMARC configuration.

**Why it matters:** Email verification and password reset are unusable without reliable
delivery; poor domain configuration means messages land in spam.

> **This WAS the Phase 2 entry gate.** Because Phase 2 is an early prerequisite for most later
> work, it was **the earliest broadly-blocking external decision in the plan**. Phases that
> inherited it transitively include **3B (Taxonomy), 4, 5, 6, 20, 26, 27 and 29** — 29 because
> its protected migration administration requires Identity, **not** because of any
> source-authorisation requirement (§3.1).
>
> **Work that never depended on it: Phases 0B, 1, 3A and 7.**

**Category B · Gate: implementation (for Phase 2) — CLOSED ON EVIDENCE.**

**Provider selected, and the development/pre-adoption sending gate is closed.** The first
`EmailProvider` adapter is **Resend**, with the development sender domain
`mail.minhajulquran.haseebliaqat.me` on the pre-adoption origin
`minhajulquran.haseebliaqat.me` (ARCHITECTURE.md §4.6). The unrelated sender
`notify.haseebliaqat.me` belongs to **ParaForce** and stays separate.

> **Selecting a provider was not evidence of deliverability.** The gate required **all** of the
> following, and **each has been demonstrated**:
>
> - the **sending domain is verified** — ✅;
> - **SPF**-related sending configuration is correct and verified — ✅;
> - **DKIM** is verified — ✅;
> - **DMARC** is configured — ✅;
> - a **restricted sending credential** is securely provisioned, scoped to that sender domain
>   — ✅;
> - **delivery to a real controlled inbox succeeds** — ✅.

> **What this closes, and what it does not.** It closes the **development / pre-adoption**
> transactional sending gate, which is what Phase 2 needed in order to begin and to be proved.
> It does **not** decide the **official, adopter-controlled production** sender, which remains a
> later deployment and activation concern and is replaced without code change
> (ARCHITECTURE.md §10.5.3).
>
> **Webhook provisioning and the signing secret are deployment setup, not part of this gate.**
> Their absence in an environment refuses inbound callbacks; it never reopens sending, and it
> never causes an unverified callback to be accepted (SECURITY_BASELINE.md §7.2).

**The official production email account and sender remain organisation-controlled and separate**,
and are replaced at adoption without code change (ARCHITECTURE.md §10.5.3). **No API key or
secret is recorded in this repository.**

**Interim position:** the `EmailProvider` abstraction is the boundary; **no business context ever
calls a provider directly** (ARCHITECTURE.md §4.6.1).

### 5.2 Google OAuth application credentials
**Owner:** Minhaj · **Gates:** **Phase 2G** (the only phase in the current V1 delivery plan
requiring them) · **Priority:** High

An OAuth client with authorised redirect URIs per environment · consent-screen configuration
and verification status · which account owns the project.

**What these credentials gate:**
- **Google sign-in (Phase 2G)** — the only requirement within the current V1 delivery plan.
- **Any future explicitly approved Google API integration** — for example automated
  Calendar/Meet provisioning — **will have its own credential requirements**. Such
  integrations remain **deferred** and are out of scope for V1, but the need is not excluded
  for the future.

**What they do NOT gate:**
> **Manual Google Meet classes (Phase 23) do NOT require our application to hold Google
> OAuth, Calendar or Meet API credentials.**

In V1 a teacher or administrator pastes a Meet URL they created themselves in Google. The
application stores and validates a string; it never talks to a Google API. Treating OAuth
credentials as a prerequisite for that flow was an error, since the two are unrelated.

Base email/password authentication (Phase 2) is likewise independent.

### 5.3 Google Meet availability for teachers
**Owner:** Minhaj · **Gates:** Phase 23 · **Priority:** Medium

**This is an organisational capability question, not an application credential question.**

Required: that the organisation and its teachers **can legitimately create and use Google Meet
meetings** — accounts with Meet access sufficient for class duration and participant limits ·
who creates meeting links · the **safeguarding and business rules** governing their use
(§2.1).

**No application-side Google API credential is required for the manual Meet flow** (§5.2).
Automatic Calendar/Meet creation remains deferred, and **any future explicitly approved Google
API integration would have its own credential requirements.**

**Still OPEN after Phase 23.** The manual flow is delivered: a teacher or operator pastes a
`meet.google.com` address, the platform validates and stores the string, and discloses it only to
authorised participants while a session is scheduled. Whether the organisation and its teachers
may legitimately create and use such meetings is not decided by that engineering, and no activation
row records it.

### 5.4 Payment provider
**Owner:** Minhaj · **Gates:** Phase 27 only · **Priority:** Low–Medium

Provider(s) · supported currencies and regions · recurring donations · Gift Aid or equivalent
· existing merchant arrangements.

**Why external:** Depends on Minhaj's banking, regulatory jurisdiction and financial
arrangements.

> **This blocks Donations only. Membership (Phase 26) is independent and proceeds without it.**

**Category C/E · Gate: activation for Phase 27; never implementation.**

**Sandbox proves the software; a merchant account activates it.** The donation lifecycle is
provider-neutral (DOMAIN_MODEL.md §17.3), so Phase 27 can be **built and proven against a
provider sandbox**. **Production readiness — the organisation's own merchant and provider
account — is separately gated and is not closed by a successful sandbox integration.**

**Constraint regardless of choice:** **no card or payment credential data is ever stored.**

---

## 6. Organisational content and data

### 6.1 Canonical organisational facts
**Owner:** Minhaj · **Gates:** **Phase 6 — publication.** Phase 4 reserves the routes and
renders shell UI and non-authoritative placeholders only · **Priority:** Medium

Authoritative current content for vision, mission, values, objectives, history, timeline,
leadership, governance, departments, forums, wings, institutions, UN recognition and awards.

**Why external:** **Organisational facts are never invented or inferred from legacy pages that
may be outdated.** Legacy content may start the process but requires confirmation.

**Where it is published.** The editorial **Page** aggregate and its review workflow are
introduced in **Phase 6** (DELIVERY_PLAN.md). Phase 4 delivers the public shell and reserves
these routes without creating a Page model, so organisational content is published through the
Phase 6 workflow like any other editorial content — **there is no parallel publishing path**.

> **Canonical organisational facts are explicitly excluded from Phase 4 shell configuration.**
> Vision, mission, values, objectives, history, timeline, leadership, governance and the rest are
> substantive content: they enter the system as **Page** records through the Phase 6 workflow,
> under its permissions and audit. Phase 4 may show a **non-authoritative placeholder** on a
> reserved route; it may not publish an organisational fact as configuration, and a placeholder
> is **replaced** rather than carried forward.

### 6.2 Centre and global network data
**Owner:** Minhaj · **Gates:** Phase 16 · **Priority:** Medium

The authoritative list of countries, regions, cities and centres with current contact details,
and whether an existing register can be exported.

**Why it matters:** Find a Centre is a primary navigation feature, and **outdated contact
details are worse than none**.

### 6.3 Contributor records and capability grants
**Owner:** Minhaj · **Gates:** Phases 5, 20, 23 · **Priority:** Medium–Critical

Authoritative Person records, profiles, qualifications and expertise — and critically, **which
individuals receive which permission grants** (`teaching.perform`, `question.receive`,
`content.review`, `fatwa.answer`, **`fatwa.publish`**).

The `fatwa.publish` portion is Critical and duplicated at §1.4 because of its consequence.

**Still OPEN after Phase 22.** Learning's catalogue keys (`learning.read`, `learning.administer`)
are ordinary administrative keys and confer no teaching authority; `teaching.perform` is still not
catalogued, and naming a person as a Course's teacher is public attribution that grants nothing.

**Still OPEN after Phase 23.** `teaching.perform` is now catalogued and externally gated — bundled
into no role and held by nobody. A real teacher is named by the organisation and granted through
the ordinary audited `permissions.grant` lifecycle; an operator then scopes that account to a
Course. No such grant and no scope exists in the delivered database.

### 6.4 Brand and visual identity
**Owner:** Minhaj · **Gates:** Phase 4 · **Priority:** Medium

Logo assets · colour palette · approved typefaces **including Urdu and Arabic typefaces with
licensing** · brand guidelines.

**Category C · Gate: content acceptance for the brand assets; not implementation.**

**Why it matters:** Arabic and Urdu typography is not a detail. Poor font selection makes
religious text hard to read and can render it inappropriately.

**What is already decided.** The **token structure** and the typography contract are engineering
decisions and are settled (ARCHITECTURE.md §13.2–§13.3): semantic colour roles, spacing, radius,
elevation, and tri-script type behaviour. **No arbitrary palette or typeface is frozen without
accepted brand evidence** — and because the structure is semantic, supplying the real values
later is a token substitution rather than a redesign. **Font licensing is recorded at
introduction** (TECH_STACK.md §18).

### 6.5 Content team structure and roles
**Owner:** Minhaj · **Gates:** Phase 6 · **Priority:** Medium

Who authors, reviews and publishes · whether the **separation of duties** default (an author
cannot approve their own work) is workable, or whether documented, audited exceptions are
needed.

### 6.6 Support and moderation ownership
**Owner:** Minhaj · **Gates:** Phase 24 · **Priority:** Medium

Who staffs support conversations · response expectations · **who moderates reported messages
and may access moderation evidence**.

**Still OPEN after Phase 24.** `messaging.support` and `messaging.moderate` are catalogued and
externally gated — bundled into no role and held by nobody; a Platform Administrator holds neither.
Support conversations, the support queue, reports and moderation exist as engineering mechanics,
with every content and evidence access audited, but the `support` activation row is absent, so no
support conversation can start, and nobody can read a report's evidence until the organisation names
holders through the ordinary audited `permissions.grant` lifecycle. No response-time promise exists.
Phase 25 keeps support staff off the realtime transport entirely, so their audited access is unchanged.

---

## 7. Access and tooling

### 7.1 Search Console and analytics access
**Owner:** Minhaj · **Gates:** Phase 35 · **Priority:** Low

Search Console access for the domains, and whether analytics are wanted.

**Split from engineering:** *Access to the accounts* is external. **Sitemap and canonical
design is an engineering responsibility and is already settled** (ROUTE_MAP.md §9).

**Interim position:** No third-party analytics assumed. Adding one has CSP and privacy
implications that must be deliberate.

---

## 8. Decisions deliberately NOT listed here

Recorded so this document is not mistaken for a list of everything undecided. Each of the
following **is decided**:

| Decided | Where |
|---|---|
| 16 bounded contexts; infrastructure is not a domain | DOMAIN_MODEL.md §1 |
| Explicit acyclic dependency allowlist, incl. `Messaging → Learning` and `Editorial → Global Network` | ARCHITECTURE.md §6 (canonical); DOMAIN_MODEL.md §3.1–3.2 |
| Personalisation deletion integrity: archive by default; a durable, resumable, owner-coordinated purge for hard deletes (typed releases since Phase 21) | DOMAIN_MODEL.md §14.3, §14.6 |
| Conditional `x-default` resolution | ROUTE_MAP.md §9.2.1 |
| Realtime as a transport adapter; `server-core` hosts context-owned services and owns nothing | ARCHITECTURE.md §3.1 |
| **Model A — encapsulated persistence through context-owned services; invoking a service that persists is not holding raw database capability** | ARCHITECTURE.md §3.1.1–§3.1.2, §4.1 |
| **Persistence adapters may live physically inside `packages/database` while remaining semantically owned by their context** | ARCHITECTURE.md §4.1; DOMAIN_MODEL.md §2 rule 7 |
| **`server-core` admission timing — permitted ahead of the second process only for a concrete scheduled consumer** | ARCHITECTURE.md §3.1.3 |
| **Bounded-context ownership is enforced by application architecture, interfaces and tests — not by the single application SQL principal** | ARCHITECTURE.md §4.1 |
| **My Minhaj is a Layer-4 composition surface, not a context that owns everything under `/my`** | DOMAIN_MODEL.md §14.4; ROUTE_MAP.md §5 |
| **Historical audit identifiers are evidence, not polymorphic relational references; the Phase 1 `AuditLog` representation is unchanged** | DOMAIN_MODEL.md §6.2.1; SECURITY_BASELINE.md §13.3 |
| **Three mutation protocol models — browser CSRF, signed machine callbacks, authentication callbacks — plus emailed-link token semantics** | SECURITY_BASELINE.md §7 |
| **Compatibility is validated in the phase that actually introduces a dependency** | TECH_STACK.md §1.2, §1.5, §16 |
| **Localisation Foundation (3A) is separated from Taxonomy (3B) to remove the `2 → 3 → 2` cycle** | DELIVERY_PLAN.md §2, Phases 3A and 3B |
| Migration & Provenance ownership | DOMAIN_MODEL.md §16 |
| Typed relationships; no polymorphic references | DOMAIN_MODEL.md §6.2 |
| People & Contributors model | DOMAIN_MODEL.md §5 |
| Permissions as the single enforcement path; capabilities as projections | DOMAIN_MODEL.md §4.4–4.5 |
| Personalisation & Notifications ownership | DOMAIN_MODEL.md §14 |
| Quran owns Recitation; Media projects only | DOMAIN_MODEL.md §8.1 |
| Work / Edition / Translation | DOMAIN_MODEL.md §10.1 |
| Canonical routing and the full SEO contract | ROUTE_MAP.md §2, §9 |
| Public caching boundary | ARCHITECTURE.md §8 |
| **Arabic/Urdu FTS tokenisation — an engineering validation risk, proven in Phases 17 and 31** | TECH_STACK.md §10; DELIVERY_PLAN.md |
| RateLimiter abstraction; no mandatory distributed limiter; no Redis | SECURITY_BASELINE.md §15 |
| Realistic audit integrity baseline | SECURITY_BASELINE.md §13.1 |
| CSRF policy and step-up reauthentication | SECURITY_BASELINE.md §7–8 |
| Upload quarantine and scanning requirement | SECURITY_BASELINE.md §10 |
| Migration reconciliation, manifests and rollback | MIGRATION_STRATEGY.md §6–7 |
| Complete locked stack; no automatic downgrade | TECH_STACK.md |
| Phase sequencing, vertical slices and exit criteria | DELIVERY_PLAN.md |
| npm workspaces; no Turborepo; no Kubernetes; no Azure | ARCHITECTURE.md; TECH_STACK.md |

**Closed at the pre-Phase-2 product-completeness review.** Several of the following were
previously left implicit or were treated as open; each is an engineering decision and is now
settled:

| Decided | Where |
|---|---|
| **Four gate types** — implementation, activation, content acceptance, launch | DELIVERY_PLAN.md §3.1 |
| **Search Foundation is an explicit prerequisite** of Phases 9, 10 and 13; **11 depends on 7**; **21 depends on 10** | DELIVERY_PLAN.md §2 |
| **Cross-context consistency without a generic transaction port**; purge is durable, fail-closed and owner-coordinated | ARCHITECTURE.md §3.1.2.1; DOMAIN_MODEL.md §14.3 |
| **Derived work — search, cache, sitemap, email, provider effects — is not atomic with the authoritative transaction** | ARCHITECTURE.md §8.5 |
| **Privileged MFA is a V1 requirement, scoped to high-consequence capabilities**; general-user MFA is not mandatory; no SMS MFA | SECURITY_BASELINE.md §8.2 |
| **Initial privileged operator bootstrap** — one-time, race-safe, audited, self-closing | SECURITY_BASELINE.md §8.3 |
| **Account lifecycle invariants**, including that provider-specific email rewriting is not global canonicalisation | DOMAIN_MODEL.md §4.6 |
| **Account locale and timezone are Identity-owned**; personalisation onboarding is separate | DOMAIN_MODEL.md §4.2; INFORMATION_ARCHITECTURE.md §5 |
| **Outbound communication ownership and durable delivery intent**; Better Auth retains sole token authority | ARCHITECTURE.md §4.6.1 |
| **Contact and Feedback belong to a limited private correspondence area in Editorial** | DOMAIN_MODEL.md §7.5 |
| **Newsletter is Personalisation-owned, independent of User, double opt-in** | DOMAIN_MODEL.md §14.5 |
| **`Messages → Support` is a Messaging conversation type**, not a ticketing context | DOMAIN_MODEL.md §15.5 |
| **Native slug history is context-owned**; `LegacyMapping` is legacy-source only | DOMAIN_MODEL.md §19.7 |
| **Concurrency and scheduled publication semantics** | DOMAIN_MODEL.md §19.8; ARCHITECTURE.md §8.5 |
| **Time, timezone and money rules** | DOMAIN_MODEL.md §19.5–§19.6 |
| **Design-system staged ownership and the experience contract** | ARCHITECTURE.md §13 |
| **Playwright is introduced in Phase 2** | TECH_STACK.md §1.5 |
| **Complete recovery covers database *and* authoritative assets** | ARCHITECTURE.md §10.4 |
| **Handover levels, origin portability, and the build-time origin caveat** | ARCHITECTURE.md §10.5 |
| **Horizontal scaling is conditional, not automatic** | ARCHITECTURE.md §3.5.1 |
| **Legacy exports are migration sources, never the target database**; source withdrawal requires reconciliation; promotion uses a reviewed manifest | MIGRATION_STRATEGY.md §1.3, §5.3, §10.1.1 |
| **Byte deduplication never merges rights or provenance** | MIGRATION_STRATEGY.md §5.2 |
| **Audit payloads are minimised** | SECURITY_BASELINE.md §13.4 |
| **Software accessibility and content conformance are accepted separately** | SECURITY_BASELINE.md §16.3 |
| **Pre-adoption deployment is non-indexable and claims no official adoption** | PRODUCT_SCOPE.md, *Product status and acceptance*; ROUTE_MAP.md §9.5 |
| **One organisation per deployment** — no multi-tenancy, no white-label engine | ARCHITECTURE.md §10.5.3 |
| **Unscheduled items gain no route or navigation** | PRODUCT_SCOPE.md §4.4; ROUTE_MAP.md §5.2 |

---

## 9. Blocking summary

**Every entry in this document is classified below** by category (A–E) and by what it actually
gates. A decision may gate more than one thing.

| # | Decision | Cat. | Gate type | Gates phase | Consequence if unresolved |
|---|---|---|---|---|---|
| 1.1 | Authoritative Quran text source | **D** | Content acceptance · activation | 18 | **No real corpus is imported or published.** Engineering implementation proceeds on non-authoritative fixtures |
| 1.2 | Approved translations, tafsir, reciters | **D** | Content acceptance | 18 | Those layered works are not published |
| 1.3 | Authoritative Hadith sources and grading authority | **D** | Content acceptance · activation | 19 | **No real corpus is published.** Engineering implementation proceeds on fixtures |
| 1.4 | Authorised Fatwa scholars | **D** | Content acceptance · activation | 20 | **No real grant is issued and no real Fatwa published.** Engineering implementation proceeds on synthetic material |
| 1.5 | Religious review capacity | **D** | Content acceptance | 18, 19, 30 | Publication throughput, not engineering progress |
| 1.6 | Source-conflict escalation path | **D** | Content acceptance | 30 | Conflicts are surfaced and blocked, never silently resolved |
| 2.1 | Under-18 safeguarding policy | **D** | **Activation**, plus implementation of policy-determined behaviour | 23, 24, 25 | **Fail-closed pre-policy state**: minors-specific capability and student-to-student messaging stay disabled; default-deny mechanics may still be built |
| 2.2 | Applicable jurisdictions | **D** | Activation · launch | 21, 33 | Export, deletion and consent tracking are supported regardless |
| 2.3 | Legal document content | **D** | Content acceptance | 6 publishes | Routes reserved; **no body content published as configuration** |
| 2.3.1 | Correspondence retention period | **D** | Activation | 6 | Public intake stays disabled until the privacy/legal and support owners approve a period |
| 2.4 | Content licensing and attribution | **D** | Content acceptance | 8, 18, 19, 30 | Affected material is not published or migrated |
| 2.5 | Student↔student messaging policy | **D** | Activation | 24 | Disabled by default |
| 3.1 | Written migration authorisation per source | **D** | **Implementation of live-source work**; activation | **30 only** | **No live ingestion.** **Phase 29 framework proceeds on fixtures** |
| 3.2 | Source, API or export access | **C** | Content acceptance quality | 30 | Higher parsing effort; **an export is a source, never the target** (MIGRATION_STRATEGY.md §1.3) |
| 3.3 | Migration scope per source | **C** | Content acceptance | 30 | Scope undetermined |
| 3.4 | Legacy domain control and DNS | **C/E** | Launch | 35 | Legacy links break at launch |
| 4.1 | **Staging/production** SQL Server infrastructure and ownership | **E** | Implementation (28, 34) · launch | **28, 34** | Staging and production blocked. **Phase 1 proceeds on local Developer edition** |
| 4.2 | Staging environment | **E** | Implementation | 28 | Migration cannot run safely |
| 4.3 | Production hosting | **E** | Launch | 34 | Deployment blocked |
| 4.4 | Backup, retention and recovery targets | **C/E** | Launch | 28, 34 | Conservative defaults; **local restore rehearsal proceeds** |
| 5.1 | Transactional email provider **evidence** | **B** | **Implementation** | ~~2, and transitively everything downstream of 2~~ | **CLOSED ON EVIDENCE.** Domain, DKIM, sending/SPF configuration, DMARC, restricted credential and a real controlled-inbox delivery all demonstrated. **Official adopter-controlled production email remains a separate later activation** |
| 5.2 | Google **OAuth application credentials** | **C/E** | Activation | **2G** | **Google sign-in blocked.** Base auth (2) and the **manual Meet flow (23)** proceed without them |
| 5.3 | Teachers can create/use Google Meet meetings | **C** | Activation | 23 | Live classes not activated — **an organisational capability, not an API credential** |
| 5.4 | Payment provider and merchant account | **C/E** | Activation | **27 only** | **Sandbox proves the software; production needs the merchant account.** Membership proceeds |
| 6.1 | Canonical organisational facts | **D** | Content acceptance | 6 publishes | Placeholders only; **never published as configuration** |
| 6.2 | Centre and global network data | **C** | Content acceptance | 16 | Find a Centre has no authoritative data |
| 6.3 | Contributor records and capability grants | **D** | Activation · content acceptance | 5, 20, 23 | No real grants issued |
| 6.4 | Brand and visual identity | **C** | Content acceptance | 4 | **Token structure is decided**; real values substituted later |
| 6.5 | Content team structure and roles | **C** | Activation | 6 | Separation-of-duties default applies |
| 6.6 | Support and moderation ownership | **C** | Activation | 24 | Support conversations not staffed |
| 7.1 | Search Console and analytics access | **C** | Launch | 35 | No third-party analytics assumed |
**§5.1 remains the earliest broadly-blocking external gate.** It gates Phase 2, and therefore
transitively **3B, 4, 5, 6, 20, 26, 27 and 29** — 29 because its protected migration
administration requires Identity, **not** because of any source-authorisation requirement
(§3.1).

**Work that proceeds immediately with none of the above resolved:** Phases **0B**, **1 (on
local SQL Server 2022 Developer edition)**, **3A (localisation foundation — no database and no
Identity dependency)** and **7 (storage foundation — infrastructure only)**.

> **Correction.** An earlier revision listed Phases 3, 4, 5, 6 and 29 here as proceeding with
> nothing resolved. That contradicted the delivery gates: **Phase 5 depends on Phase 2**, Phase
> 2 carried the **transactional email provider entry gate** (§5.1), and **Phases 3B, 4 and 6 sit
> downstream of Phase 2** as well. **Phase 29 likewise depends on Phase 2**, because it delivers
> protected migration administration.
>
> **Update.** §5.1 is now **closed on evidence**, so Phase 2 is no longer gated on it and the
> phases downstream of Phase 2 no longer inherit it. Their remaining dependency is on Phase 2
> being **delivered**, which is an ordinary delivery dependency rather than an external one.
>
> **Phase 29 remains independent of live-source authorisation** (§3.1): it is fixture-only,
> contacts no real source, and copies no real asset. The gate it inherits is email (§5.1), not
> source authorisation. **Phase 30 still requires written per-source authorisation, unchanged.**

> **A reminder about what "blocked" means here.** Most of the entries above gate **activation,
> content acceptance or launch** — not **implementation** (DELIVERY_PLAN.md §3.1). Phases 18,
> 19, 20 and 23–25 can reach an **engineering implementation exit** while their external gates
> stay genuinely open, provided that fixtures are never passed off as authoritative content and
> that an engineering exit is never reported as religious, safeguarding or launch approval.
> **None of these gates is closed by a development substitute.**

**Raise §1.1, §1.3, §1.4, §1.5 and §2.1 first.** They require religious-authority and
safeguarding consultation that takes real time and cannot be compressed once the dependent
phases arrive. **Raise §5.1 with them**, because it is the earliest gate that blocks a broad
span of downstream work.
