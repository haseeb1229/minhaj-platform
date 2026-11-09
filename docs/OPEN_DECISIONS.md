# Open Decisions — One Minhaj Platform

**Status:** Living canonical baseline for the current accepted repository. Updated in the same
task as any accepted change that directly affects it (DELIVERY_PLAN.md §5.1).
**Origin:** Phase 0A Architecture Freeze, revised after independent architecture audit, and
revised continuously through the delivered phases.
**Document type:** Register of external decisions. Each entry's current status is stated in the
entry itself; "Still OPEN after Phase N" and "As delivered" notes record what each delivered phase
did and did not decide. **Nothing in this document records an external decision that has not
actually been supplied.**

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

**Current status — STILL OPEN; a labelled staging reference preview exists by owner decision
(Rebaseline R2, 2026-11-06).** The project owner (Haseeb) decided, for the password-protected,
non-indexable **pre-adoption staging deployment only**
(`OWNER-DECISION-2026-11-06-R2-QURAN-REFERENCE-PREVIEW`), that staging may show a real Quran text
for review: **the Tanzil Project's Uthmani text 1.1, reproduced verbatim under its Creative Commons
Attribution 3.0 licence** (its copyright notice kept verbatim in the source record, its attribution
in the footer and on every Quran page), beside Minhaj-ul-Quran's own Irfan-ul-Quran translation
(§1.2).

- **What it is.** A third, separately labelled source authority, `reference` — a licensed external
  text **not reviewed by Minhaj-ul-Quran's religious authority for this platform** — beside
  `fixture` and `approved`. The database keeps reference text out of any approved corpus and never
  mixes fixture and reference text (DOMAIN_MODEL.md §8.4).
- **The gate.** A reference corpus is shown only on a deployment that sets
  `RELIGIOUS_REFERENCE_PREVIEW=enabled` **and** is not indexable: startup refuses the setting beside
  public indexing, and the public reader independently requires a non-indexable build
  (SECURITY_BASELINE.md §5.1). The staging web service sets it; production never does, and
  everywhere else the corpus is inactive. In reference mode every Quran page is `noindex`, has no
  canonical, alternates or sitemap entry, names its sources and says plainly that the text has not
  been reviewed (ROUTE_MAP.md §3.3, §9.5).
- **Presentation rules decided with it.** The Bismillah header is shown only in reference mode,
  taken unchanged from Al-Fatiha 1:1's stored text, never counted as an Ayah and **never on Surahs 1
  or 9**; an approved corpus will decide its own convention. The Arabic interface shows no
  translation by default.
- **How it arrives.** A host-side operator command (`docker/staging/bin/quran-reference.sh
  import`) reads the two Tanzil files the operator downloaded once, verifies their exact SHA-256
  and the full structure (114 Surahs, 6,236 Ayat, juz, hizb, page and sajdah), registers the source
  as the owner, has the corpus accepted through Quran's own canonical service under a live
  `quran.editCanonical` grant and `quran-canonical-edit` step-up, and activates it as the owner.
  Proven against the real files in a disposable local database; its staging run is recorded at R2
  closure (DELIVERY_PLAN.md, Rebaseline R2 record).
- **Surah display names (Quran Part 2, 2026-11-09).** The English Surah names and their meanings
  shown on the preview are the same Tanzil metadata file's `tname` and `ename`, **verbatim** (CC BY
  3.0, named in "About this text"), saved by `quran-reference.sh names` through Quran's
  administrative service only when the file is the one the corpus was registered with. No Urdu or
  Arabic display name is written — there is no lawful source for one in the data — so those
  interfaces show the source's Arabic name. *Staging only, presentation only; the production gates
  are unchanged, and production's Surah names remain an operator's to record.*
- **Irreversible by design.** Canonical Quran is a singleton store that is never deleted and only one
  corpus is ever accepted: a staging database that holds the reference corpus keeps it until the
  database is reset, and a later approved corpus needs a fresh database or a recorded correction of
  every Ayah. Production never receives reference rows.

**What it is not:** Minhaj's choice of an authoritative text, encoding or verification reference;
religious approval of anything; production; or an answer to this entry. The rule above stands
unchanged — **no real corpus is imported, published or activated on assumption**: the preview is
labelled, gated and attributed, never assumed to be approved. The production approval path
(`approved` authority with recorded external evidence) is untouched.

### 1.2 Approved translations, tafsir and recitations
**Owner:** Minhaj · **Gates:** Phase 18 · **Priority:** High

Which translation works, tafsir works and reciters are approved for publication, plus any
licensing or attribution requirements.

**Current status — STILL OPEN; Irfan-ul-Quran appears in the staging reference preview (Rebaseline
R2, 2026-11-06).** Under the same owner decision as §1.1, staging's reference preview shows
Minhaj-ul-Quran's own **Irfan-ul-Quran** translation (Urdu and English, © Minhaj-ul-Quran
International) — and no other translation. Its text is taken exactly as staged from the
review-only Irfan-ul-Quran migration revisions (MIGRATION_STRATEGY.md §19), through Quran's
administrative service under `quran.administer`, by a host-side operator command
(`quran-reference.sh translations`); a Surah whose staged revision fails validation is skipped and
reported, never corrected. Its provenance is recorded as two `reference` sources with no Ayat of
their own (`irfan-ul-quran-ur`, `irfan-ul-quran-en`). **This is not Minhaj's approval of any
translation, tafsir or reciter**: no tafsir is shown and no recitation is added (the external
recitation-timing reference considered for R2 was deferred), and the decisions in this entry stay
open. *(As at R2; the owner's decisions of 2026-11-09 below direct what staging may add next.)*

**Owner decisions 2026-11-09 — the Quran section's content on STAGING (recorded with the owner's
direction to build the Quran section part by part; DELIVERY_PLAN.md, the Quran Part 1 record).**
Each is **staging only; the production gates of §1.1, §1.2 and §2.4 are unchanged** — none is
Minhaj's approval of a text, translation, tafsir or reciter for production, and each is delivered by
its own later part of the Quran programme, not by Part 1 (the reading experience).

1. **Recitations.** Arabic recitation from **mp3quran.net**'s qaris, with its per-Ayah timing,
   streamed on staging; and Minhaj-ul-Quran's own **Urdu narration of Irfan-ul-Quran** (Tasleem
   Ahmed Sabri, from minhaj.net) on staging. *Staging only; production gates of §1.1/§1.2/§2.4
   unchanged.*
2. **Tafsir.** A **Minhaj-ul-Quran hub**: Shaykh-ul-Islam's tafsir books and Minhaj TV lectures
   linked per Ayah, with per-Ayah text slots for tafsir text Minhaj-ul-Quran supplies — **no external
   tafsir**. *Staging only; production gates of §1.1/§1.2/§2.4 unchanged.*
3. **Transliteration and word-by-word.** Built, but **hidden until a lawful source** is recorded; no
   source is assumed. *Staging only; production gates of §1.1/§1.2/§2.4 unchanged.*
4. **Tajweed.** The **CC BY 4.0 `cpfair/quran-tajweed`** colour overlay, realigned to the Tanzil
   Uthmani 1.1 text, on staging only — **any Ayah whose text does not match is skipped**, never
   adjusted — with a **qari's review before production**. *Staging only; production gates of
   §1.1/§1.2/§2.4 unchanged.*

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

**Current status — STILL OPEN, unchanged by Rebaseline R2 (2026-11-06).** The owner asked whether a
Hadith corpus could be migrated from Minhaj's own sources; no structured MQI hadith source is
reachable, and the owner **declined external hadith corpora** (no third-party collection, no
scraped mirror). No Hadith reference preview exists, and no hadith text or grading is shown.
Instead, while no collection is activated, the Hadith landing presents **MQI's own hadith works** —
the Library's published Works classified under the `hadith` Topic — and says that the collections
reader awaits an authorised source (ROUTE_MAP.md §3.4; INFORMATION_ARCHITECTURE.md §2.2 — the
`hadithWorks` signal that promoted it is historical since 2026-11-08, when the navigation became
unconditional). That is Library content under its own pre-adoption basis (§3.1, §3.9), not a
Hadith corpus.

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

**Current status — STILL OPEN, unchanged by Rebaseline R2 (2026-11-06).** No `fatwa.publish` grant
exists and no ruling is published; naming a holder remains Minhaj's decision. R2 widens only the
**staged, review-only** set of thefatwa.com rulings (MIGRATION_STRATEGY.md §19 — evidence for
qualified review, never published by migration), and with no activation `/fatwa` is a calm
"coming" page with a plain outbound link to Minhaj-ul-Quran's own fatwa website, never fetched or
embedded (ROUTE_MAP.md §3.8). The shell does not promote Fatwa.

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
this decision when it is made. Student-to-student messaging did not exist at that point (Phase 24
had not started; see the next note).

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
an engineering lifecycle, not a retention period, which this decision still owns. Phase 26 added
Membership's export and disposition (SECURITY_BASELINE.md §19.1.6): a closed account's open
applications are withdrawn and its owed mail removed, while an active organisational Membership is
kept under its own lifecycle rather than treated as a resignation — an engineering default, not a
retention period, which this decision still owns. Phase 27 added Donations' export and disposition
(SECURITY_BASELINE.md §19.1.7): a closed account's owed donation mail is removed and the account link of
its donations released, while every amount, state, provider event and refund record is kept unchanged
as financial history — an engineering default, not a retention period, which this decision still owns.
Phase 29 added the **disposal mechanism for migration raw snapshots** (SECURITY_BASELINE.md §19.1.8):
an administrator may dispose of a snapshot's body for a stated reason, audited, keeping its metadata
and checksum. **How long raw snapshots — including any carrying incidental personal data — may be
kept before disposal is not decided**; Phase 29 sets no period and disposes of nothing
automatically, and this decision still owns that period.

**This is not a universal Phase-30 gate.** It gates Phases 21 and 33. A specific Phase-30 source
operation may still need a safe retention instruction for incidental personal data or raw
evidence before it runs — that is part of the source's own decision record (§3.1.1, *Privacy*),
not a reason to block Phase 30 as a whole.

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

**Pre-adoption staging only (Phase 30-R, §3.7).** First-party pictures the official pages
present with their own records are acquired with the page's own © Minhaj-ul-Quran International
notice as evidence, and a person decides each one public-eligible; unknown or third-party rights
stay restricted. This is the owner's attestation for the review build, **not** Minhaj's licensing
decision, which remains open for production.

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

> **As delivered (Phase 29) — STILL OPEN, and critical for Phase 30.** The framework is delivered
> and proven against synthetic fixtures only (DELIVERY_PLAN.md Phase 29): **no real legacy source
> was contacted and no real asset copied**, and no authorisation is recorded for any source. The
> model has a place for one — an `authorised` source must carry a written authorisation reference
> and date — but Phase 29 can neither register, activate nor run such a source
> (`real-source-not-authorised`), and the only fetcher its tooling builds refuses every host
> outside `*.fixture.invalid`. Recording each source's written authorisation remains mandatory
> before any Phase 30 adapter, access, fetch, asset copy or ingestion. The production promotion
> destination and production infrastructure also remain open (§4.1, §4.3, §4.4; Phases 34–35).

**Per-source status at the pre-Phase-30 baseline (2026-10-25, historical).** No written
authorisation had been supplied or recorded for any source, so every anticipated source was then
NOT AUTHORISED.

**Current status — owner-attested for PRE-ADOPTION STAGING (2026-10-27).** The project owner
attested, in the instruction that started Phase 30, that the required permission exists for the
**public** content of the seven anticipated sources — main Minhaj.org, Minhaj Books, TheFatwa,
Minhaj.TV, Irfan-ul-Quran, magazines and publications, and the eLearning catalogue — for discovery,
contact, fetching and migration into the independent pre-adoption staging environment. The
reference `OWNER-ATTESTATION-2026-10-27-PREADOPTION-STAGING` and its date are what every registered
authorised source records; the owner's evidence itself stays outside the repository.

- **What it covers:** public pages within the canonical boundaries of §3.1.1 and
  MIGRATION_STRATEGY.md §3.1; public assets only where neither the attestation nor the source marks
  them restricted, each with its own provenance and rights decision (an unclear asset is skipped).
- **What it does not cover:** any private account, question, enrolment, progress or message area;
  any access-control, anti-bot, authentication or rate-limit bypass; video binaries; API, export or
  database access (none is supplied — public-website ingestion is the access method, §3.2); any
  further source; production promotion or cutover (§3.4).
- **What it is not:** official adoption by Minhaj-ul-Quran International, or acceptance of any
  religious corpus (§1). The platform validates and audits the reference; it cannot prove the
  decision behind it.

A later decision by Minhaj — a per-source record as in §3.1.1, an exclusion, or a withdrawal —
supersedes this attestation for that source.

Two later owner attestations extend this one for pre-adoption staging only, each with the same
"does not cover" and "is not" limits: `OWNER-ATTESTATION-2026-10-29-PREADOPTION-CONTENT-BRAND-EXPANSION`
(Phase 30-R, §3.7) and `OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS`
(Rebaseline R2, §3.9).

#### 3.1.1 The per-source decision record

**What Minhaj supplies for each in-scope source before Phase 30 contacts it.** This is the
minimum, and it is supplied by the organisation — engineering never fills a field by inference.
**Credentials and secrets are never written here or in any public document**; where an access
method needs one, it is supplied out of band only when the work needs it.

| Part | Minimum content |
|---|---|
| **Identity** | Source name · canonical host(s) or endpoint(s) · status: **in scope**, **deferred** or **explicitly excluded** |
| **Authorisation** | Authorising organisation · the authorising person's role or capacity · a written reference · its date · an expiry or review date **only if the authorisation itself carries one** |
| **Permitted access** | Which of: public-website ingestion · API · admin export · structured dump · a database or export supplied by Minhaj · another explicitly named method |
| **Approved content scope** | Content types · languages · any historical range or cutoff · what is excluded, obsolete or superseded (§3.3) · whether the source keeps publishing during Stage 1 (MIGRATION_STRATEGY.md §10.2) |
| **Assets and rights** | Whether copying assets is authorised · which asset types · licensing and attribution evidence · online-only or download restrictions (§2.4; MIGRATION_STRATEGY.md §4.9) |
| **Politeness and access restrictions** | Any source-specific rate or concurrency ceiling · terms and `robots.txt` observations · **no bypass of authentication, anti-bot, rate-limit or other access restrictions** (MIGRATION_STRATEGY.md §1.2) |
| **Privacy** | No private accounts · no private questions · no enrolments, progress or messages · the treatment of incidental public personal data (MIGRATION_STRATEGY.md §8.3) · any approved raw-snapshot retention requirement (§2.2, §4.4) |
| **Religious and editorial review** (where applicable) | The authoritative source or edition (§1.1–§1.4) · the named review authority or approved review process (§1.5) · the conflict-escalation owner (§1.6) · rights and attribution · who approves publication |
| **Publication** | The staging migration-publication actor and the `migration.publish` holder decision (§3.5) — the `migration-publication` step-up stays mandatory regardless |

**Phase-35 matters — DNS, legacy hosting, production promotion and cutover — are not part of this
record** (§3.4).

**The record is evidence, not a database schema.** The delivered `MigrationSource` deliberately
persists a narrower framework vocabulary — `authorityKind` (`fixture` | `authorised`),
`accessMethod` (`http` | `export`), `contentKind` (currently only `media.video`), `baseUrl` and its
hosts, `authorisationReference` and `authorisedOn`, `licensingEvidence` and `policyNotes`,
`defaultLanguageCode`, a bounded fetch policy, and state, version and audit ownership
(DOMAIN_MODEL.md §16.5). The richer record above lives as organisational evidence that the
registered source **references** through `authorisationReference`, `licensingEvidence` and
`policyNotes`. An API is reached over `http` and a supplied dump or CMS export is an `export`, so
the business vocabulary needs no new access-method variant. If a concrete Phase-30 source contract
proves that an invariant cannot be represented safely this way, the schema extension is
**Phase-30 implementation work**, justified from that contract — not added in advance.

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

**Not a universal Phase-30 start blocker.** Structured access is used when it is legitimately
supplied; where it is not, the documented fallback above applies — provided the source's written
authorisation (§3.1) permits public-website ingestion.

**Still OPEN after Phase 29.** The framework accepts an `export` access method and proves it against
a synthetic executable export, run in an isolated in-memory engine and never restored as the target
(MIGRATION_STRATEGY.md §1.3, §13). No real export, API or source access has been provided or used.

### 3.3 Migration scope per source
**Owner:** Minhaj · **Gates:** Phase 30 · **Priority:** Medium

What to migrate, what to leave behind, what is obsolete or superseded, and what Minhaj wishes
to retire rather than carry forward.

**Still OPEN after Phase 29**, which decides no scope: its only content kind is video metadata over
fixtures, and every further kind arrives with its own publisher in Phase 30.

### 3.4 Legacy domain control, production promotion and cutover
**Owner:** Minhaj · **Gates:** Phase 35 · **Priority:** Medium

**DNS control** and **access to legacy hosting** to serve legacy-domain 301s · whether legacy
domains redirect to Minhaj.org · timing · whether any legacy site continues operating · **who
approves the promotion manifest into production** (MIGRATION_STRATEGY.md §10.1.1) · **who executes
the cutover** · **who can execute a cutover rollback** (MIGRATION_STRATEGY.md §7.3).

**Why it matters:** Preserving inbound links and citations depends on access this project does
not control.

**This is Phase 35's decision only.** It does not gate Phase 30: Phase 30 proves legacy URL
resolution through the mapping in staging or a controlled resolver, and serves no legacy domain
(MIGRATION_STRATEGY.md §9.5). Staging publication authority is a separate decision (§3.5).

**Still OPEN after Phase 29.** Phase 29 writes legacy URL mappings at publication but serves no
legacy 301 and touches no DNS or legacy hosting. The production promotion approver, the cutover
owner and the rollback owner are undecided. The in-application approval of a promotion manifest
also requires `migration.publish` (§3.5); whether its holder may approve **production** promotion
is part of this decision.

### 3.5 Staging migration publication authority
**Owner:** Minhaj · **Gates:** **Phase 30 exit** — real migrated content "published in staging" ·
**Priority:** High

**Who may hold `migration.publish`** · **who may perform the `migration-publication` step-up**
it requires · **who approves the publication of migrated content in staging**. Religious content
additionally requires its own domain and scholarly approval (§1.1–§1.6), which migration
publication authority never substitutes for (MIGRATION_STRATEGY.md §8.4).

**Why external:** Publishing migrated content puts records under Minhaj-ul-Quran's name; naming
who may do so is an organisational decision. Engineering grants nothing on assumption, creates no
role for it, and chooses no actor on the organisation's behalf.

**Category C/D · Gate: content acceptance (Phase-30 staging exit).** It is **not** a prerequisite
for beginning Phase 30 once written source authorisation exists (§3.1): adapters, authorised
fetching, staging, review queues and reconciliation can proceed without a holder. It **is**
required before any real migrated record can satisfy the Phase-30 exit. For a Phase 30 meant to
complete in one run, supplying it up front is operationally sensible.

**Current status — OPEN for the organisation; a pre-adoption staging holder exists.**
`migration.publish` is catalogued and externally gated — bundled into no protected role
(SECURITY_BASELINE.md §3.5); every publish, rollback and promotion approval also needs the
`migration-publication` step-up. **On pre-adoption staging only** (2026-10-28), by the owner's
authorisation, the owner's first administrator holds it through a custom role
`staging-migration-publisher` (`migration.publish`, `migration.read`) that a **second**
administrator created, bundled under `permissions.grant` and assigned — the ordinary audited
lifecycle, never a self-grant (a self-grant was refused). That is not production authority, not
scholarly authority and not Minhaj's naming of a holder, which remains this decision.

### 3.6 Phase-30 gates by timing

The Phase-30 decisions do not all gate the same moment. Collapsing them into one start rule would
either block work that may safely proceed or let content through that may not.

| When it gates | Decision | Effect while unanswered |
|---|---|---|
| **A. Phase start — before contacting a real source** | §3.1 written authorisation, per source | That source is not contacted: no adapter access, fetch, asset copy or live ingestion |
| **B. Per-source ingestion** | §3.3 scope (in scope, excluded, obsolete, superseded) · §2.4 licensing, attribution and per-asset rights · access and politeness restrictions in the authorisation itself | Out-of-scope content is not ingested; assets without rights evidence are not copied |
| **C. Access method — not a universal blocker** | §3.2 source, API or export access | Authorised public-content ingestion is used, at higher parsing and review cost |
| **D. Religious QA and content acceptance** | Authoritative Quran, Hadith and Fatwa sources or editions (§1.1–§1.4) · §1.5 review capacity · §1.6 conflict escalation · domain religious approval | Affected religious content is not published or accepted, even while adapter engineering proceeds under a valid authorisation |
| **E. Phase-30 staging publication and exit** | §3.5 `migration.publish` holder, `migration-publication` step-up, publication approver | Content is staged and reviewed but cannot be published in staging, so the Phase-30 exit is not reached |
| **F. Phase 35 only — not Phase 30** | §3.4 production DNS, legacy hosting cutover, production promotion, cutover and rollback owners, live legacy-domain 301 activation | No effect on Phase 30 |

§2.2 (applicable jurisdictions) gates Phases 21 and 33, not Phase 30 as a whole; a source may still need a retention instruction in its own record (§3.1.1, *Privacy*).

**Where the gates stand for the pre-adoption Stage 1A (2026-10-27).** **A** is satisfied for
pre-adoption staging by the owner's attestation (§3.1). **B** is applied per source from the same
attestation: public content only, assets only with their own rights decision. **C** is
public-website ingestion. **D is not satisfied and is not bypassed**: Fatwa and Quran material is
staged and reviewed as evidence only and never published by migration (MIGRATION_STRATEGY.md §14);
no scholarly approval is recorded or simulated. **E** is satisfied for pre-adoption staging only
(§3.5): 134 ordinary records were published there on 2026-10-29 (MIGRATION_STRATEGY.md §14). **F**
is untouched. None of this
is a decision of Minhaj-ul-Quran International; the owner's roadmap decision only fixes the order:
build and review first, official adoption and content acceptance afterwards.

**After the Phase 30-R review-completeness macro (2026-10-29, §3.7).** **A** extends, for
pre-adoption staging only, to five more registrations and to the first-party image hosts the
authorised pages name, under `OWNER-ATTESTATION-2026-10-29-PREADOPTION-CONTENT-BRAND-EXPANSION`.
**B** is applied per asset: a picture is copied only from those exact hosts, with the page's own
copyright notice as evidence, and shown only after a person decides it public-eligible; unknown
rights stay restricted. **D** is unchanged and still not bypassed. **E** stays satisfied for
pre-adoption staging only: after the macro, on 2026-10-30, **497** ordinary migrated records are
public there — 147 news items, 45 articles, 30 press releases, 3 Explore pages, 102 books, 2
magazines with 72 issues, 63 videos, 3 leadership profiles and 30 countries of presence
(MIGRATION_STRATEGY.md §15.1); after the Phase 30-RF gap closure, on 2026-10-31, **501** — four
more Explore pages (MIGRATION_STRATEGY.md §16.1); after Phase 30-RD, on 2026-11-02, **617** — the
introduction page, the 112 posts three curated archives hold and those three archives as
Collections (§3.8; MIGRATION_STRATEGY.md §17.1). **F** is untouched.

**After the Rebaseline R2 attestation (2026-11-06, §3.9).** **A** extends, for pre-adoption staging
only, to the comprehensive presentation corpus under
`OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS` — the public official content of
the already registered hosts across every built kind, and five more registrations on those hosts;
every other MQI host stays uncontacted (§3.9). **B** is unchanged: public content only, each picture
copied only from a registered host and shown only after a person's rights decision — now also
decidable run-wide per registered host after the person has seen each picture
(SECURITY_BASELINE.md §10.11). **C** is public-website ingestion. **D is unchanged and still not
bypassed**: migrated Fatwa and Quran material stays review-only and is never published by
migration; the staging Quran reference preview (§1.1, §1.2) is a separately labelled, gated owner
decision and **not** a D acceptance. **E** stays satisfied for pre-adoption staging only; the
resulting public counts are recorded when the staging runs complete (MIGRATION_STRATEGY.md §19.1).
**F** is untouched.

### 3.7 Pre-adoption review completeness — owner decision (Phase 30-R)
**Owner:** Owner (pre-adoption) · **Recorded:** 2026-10-29 · **Status:** decided for pre-adoption
staging only; every Minhaj decision it touches stays open

The owner reviewed the first Stage-1A build and judged it too sparse to present. Decided, for the
**pre-adoption review build on staging only** (owner attestation
`OWNER-ATTESTATION-2026-10-29-PREADOPTION-CONTENT-BRAND-EXPANSION`):

- **A broader review corpus.** Stage 1A may be materially larger — several listing pages deep in the
  high-volume areas, across more categories, languages and years — while staying bounded, recorded
  and reconciled. It is still **not** Stage 1B (MIGRATION_STRATEGY.md §10.1.0, §15).
- **Public first-party visual assets are in scope** where an authorised official page presents them
  as part of its own record, from that source's hosts or a clearly first-party MQI host it names
  (registered as an asset host with its evidence): lead images, covers, posters, portraits. No
  access-control bypass, robots respected, provenance and rights recorded per asset, **unknown
  rights skipped**, third-party, social, provider and private images never.
- **Additional official hosts** may be registered only when demonstrably MQI-owned, linked from an
  authorised source, relevant to a built domain and needed to fill a real gap — exact hosts, public
  content only. Used for `minhajoverseas.com` (the Directorate of Foreign Affairs, listed on
  minhaj.org's contact page) and the asset hosts `minhaj.net` / `www.minhaj.net`.
- **The current official MQI logo** is the build's provisional brand lockup (§6.4).
- **Original source dates are product truth**: a migrated record's reader-facing date is the date
  its source states, never the migration or approval date (DOMAIN_MODEL.md §7.2.2).
- **Optional visual fields are added where a content type needs them** — an Editorial lead image,
  a Person portrait, Edition and MagazineIssue covers, a Video poster — superseding the earlier
  "no image" rules for News and People (DOMAIN_MODEL.md §5.1, §7.2.2).

**Not decided by this record, and still open:** Minhaj's content acceptance of the organisational
pages and profiles migrated for review, its brand pack (§6.4), its per-asset licensing for
production (§2.4), any religious acceptance (§1), production promotion and cutover (§3.4), and
official adoption.

### 3.8 Two findings of the final Stage-1A gap closure (Phase 30-RF), decided (Phase 30-RD)
**Owner:** Owner (pre-adoption), then Minhaj · **Gates:** nothing delivered; each decided whether
one more review-build capability is built · **Recorded:** 2026-10-31 · **Status:** both **decided
for pre-adoption staging and implemented** (Phase 30-RD, below); Minhaj's acceptance stays open

The final gap-closure macro (MIGRATION_STRATEGY.md §16) closed every ordinary engineering gap it
found. Two findings are not ordinary engineering — each needs a decision the accepted model does
not make — so neither was built, and neither is a source limitation:

- **A person clearing an incidental personal-data flag.** The bound introduction page
  (minhaj.org tid 1799) was flagged because its body states the Central Secretariat's postal
  address, office, UAN and fax numbers and an organisational mailbox. A person classified every
  match as a **public organisational office contact** — a false positive for *personal* data. But
  §8.3 of MIGRATION_STRATEGY.md says flagged material is "excluded by default": the approval act
  refuses any flagged revision, and the staged text already carries `[redacted]` in place of each
  match, so "approve normally" is impossible and approving the redacted text would publish
  placeholders. Building a reviewer's audited false-positive clearance (who may clear, what is
  re-staged unredacted, how it is recorded) is a new privacy control. **Until decided:** the page
  stays a reserved Explore page and its revision stays unreviewed.
- **Collections from the source's curated archives.** minhaj.org's `lkcatid` pages are genuine,
  editor-ordered archives of conference and campaign coverage — e.g. Al-Hidayah (one curated list
  of 20 posts, 2005–2019), Mawlid Conferences (43 posts in four sections), Itikaf (51 in two) —
  exactly what DOMAIN_MODEL.md §7.3 calls a Collection. Migrating one needs a new publishable kind
  (`editorial.collection`) with its own typed target column (a schema migration), its member posts
  migrated first, and lifting the accepted Phase-30-R boundary that a migrated Editorial record
  names no Collection member. **Until decided:** `/collections` holds only curator-made
  Collections; the archives stay on the source.

**Decided — Phase 30-RD (owner, 2026-10-31), for the pre-adoption review build on staging only.**

- **A narrow, audited false-positive clearance: YES.** Only for a detector match that is genuinely a
  public organisational fact or contact — never a private person's details, never a blanket
  "ignore personal data", never by changing the detector, editing a flag, rewriting a staged
  payload or by SQL. Implemented as each distinct match recorded as evidence (never its text), a
  person's per-finding classification with a reason under the externally gated
  `migration.clearPersonalData` and its own `migration-personal-data` step-up, a replay of the
  RETAINED snapshot into a new `cleared` revision only when every finding is cleared, and approval
  by a different person — each rule held by the database as well (MIGRATION_STRATEGY.md §8.3, §17;
  SECURITY_BASELINE.md §3.5, §10.9). Who holds the key in production is Minhaj's to name, like
  `migration.publish` (§3.5).
- **The source's curated archives as Editorial Collections: YES** — only genuine editor-curated
  archives that fit Phase 15's Collection exactly, every member an allowed, already-public typed
  record: the three named above, by `lkcatid`, never every category; members migrated first as a
  bounded dependency, resolved only through active legacy mappings, source order kept
  (MIGRATION_STRATEGY.md §17; DOMAIN_MODEL.md §16.8).

**Not decided by this record, and still open:** Minhaj's acceptance of the Collections and of the
introduction page's contents, any production holder of `migration.clearPersonalData`, every
religious acceptance (§1), production promotion and cutover (§3.4), and official adoption.

**Extended by Rebaseline R2 (owner, 2026-11-06; §3.9).** "The three named above, … never every
category" was the Phase 30-RD scope (historical). R2 extends it to **every genuine editor-curated
`lkcatid` archive** the source's archive index listed on 2026-11-06 — fourteen in all: the three
above and eleven more (Women Activities, Welfare Projects & Events, Conferences & Seminars,
Interfaith Activities, Quaid Day Programs, Spiritual Gatherings, Processions & Rallies, Educational
Projects, Overseas Activities, Visits & Delegations, and Peace, Integration and Reconciliation) —
under exactly the same rules: members migrated first, resolved only through active mappings, source
order kept, a post two archives name migrated once (MIGRATION_STRATEGY.md §19). It is still never
"every category".

### 3.9 Comprehensive pre-adoption presentation corpus — owner attestation (Rebaseline R2)
**Owner:** Owner (pre-adoption) · **Recorded:** 2026-11-06 · **Status:** decided for pre-adoption
staging only; every Minhaj decision it touches stays open

The owner judged the Stage-1A review build (617 public records) too small to present the breadth of
the organisation, and attested, for the **password-protected, non-indexable pre-adoption staging
deployment only**, under `OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS`:

- **What it covers.** The **public official MQI content of the hosts already registered** under
  §3.1 and §3.7, **across every content kind the platform has built**, and **not artificially
  capped** — bounded instead by each run's recorded page and item limits, the existing politeness
  policy (at least two seconds per host, `robots.txt` respected) and the same reconciliation, review
  and per-item publication as every earlier run. Concretely: news, press releases and articles in
  English, Urdu and Arabic across recent years; the Minhaj Books catalogue (metadata and covers,
  never PDFs) and its authors; every issue of the registered magazines, including al-Ulama; the
  Minhaj.TV video speeches in English and Urdu (metadata, the provider's video identifier and the
  first-party poster — never a video binary); the countries of presence; the curated archives of
  §3.8 as extended; two further organisational pages; and widened **review-only** Fatwa and
  Irfan-ul-Quran staging. Five new registrations on already registered hosts carry the reference
  (MIGRATION_STRATEGY.md §19).
- **Deferred, and not contacted:** the other MQI hosts the R2 ecosystem study found —
  minhajsisters.com, youth.com.pk, msmpakistan.org, research.com.pk, equranclass.com, itikaf.com and
  welfare.org.pk — whose posts would need cross-host de-duplication first; and **minhajwelfare.org
  (Minhaj Welfare Foundation, UK), a separate legal entity that needs its own authorisation**. Each
  needs its own registration on recorded evidence before any contact.
- **What it does not cover:** any private account, question, enrolment, progress or message area;
  any access-control, anti-bot, authentication or rate-limit bypass; video binaries or book PDFs;
  API, export or database access; any host not registered; production promotion or cutover (§3.4).
- **What it is not:** Stage 1B (MIGRATION_STRATEGY.md §10.1.0), Minhaj's content acceptance, official
  adoption, or any religious acceptance (§1). The counts it produces are pre-adoption staging
  evidence, recorded when the staging runs complete (MIGRATION_STRATEGY.md §19.1).

**Not decided by this record, and still open:** Minhaj's per-source records (§3.1.1), scope (§3.3),
per-asset licensing for production (§2.4), the naming of a `migration.publish` holder (§3.5), every
religious acceptance (§1), production promotion and cutover (§3.4), and official adoption.

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

#### Phase 28 — the staging rows, resolved for pre-adoption staging only

The owner decided the **staging** rows above for a **developer-controlled pre-adoption staging
environment** (ARCHITECTURE.md §10.6). These answers are **not** Minhaj's production decisions
and close nothing for Phase 34.

| Staging decision | Resolution |
|---|---|
| Staging SQL Server instance and access | SQL Server 2022 **Developer** + FTS (16.0.4265.3) in a container on the staging VM, reachable only on the host's internal Docker network. Developer edition is permitted **only** because the environment is development, test, demonstration and acceptance |
| Hosting arrangement | One Azure for Students VM (`Standard_B2as_v2`, Ubuntu 24.04 LTS, x86, Central India) running Docker Compose — IaaS only. Operated **deallocated when idle** |
| DBA ownership and responsibility | **Muhammad Haseeb** (owner, deployer, DBA, backup operator and restore verifier) until handover |
| Backup and restore responsibility | Same owner; daily automated backup, restore proven by `bin/restore-proof.sh` |
| Network and firewall access | Inbound 443 and 80 (ACME and redirect) only; SSH from the operator's current IP only; SQL Server, ClamAV and realtime never published (SECURITY_BASELINE.md §21.3) |
| Connection details | Generated on the host into root-only files; never in the repository, CI or chat |

**Still open:** the **production** SQL Server instance, hosting, licensing, HA/DR, network,
connection details and DBA — all Phase 34.

### 4.2 Staging environment
**Owner:** Minhaj · **Gates:** Phase 28 · **Priority:** High

**Why it matters:** Migration dry-runs and religious QA must **never** run against production.
Phase 28 delivers staging **before** migration needs it.

**Resolved for Phase 28 (pre-adoption staging).** Staging is `https://minhaj.haseebliaqat.me` —
a dedicated host name, distinct from the pre-adoption presentation origin — owned and operated
by the developer before adoption, with the DNS `A` record for that one name only, Let's Encrypt
TLS, NGINX Basic Authentication as the environment gate in front of normal Identity and RBAC,
staging email disabled at Phase-28 delivery (transactional email enabled in Phase 30 for the
owner's staging accounts, §5.1) and Donations unavailable (no payment provider configured). GitHub
Actions deploys it through the protected `staging` environment with OIDC (ARCHITECTURE.md
§10.6). On adoption, staging is re-provisioned on adopter-owned infrastructure; the Azure for
Students subscription is not transferable.

**Staging demonstration data — owner decision (Rebaseline R2, 2026-11-06;
`OWNER-DECISION-2026-11-06-R2-STAGING-DEMO`), for pre-adoption staging only.** So that the private
journeys — My Minhaj, Teacher, classes, messages, membership and giving — can be reviewed with
something in them, staging may hold clearly synthetic demonstration data that an operator puts
there. It supersedes, **for this staging environment only**, the earlier rule that no demo data
exists anywhere (PRODUCT_SCOPE.md, *Pre-adoption deployment*; MIGRATION_STRATEGY.md §10.1.0;
SECURITY_BASELINE.md §8.3, §21.5; ARCHITECTURE.md §10.2, §10.6).

- **Environment data, never an application mode.** No flag, branch or "demo mode" exists in product
  code; the personas are ordinary accounts and their classes, enrolments, messages, membership
  application and donations ordinary records made through the ordinary audited services. An
  operator runs `docker/staging/bin/demo.sh seed | status | reset`, which refuses unless the host
  proves it is staging, the deployed web service is explicitly non-indexable and the process
  declares exactly the staging deployment; the owner-side command refuses again on the connected
  database's own name. Production and an indexable deployment can never run it.
- **Synthetic and contained.** Three fictional personas — a student, a teacher and a member, each
  named "… Example (demo …)" — on the reserved `@demo.minhaj.invalid` domain: no real person's or
  scholar's name and no personal data. Their passwords are generated from the host's CSPRNG into a
  root-only file on the VM and reach the command on standard input only — never printed, logged or
  committed. **No mail is sent** (addresses are pre-verified and the email transport refuses any
  `.invalid` recipient) and **no money moves** (donations use the Phase-27 provider simulator,
  in-process on loopback inside the operations run, never the public web service).
- **No seeded privilege.** The demo teaching role is created and granted by a staging administrator
  through Identity's audited administration under that administrator's live
  `privilege-administration` step-up — never seeded, never self-granted.
- **Idempotent and resettable.** A second seed changes nothing; `reset` closes the personas through
  Identity's own account closure, runs every context's closed-account disposition and archives the
  demo catalogue, touching nothing it did not create; a later seed uses a new persona generation.

**Trade-offs accepted with it.** The activations the demo needs — live learning, the Messaging
`support` and `teacher-student` capabilities (never `student-student`, §2.5) and Donations'
`fixture` environment for the demo merchant label — are written by the owner principal with
authority `fixture`, and **activation rows are immutable by trigger**: `reset` does not remove them.
In particular the **fixture `DonationActivation` blocks any later sandbox activation on this
staging database until the database itself is reset** (§5.4). Public giving stays off — no payment
provider is configured for the web service, so Donate is not promoted. A **public demo teacher
Person** (needed to teach the demo course) is visible in the People directory, and the **"Demo
membership (staging)" type** makes Membership appear in staging's navigation; both are labelled as
demonstration content, and neither is MQI policy or a real person.

**What it is not:** content, activation or production readiness; a decision about live learning,
messaging policy (§2.1, §2.5), membership or payments (§5.4); or a substitute for any of them. The
demo data is promoted nowhere — promotion bundles exclude accounts and private data.

**Staging host-issued step-up — owner decision (Rebaseline R2, 2026-11-09;
`OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP`), for pre-adoption staging only.** The owner's
recorded answer: *"Staging confirmations: build a staging-only server command so Claude can do
these himself; production keeps every confirmation unchanged."* Reason: on the staging VM root
already holds the SQL Server administrator credential and can change any row, so a browser
re-authentication adds little assurance there, while it stops the owner's operator completing
staging operations unattended. `docker/staging/bin/step-up.sh grant --account <id> --purpose
<purpose> [--minutes <1-15>]` issues, through Identity's own service, the same session- and
purpose-bound grant the browser step-up issues — only on the proven, non-indexable staging host,
only for an active account that holds the purpose's permission live with a complete second-factor
posture and a live session, for at most 15 minutes, never for `second-factor`, audited as the
browser's step-up marked host-issued (SECURITY_BASELINE.md §8.1). **What it is not:** a change to
any gate, to who holds which permission (§3.5 still names who may hold `migration.publish`), to the
two-person rule of Editorial review, or to production, which keeps every confirmation. Under the
same decision, `docker/staging/bin/migration-review.sh` performs a completed run's review and
publication clicks (run-wide approval, pictures by host, manifests, publication, the second
administrator's Editorial batch) through the screens' own services, each previewed and then
confirmed over exactly the printed set; pictures are decided public only on first-party Minhaj
hosts with the R2 attestation (§3.9) named in the evidence, as the owner's standing rule says
(MIGRATION_STRATEGY.md §19.2).

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

**Narrowed for Phase 28 staging — an INTERIM staging policy, not a production or legal
retention decision:** daily backup of SQL **and** authoritative Storage together · **RPO 24 hours**
· **RTO 4 hours** · **14-day retention** · copies in a private Azure Blob container separate from
the VM's disks · restore proven into isolated targets. The Blob copies share the staging
subscription with the VM; that correlated-failure risk is **accepted for staging only**, with a
documented export of the latest verified set before credit expiry, subscription disablement or
handover (ARCHITECTURE.md §10.6). **Production** frequency, retention, off-site posture, RPO, RTO
and log, audit and raw-snapshot retention remain open for Phase 34.

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
>
> **As delivered (Phase 26):** Membership closed with no provider selected and no payment code
> path — no amount, currency, fee, dues, transaction, checkout, invoice or provider concept exists in
> its contracts, tables or surfaces, and an architecture test refuses one. This gate stays Phase 27's
> alone.
>
> **As delivered (Phase 27) — STILL OPEN.** Donations is engineering-complete against a provider
> sandbox: Stripe was chosen as the **sandbox engineering adapter, not as the production provider**
> (TECH_STACK.md §18.4). Nothing here selects a production provider, merchant account, supported
> currency or region, recurring donations (none exist), Gift Aid or any equivalent (none exists), or
> the people who may refund. Real payment initiation is impossible without an owner-written
> `DonationActivation` row: a non-production environment needs `fixture` authority, and
> `production` needs `approved` authority with recorded external evidence, which neither the runtime
> nor any Donations key can write. The persistent database holds no activation row, no campaign and no
> donation. `donations.refund` is externally gated and held by nobody; naming its holders is part of
> this decision.
>
> **Rebaseline R2 (2026-11-06) — STILL OPEN.** The staging demonstration data (§4.2) writes, on
> pre-adoption staging only, a `fixture`-authority `DonationActivation` for a non-secret demo
> merchant label, and records demo donations against the provider simulator — no money moves and
> public giving stays off. The row is immutable, so it blocks any later sandbox activation on that
> staging database until the database is reset. Nothing here selects a provider, merchant account,
> currency, region or refund holder.

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

**Pre-adoption brand evidence (Phase 30-R, §3.7) — still OPEN for the organisation.** By the
owner's authorisation, the pre-adoption build shows the organisation's **current official logo
and wordmark** exactly as minhaj.org publishes it (`https://www.minhaj.org/images/logo.png`,
retrieved 2026-10-29, a 444×65 PNG; only its editing metadata removed — never redrawn,
recoloured or re-proportioned) in the header and footer, and the official site's favicon as the
app icon; provenance and checksums are inventoried in TECH_STACK.md §18. No SVG or brand guide is
published, so no palette or typeface was inferred from the logo's pixels: the restrained semantic
palette stays. This is **provisional brand evidence, not the accepted brand pack**: the logo
variants, palette, typefaces and guidelines remain this decision, and supplying them replaces the
file and the token values. *(The header placement and "the restrained semantic palette stays"
are historical at Phase-30-R exit, superseded by Rebaseline R1 below.)*

**Interim One Minhaj identity — owner-approved (Rebaseline R1, 2026-11-06, Haseeb, project
owner). The organisation's brand pack stays OPEN.**

- **Approved:** an **interim** visual identity for the One Minhaj product — the palette by role,
  radii and shipped OFL typefaces recorded in ARCHITECTURE.md §13.2–§13.3 and TECH_STACK.md §18.9.
  It is explicitly **replaceable** by Minhaj's official brand pack; because every role is a token
  consumed as a utility and every face is declared in one module, supplying the pack is a value
  and font-module substitution, not a redesign.
- **The product mark:** a typographic "One Minhaj" wordmark with a small eight-point star outline
  — a neutral geometric form, not an organisational emblem and not a redrawing of any Minhaj mark.
- **The official MQI logo** is used **unmodified** as a **secondary organisational mark**, in the
  footer only, beside the one pre-adoption statement — never redrawn or recoloured, and no longer
  in the header.
- **Still OPEN for Minhaj:** the official brand pack — logo variants, palette, typefaces
  (including any approved Urdu and Arabic typefaces and their licensing), guidelines — and the
  acceptance of any brand use beyond pre-adoption staging.

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

**Owner decisions recorded at Rebaseline R1 (2026-11-06, Haseeb, project owner).** Product
decisions the owner is entitled to make for the independently developed platform; none is a
decision of Minhaj-ul-Quran International, and none closes an entry above:

| Decided | Where |
|---|---|
| **English URLs are unprefixed** (`/`, `/library`); Urdu and Arabic keep `/ur/…` and `/ar/…`. Every `/en` and `/en/…` answers one 301 to the unprefixed address, query preserved and merged with slug history. Locale resolution is deterministic: no locale cookie, no `Accept-Language` redirect, `/` answers 200 in English. One canonical address per interface locale still holds; made before public indexing, so no search equity was affected. Supersedes the Phase-3A `/{locale}` contract and its 307 | ROUTE_MAP.md §1.1, §1.3, §9.1–§9.2.1 |
| **Interim One Minhaj visual identity** — replaceable; the official logo unmodified as a secondary footer mark; the brand pack stays OPEN | §6.4; ARCHITECTURE.md §13.2–§13.3 |
| **Content-aware navigation** — a destination is promoted only with published content or an open service; every route stays reachable by address. *(Historical, superseded 2026-11-08 by owner direction — below)* | INFORMATION_ARCHITECTURE.md §2.2, §4 |
| **Readiness vocabulary** — never a bare "complete"; readiness is reported in six separate dimensions: **Engineering**, **Product**, **Content**, **Activation**, **Production**, **Flagship/presentation** | PRODUCT_SCOPE.md, *Product status and acceptance*; DELIVERY_PLAN.md (Rebaseline R1 record) |

**Owner decisions recorded at Rebaseline R2 (2026-11-06, Haseeb, project owner).** Again product
decisions for the independently developed platform, for pre-adoption staging where so marked; none
is a decision of Minhaj-ul-Quran International, and none closes an entry above:

| Decided | Where |
|---|---|
| **R2 scope widened to every surface** — public, My Minhaj, Teacher and Admin — in one macro. Supersedes the R1 record's split "home and landings in R2; My Minhaj, Teacher and Admin in R3/R4" | DELIVERY_PLAN.md (Rebaseline R1 and R2 records) |
| **Grouped navigation** — six fixed header groups (Quran · Knowledge · Watch & Listen · Learn · News & Events · About MQI), each listing only its present destinations, a utility strip, six footer columns and the official channels. Supersedes R1's ranked bar of at most six (`PRIMARY_LIMIT`) and "More"; content-aware presence still hides genuinely empty destinations. *(Historical, superseded 2026-11-08 by owner direction — below)* | INFORMATION_ARCHITECTURE.md §1.5, §2, §4 |
| **Comprehensive pre-adoption presentation corpus** (staging only) | §3.9; MIGRATION_STRATEGY.md §19 |
| **Quran staging reference preview** — Tanzil Uthmani 1.1 verbatim (CC BY 3.0) with Irfan-ul-Quran, labelled, gated and never indexable; Bismillah and Arabic-default rules (staging only; §1.1–§1.2 stay OPEN) | §1.1, §1.2; DOMAIN_MODEL.md §8.4; SECURITY_BASELINE.md §5.1 |
| **No external hadith corpus**; Hadith presents MQI's hadith works (§1.3 stays OPEN) | §1.3 |
| **Staging demonstration data** as operator-run environment data, never an application mode (staging only) | §4.2 |

**Owner direction recorded 2026-11-08 (Haseeb, project owner).** A product decision for the
independently developed platform, not a decision of Minhaj-ul-Quran International:

| Decided | Where |
|---|---|
| **Unconditional navigation restored** — the nine domains (Explore · Quran · Hadith · Learn · Library · Watch · Fatwa · News & Events · Global) always in the header, each with its full mega menu; the utility strip (Find a Centre · Membership · Contact & Help, the language switcher, the account entry, Donate always); the six-column footer index with the legal documents and the Sitemap always linked. Reverses the R1 content-aware and R2 grouped navigation, which the owner judged a usability regression because they hid most destinations; a destination with nothing published answers with its own honest state. R2's visual components, keyboard behaviour, featured cards, official channels and footer pre-adoption statement are kept | INFORMATION_ARCHITECTURE.md §1.5, §2, §3, §4 |
| **Public page features restored** — what the R1/R2 redesign removed from the home page and the section landings returns, behaving as at Phase-30 exit (commit `0382218`) in R2's visual components: the home hero's search and Explore link, the always-present Quran and Hadith cards, areas and Explore sections, and the audio, Events, rulings, organisation and topics modules; the full `/explore` index of every reserved page; and the Quran, Hadith, Library, Watch, News, Collections and Global landings' removed links, notices, intros and paging | ROUTE_MAP.md §3.1–§3.9 |

---

## 9. Blocking summary

**Every entry in this document is classified below** by category (A–E) and by what it actually
gates. A decision may gate more than one thing.

| # | Decision | Cat. | Gate type | Gates phase | Consequence if unresolved |
|---|---|---|---|---|---|
| 1.1 | Authoritative Quran text source | **D** | Content acceptance · activation | 18 | **No real corpus is imported or published** as approved. Engineering implementation proceeds on non-authoritative fixtures. **Since Rebaseline R2 (2026-11-06)** a labelled, gated, never-indexable **reference** preview (Tanzil Uthmani 1.1, CC BY 3.0) is admitted on pre-adoption staging only by owner decision (§1.1) — not an answer to this entry, which stays OPEN |
| 1.2 | Approved translations, tafsir, reciters | **D** | Content acceptance | 18 | Those layered works are not published as approved. **Since Rebaseline R2** Irfan-ul-Quran appears in staging's reference preview only (§1.2); no tafsir or reciter; the entry stays OPEN |
| 1.3 | Authoritative Hadith sources and grading authority | **D** | Content acceptance · activation | 19 | **No real corpus is published.** Engineering implementation proceeds on fixtures. External hadith corpora declined by the owner (Rebaseline R2); the Hadith landing presents MQI's hadith works (§1.3) |
| 1.4 | Authorised Fatwa scholars | **D** | Content acceptance · activation | 20 | **No real grant is issued and no real Fatwa published.** Engineering implementation proceeds on synthetic material |
| 1.5 | Religious review capacity | **D** | Content acceptance | 18, 19, 30 | Publication throughput, not engineering progress |
| 1.6 | Source-conflict escalation path | **D** | Content acceptance | 30 | Conflicts are surfaced and blocked, never silently resolved |
| 2.1 | Under-18 safeguarding policy | **D** | **Activation**, plus implementation of policy-determined behaviour | 23, 24, 25 | **Fail-closed pre-policy state**: minors-specific capability and student-to-student messaging stay disabled; default-deny mechanics may still be built |
| 2.2 | Applicable jurisdictions | **D** | Activation · launch | 21, 33 | Export, deletion and consent tracking are supported regardless |
| 2.3 | Legal document content | **D** | Content acceptance | 6 publishes | Routes reserved; **no body content published as configuration** |
| 2.3.1 | Correspondence retention period | **D** | Activation | 6 | Public intake stays disabled until the privacy/legal and support owners approve a period |
| 2.4 | Content licensing and attribution | **D** | Content acceptance | 8, 18, 19, 30 | Affected material is not published or migrated |
| 2.5 | Student↔student messaging policy | **D** | Activation | 24 | Disabled by default |
| 3.1 | Written migration authorisation per source | **D** | **Implementation of live-source work**; activation | **30 only** — the phase-start / real-source-contact gate | **No live ingestion.** At Phase-29 exit the framework was delivered on fixtures only and no source was authorised (historical, superseded by Phase 30). **Since 2026-10-27 the seven anticipated sources are owner-attested for pre-adoption staging only** (§3.1), extended on 2026-10-29 (§3.7) and on 2026-11-06 to the comprehensive presentation corpus (§3.9); per-source records by Minhaj stay OPEN. Minimum record: §3.1.1 |
| 3.2 | Source, API or export access | **C** | Content acceptance quality | 30 — **not a universal start blocker** | Authorised public-content ingestion, higher parsing effort; **an export is a source, never the target** (MIGRATION_STRATEGY.md §1.3) |
| 3.3 | Migration scope per source | **C** | Content acceptance | 30 — per-source ingestion | Scope undetermined; out-of-scope content is not ingested |
| 3.4 | Legacy domain control, production promotion and cutover | **C/E** | Launch | **35 only** | Legacy links break at launch; **no effect on Phase 30** |
| 3.5 | Staging migration publication authority (`migration.publish` holder) | **C/D** | Content acceptance | **30 exit** | Migrated content is staged and reviewed but not published in staging. "Nobody holds the grant" was true until 2026-10-28 (historical, superseded by Phase 30): **on pre-adoption staging only a holder exists** by the owner's authorisation (§3.5); Minhaj's naming of a holder stays OPEN |
| 3.6 | Phase-30 gates by timing | — | (classification of 3.1–3.5, 1.1–1.6, 2.4) | 30 | — |
| 3.7 | Pre-adoption review completeness (owner decision, Phase 30-R) | — | Owner, pre-adoption staging only | 30 (Stage 1A) | Decided for staging; Minhaj acceptance, brand pack and production licensing stay open |
| 3.8 | Personal-data flag clearance; Collections from curated archives (Phase 30-RF findings) | **C** | Owner decision, then implementation | 30 (Stage 1A/1B) | **Decided for pre-adoption staging and implemented (Phase 30-RD)**; extended to all fourteen genuine `lkcatid` archives by Rebaseline R2 (§3.8, §3.9). Minhaj's acceptance and any production holder of `migration.clearPersonalData` stay open |
| 3.9 | Comprehensive pre-adoption presentation corpus (owner attestation, Rebaseline R2) | — | Owner, pre-adoption staging only | Pre-adoption staging | Decided for staging; deferred hosts need their own registration (minhajwelfare.org its own authorisation); Minhaj acceptance, scope, production licensing and adoption stay open |
| 4.1 | **Staging/production** SQL Server infrastructure and ownership | **E** | Implementation (28, 34) · launch | **28, 34** | **Staging rows resolved for pre-adoption staging (Phase 28).** Production remains blocked until decided (34). **Phase 1 proceeds on local Developer edition** |
| 4.2 | Staging environment | **E** | Implementation | 28 | **Resolved for pre-adoption staging (Phase 28)** — `minhaj.haseebliaqat.me`; re-provisioned on adopter-owned infrastructure at handover. **Since Rebaseline R2** it may hold operator-run synthetic demonstration data (§4.2) — environment data, never an application mode; its fixture activations are immutable until a database reset |
| 4.3 | Production hosting | **E** | Launch | 34 | Deployment blocked |
| 4.4 | Backup, retention and recovery targets | **C/E** | Launch | 28, 34 | **Staging: interim daily / RPO 24 h / RTO 4 h / 14 days (Phase 28).** Production: conservative defaults until decided; **local restore rehearsal proceeds** |
| 5.1 | Transactional email provider **evidence** | **B** | **Implementation** | ~~2, and transitively everything downstream of 2~~ | **CLOSED ON EVIDENCE.** Domain, DKIM, sending/SPF configuration, DMARC, restricted credential and a real controlled-inbox delivery all demonstrated. **Official adopter-controlled production email remains a separate later activation** |
| 5.2 | Google **OAuth application credentials** | **C/E** | Activation | **2G** | **Google sign-in blocked.** Base auth (2) and the **manual Meet flow (23)** proceed without them |
| 5.3 | Teachers can create/use Google Meet meetings | **C** | Activation | 23 | Live classes not activated — **an organisational capability, not an API credential** |
| 5.4 | Payment provider and merchant account | **C/E** | Activation | **27 only** | **Sandbox proves the software; production needs the merchant account.** Membership proceeds. On staging a demo `fixture` activation exists since Rebaseline R2 (§4.2, §5.4); public giving stays off |
| 6.1 | Canonical organisational facts | **D** | Content acceptance | 6 publishes | Placeholders only; **never published as configuration** |
| 6.2 | Centre and global network data | **C** | Content acceptance | 16 | Find a Centre has no authoritative data |
| 6.3 | Contributor records and capability grants | **D** | Activation · content acceptance | 5, 20, 23 | No real grants issued |
| 6.4 | Brand and visual identity | **C** | Content acceptance | 4 | **Token structure is decided**; **the interim One Minhaj identity is owner-approved (Rebaseline R1, 2026-11-06)** and the official logo is used unmodified as a secondary footer mark (§3.7, §6.4); the organisation's brand pack stays OPEN and replaces the interim values when supplied |
| 6.5 | Content team structure and roles | **C** | Activation | 6 | Separation-of-duties default applies |
| 6.6 | Support and moderation ownership | **C** | Activation | 24 | Support conversations not staffed |
| 7.1 | Search Console and analytics access | **C** | Launch | 35 | No third-party analytics assumed |

**§5.1 was the earliest broadly-blocking external gate, and is now closed on evidence.** It gated
Phase 2, and therefore transitively **3B, 4, 5, 6, 20, 26, 27 and 29** — 29 because its protected
migration administration requires Identity, **not** because of any source-authorisation
requirement (§3.1). **The earliest open external gate in the current baseline is §3.1**, which
gates Phase 30's contact with each real source (§3.6).

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
phases arrive. **Raise §3.1 with them — with §3.3, §2.4 and §3.5 for a Phase 30 meant to complete
in one run** — because Phase 30 is the next phase in the plan and cannot contact any source
without it (§3.6). (§5.1 previously held this place; it is closed on evidence.)

> **Reconciled at Rebaseline R1 (2026-11-06).** The two preceding paragraphs describe the
> pre-Phase-30 baseline (historical, superseded by Phase 30): since 2026-10-27 Phase 30 has
> contacted the seven anticipated sources under the owner's pre-adoption staging attestation
> (§3.1), and a pre-adoption staging `migration.publish` holder exists (§3.5). What stays OPEN for
> the organisation is unchanged: Minhaj's own per-source records (§3.1.1), its naming of a
> publication holder (§3.5), religious authority (§1), the brand pack (§6.4) and every production
> and launch decision. Stage 1B and Phases 31–35 have not started.

> **Reconciled at Rebaseline R2 (2026-11-06).** The owner's pre-adoption decisions of R2 — the
> comprehensive presentation corpus (§3.9), the Quran staging reference preview (§1.1, §1.2) and the
> staging demonstration data (§4.2) — apply to pre-adoption staging only and close none of the
> entries above: religious authority (§1.1–§1.4) stays OPEN, no hadith or fatwa is published, and
> Minhaj's per-source records, publication holder, brand pack, payment provider and every
> production and launch decision stay with the organisation. Stage 1B and Phases 31–35 have not
> started.
