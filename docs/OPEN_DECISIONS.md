# Open Decisions — One Minhaj Platform

**Status:** Phase 0A Architecture Freeze — revised after independent architecture audit

---

## Purpose and discipline

This document records **only genuine external, business, organisational or infrastructure
decisions that the project cannot resolve internally.**

It is **not** a place to defer engineering decisions. Every question a competent engineering
team can answer has been answered in the other nine documents.

Each item records what is needed, why it is external, which phase it gates, and what happens
if it remains unanswered.

**Owner:** *Minhaj* = Minhaj-ul-Quran International · *Dev* = development team · *Joint* = both.

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

**If unanswered:** **Phase 18 does not begin.** Quran text is never imported on assumption.

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

**If unanswered:** **Phase 19 does not begin.**

### 1.4 Authorised Fatwa scholars
**Owner:** Minhaj · **Gates:** Phase 20 · **Priority:** Critical

**Which named individuals receive the `fatwa.publish` permission**, the approval process, who
triages questions before assignment, and the escalation path for sensitive questions.

**Why external:** **The highest-consequence permission in the platform.** An incorrect grant
means a religious ruling published under Minhaj-ul-Quran's name by an unauthorised person.

**If unanswered:** **Phase 20 does not begin.**

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

**Why external:** A safeguarding policy decision with legal and child-protection dimensions.

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

### 2.3 Legal document content
**Owner:** Minhaj · **Gates:** Phase 4 · **Priority:** Medium

Privacy policy, terms of use, cookie policy and accessibility statement content.

Routes are reserved (ROUTE_MAP.md §3.10). **Content is an organisational and legal
responsibility — engineering will not draft them.**

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
**Owner:** Joint · **Gates:** Phase 2 · **Priority:** High

The provider for verification, reset and notification email · sending domain · SPF, DKIM and
DMARC configuration.

**Why it matters:** Email verification and password reset are unusable without reliable
delivery; poor domain configuration means messages land in spam.

**Interim position:** An `EmailProvider` abstraction is defined. **No provider is invented by
the architecture.**

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

### 5.4 Payment provider
**Owner:** Minhaj · **Gates:** Phase 27 only · **Priority:** Low–Medium

Provider(s) · supported currencies and regions · recurring donations · Gift Aid or equivalent
· existing merchant arrangements.

**Why external:** Depends on Minhaj's banking, regulatory jurisdiction and financial
arrangements.

> **This blocks Donations only. Membership (Phase 26) is independent and proceeds without it.**

**Constraint regardless of choice:** **no card or payment credential data is ever stored.**

---

## 6. Organisational content and data

### 6.1 Canonical organisational facts
**Owner:** Minhaj · **Gates:** Phase 4 · **Priority:** Medium

Authoritative current content for vision, mission, values, objectives, history, timeline,
leadership, governance, departments, forums, wings, institutions, UN recognition and awards.

**Why external:** **Organisational facts are never invented or inferred from legacy pages that
may be outdated.** Legacy content may start the process but requires confirmation.

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

### 6.4 Brand and visual identity
**Owner:** Minhaj · **Gates:** Phase 4 · **Priority:** Medium

Logo assets · colour palette · approved typefaces **including Urdu and Arabic typefaces with
licensing** · brand guidelines.

**Why it matters:** Arabic and Urdu typography is not a detail. Poor font selection makes
religious text hard to read and can render it inappropriately.

### 6.5 Content team structure and roles
**Owner:** Minhaj · **Gates:** Phase 6 · **Priority:** Medium

Who authors, reviews and publishes · whether the **separation of duties** default (an author
cannot approve their own work) is workable, or whether documented, audited exceptions are
needed.

### 6.6 Support and moderation ownership
**Owner:** Minhaj · **Gates:** Phase 24 · **Priority:** Medium

Who staffs support conversations · response expectations · **who moderates reported messages
and may access moderation evidence**.

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
| Explicit acyclic dependency allowlist, incl. `Messaging → Learning` | ARCHITECTURE.md §6 (canonical); DOMAIN_MODEL.md §3.1–3.2 |
| Personalisation deletion integrity: archive by default, transactional purge for hard deletes | DOMAIN_MODEL.md §14.3 |
| Conditional `x-default` resolution | ROUTE_MAP.md §9.2.1 |
| Realtime as a transport adapter; `server-core` hosts context-owned services and owns nothing | ARCHITECTURE.md §3.1 |
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

---

## 9. Blocking summary

| # | Decision | Gates | Consequence if unresolved |
|---|---|---|---|
| 1.1 | Authoritative Quran text source | 18 | **Phase 18 does not begin** |
| 1.3 | Authoritative Hadith sources and grading authority | 19 | **Phase 19 does not begin** |
| 1.4 | Authorised Fatwa scholars | 20 | **Phase 20 does not begin** |
| 3.1 | Written migration authorisation per source | **30 only** | **No live ingestion.** **Phase 29 framework proceeds on fixtures** |
| 2.1 | Under-18 safeguarding policy | 23, 24, 25 | **Teacher, live-class and messaging phases blocked** |
| 4.1 | **Staging/production** SQL Server infrastructure and ownership | **28, 34** | Staging and production blocked. **Phase 1 proceeds on local Developer edition** |
| 4.2 | Staging environment | 28 | Migration cannot run safely |
| 5.3 | Teachers can create/use Google Meet meetings | 23 | Live classes blocked — **an organisational capability, not an API credential** |
| 5.1 | Transactional email provider | 2 | Verification and reset unusable |
| 5.2 | Google **OAuth application credentials** | **2G** (only phase requiring them in V1) | **Google sign-in blocked.** Base auth (Phase 2) and **the manual Meet flow (Phase 23) proceed without them.** A future approved Google API integration would carry its own credential requirements |
| 4.3 | Production hosting | 34 | Deployment blocked |
| 3.4 | Legacy domain control and DNS | 35 | Legacy links break at launch |
| 5.4 | Payment provider | **27 only** | **Donations only — Membership proceeds** |

**Work that proceeds immediately with none of the above resolved:** Phases 0B, **1 (on local
SQL Server 2022 Developer edition)**, 3, 4, and subsequently 5, 6, 7, most content domains,
and **29 (migration framework on fixtures)**.

**Raise §1.1, §1.3, §1.4, §1.5 and §2.1 first.** They require religious-authority and
safeguarding consultation that takes real time and cannot be compressed once the dependent
phases arrive.
