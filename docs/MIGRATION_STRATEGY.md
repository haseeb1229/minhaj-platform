# Migration Strategy — One Minhaj Platform

**Status:** Living canonical baseline for the current accepted repository. Updated in the same
task as any accepted change that directly affects it (DELIVERY_PLAN.md §5.1).
**Origin:** Phase 0A Architecture Freeze, revised after independent architecture audit, and
revised continuously through the delivered phases.
**Document type:** Migration strategy and contract. §1–§12 are the strategy every migration
phase follows; §13 records what Phase 29 delivered and §14 what Phase 30 delivered. **This
document never itself authorises contact with any source** (§1.1). As of the current baseline the
Phase-30 migration engineering is delivered and the seven anticipated public sources are
registered under the owner's recorded pre-adoption attestation (OPEN_DECISIONS.md §3.1). Phase 30
runs in two stages (§10.1): **Stage 1A**, a bounded, representative real review corpus for
pre-adoption staging, and **Stage 1B**, the full initial corpus after Minhaj's review and go-ahead,
which has **not** run.

---

## 1. Starting position

> **ParaTech did not build the existing Minhaj systems.**
>
> **No legacy database dump or export is currently available or assumed. Minhaj may later
> provide source exports, API access, server access or other authorised migration sources.**

This wording matters. The prior revision asserted that no dump *exists*, which claims
knowledge the project does not have and forecloses a possibility that would materially
improve migration quality. The accurate position is that **none is currently available**, and
that **structured export remains a welcome possibility** (OPEN_DECISIONS.md).

Migration is therefore **authorised content ingestion**, operating on:

1. **Authorised public content** from Minhaj-owned public websites, and
2. Any **source access, export or API** Minhaj subsequently supplies.

Everything downstream follows from reconstructing structured records from published
presentation, without the original data model.

### 1.1 Authorisation is a precondition

**No ingestion of any source begins until written authorisation from Minhaj-ul-Quran
International is recorded for that source.** Minhaj owning a site is not itself the
authorisation; explicit confirmation is required and tracked per source.

> **Recorded for the pre-adoption staging corpus (Phase 30, 2026-10-27).** The project owner
> attested that the required permission exists for the seven anticipated sources' **public**
> content, for discovery, fetching and migration into the independent pre-adoption staging
> environment, and the reference `OWNER-ATTESTATION-2026-10-27-PREADOPTION-STAGING` is what each
> registered source carries (OPEN_DECISIONS.md §3.1). The platform records and audits that
> reference and date; it does not — cannot — verify the organisational decision behind it. That
> attestation is **not** official adoption, production authority or religious corpus acceptance.

The minimum decision record Minhaj supplies for each source before Phase 30 contacts it — identity,
authorisation, permitted access, approved scope, asset rights, access restrictions, privacy,
religious review and publication — is defined in **OPEN_DECISIONS.md §3.1.1**. When each Phase-30
decision gates (contact, ingestion, religious acceptance, staging publication, or only Phase-35
cutover) is classified in **OPEN_DECISIONS.md §3.6**.

### 1.2 Absolute prohibitions

- **Never bypass authentication, anti-bot systems, rate limits or access restrictions.**
- **Never ingest private user or student data.**
- **Never infer private data from public pages.** Apparent personal information is excluded
  and reported to Minhaj.
- **Never invent religious content** — no generated text, reconstructed chains, inferred
  gradings, synthesised translations or filled gaps.
- **Never invent organisational facts.**
- **Never publish migrated religious content without domain review.**

### 1.3 A legacy database or export is a SOURCE, never the target

If Minhaj later supplies a `.sql` dump, a database backup, CSV or JSON exports, a CMS export, an
API or source access, that material is **a migration source**. It is emphatically **not** the
new One Minhaj production database.

> **The target remains the One Minhaj SQL Server schema, its reviewed Prisma migrations and its
> bounded-context model** (DOMAIN_MODEL.md, ARCHITECTURE.md §4.1).

- An executable legacy dump belonging to **another schema or engine** is **restored and
  inspected only in an appropriately isolated migration/source environment**. It is never
  restored over, alongside, or into the target database.
- **The target architecture is not reshaped to mimic a legacy schema.** Legacy structure is an
  input to parsing, not a design constraint on the platform.
- **Real target writes happen only through target public interfaces**, orchestrated at Layer 4
  (§2.2) — never as direct table writes from Migration, and never as a bulk restore.

A structured export improves **parsing fidelity and review burden**. It changes nothing about
ownership, review workflows or religious approval.

---

## 2. Ownership

Migration is **not** a script that writes to tables.

| Concern | Owner |
|---|---|
| Persistent migration control and provenance **data** | **Migration & Provenance bounded context** (DOMAIN_MODEL.md §16) |
| Source-adapter **executables and tooling** | `scripts/migration/` |

This corrects the prior revision, which placed migration "outside application modules" while
giving it persistent records, admin routes and an API.

### 2.1 Provenance serves every domain

`LegacySource`, `RawSnapshot`, `ImportRun`, `StagedRecord`, `ImportError`, `LegacyMapping`,
`PublishManifest` and `AssetProvenance` are owned by Migration & Provenance — **not by
Editorial**. Quran, Hadith, Library, Media and Fatwa therefore carry provenance **without
depending on Editorial**, which they are forbidden to do.

### 2.2 Publication direction

> **Migration publishes INTO a target domain through that domain's public application
> interface — never by writing to its tables.**

Composed at the application layer (ARCHITECTURE.md §6.1). Consequently **every domain rule
applies to migrated content exactly as to hand-authored content**, including religious
approval workflows that no import path may bypass.

---

## 3. Approved source concept

A **LegacySource** is a registered, authorised origin modelled as data: identifier and name,
base URL or endpoint, access method, **authorisation reference and date**, **licensing
evidence**, expected content types, languages, rate-limit policy, `robots.txt` and terms
observations, active status, last-run metadata.

### 3.1 Anticipated sources

| Source | Expected content | Notes |
|---|---|---|
| Main Minhaj.org | Organisational pages, news, events, articles | Highest structural variability |
| Minhaj Books | Works, editions, contributors, files | Large asset volume |
| TheFatwa | Published Fatawa, categories | **Published rulings only — never questions with personal data** |
| Minhaj.TV | Video metadata, series, speakers | Metadata only; no video files |
| Irfan-ul-Quran | Quran translation and tafsir material | **Highest scrutiny of any source** |
| Magazines / publications | Issues, articles, archives | Periodical structure |
| eLearning / courses | Public catalogue metadata | Never enrolments |
| Other approved sources | As authorised | Registered individually |

### 3.2 Source adapters

Each source has an **adapter** implementing a shared interface: discover URLs, fetch a record,
identify content type, parse source-specific markup, extract assets and internal links, report
outcomes. Source-specific knowledge lives in exactly one place. A change to one legacy site's
markup affects one adapter.

**Tooling:** a **hardened source-fetch boundary**, not generic global `fetch` — built on Node's
low-level `node:http`, `node:https` and `node:net`, because only they let the fetcher resolve and
validate a host's addresses, pin the request's lookup to the validated address, and re-validate
after every redirect (§8.1; `scripts/migration/safe-fetch.ts`; TECH_STACK.md §18.6). **Cheerio**
parses server-rendered HTML. **Playwright 1.55.x only where JavaScript rendering is genuinely
required and the source is authorised** — never as the default, and **never as a means of passing
an authentication, anti-bot, rate-limit or other access restriction** (§1.2).

---

## 4. Pipeline

```
discover → fetch → preserve raw → parse → extract links → normalize → validate
   → map topics → acquire assets → staging → domain QA → publish → reconcile
```

Each stage is independently observable, resumable, and produces a durable artefact.

### 4.1 Discover

Enumerate candidate URLs via sitemaps, index pages and authorised pagination. Respect
`robots.txt`. Produce a work queue. **Never follow links outside the authorised source scope.**

### 4.2 Fetch — politeness and safe retries

- **Conservative rate limiting.** No deadline justifies burdening Minhaj's infrastructure.
- **Retry only transient failures:** `408`, `429` and selected `5xx`.
- **Respect `Retry-After`** where the server supplies it.
- **Never generically retry ordinary permanent `4xx` responses.** Retrying a `404` or `403`
  is pointless load and, for `403`, edges toward circumventing an access decision.
- Exponential backoff with jitter; **hard stop on repeated failure** rather than hammering a
  struggling server.
- Honest, identifying User-Agent with contact information — no impersonation.
- Per-source concurrency limits.
- **Resumable:** an interrupted run continues from its last completed item.

### 4.3 Preserve raw snapshot

**The most important stage.** Before parsing, the raw response is stored immutably: body,
status, headers, fetch timestamp, source URL, **checksum**.

Why: parsing **will** be wrong initially, and raw preservation permits reparsing without
refetching — protecting Minhaj's servers. It provides an audit trail of what the source
actually said, enables change detection for the delta run, and supports dispute resolution
for religious content.

**Raw snapshots are immutable, are never edited, and are never rendered as live HTML**
(SECURITY_BASELINE.md §10.3).

### 4.4 Parse

Adapter-specific extraction. Failures are recorded as classified errors — **never silently
skipped, never guessed at**.

### 4.5 Extract and rewrite internal links

Absent from the prior revision, and consequential: migrated pages that keep pointing at
legacy URLs send visitors straight back to the sites being replaced.

1. **Extract every internal link** from HTML bodies, document metadata and downloadable
   assets where feasible.
2. **Rewrite links into the old Minhaj ecosystem to their new canonical routes** wherever a
   `LegacyMapping` exists.
3. **Report unresolved links** — every internal link with no mapping is recorded for review.
   Unresolved links reveal content that was missed, deliberately excluded, or genuinely gone.
4. **Never fabricate a target.** An unmapped link is left as-is and reported, never guessed.
5. External links are preserved unchanged.

### 4.6 Normalize

HTML cleanup, entity and **Unicode normalisation**, date and language-code standardisation,
whitespace and typography handling for Arabic and Urdu, reference-format normalisation.

**Arabic and Urdu text handling is a first-class correctness concern.** Incorrect Unicode
normalisation can silently alter religious text.

> **Decided in Phase 29 — conservative Unicode.** **No NFC or NFKC is applied to stored text**:
> Arabic and Urdu bytes are preserved exactly as the source wrote them. Normalisation removes only
> what is never content — C0 control characters (tab and newline kept) — turns CRLF and lone CR into
> LF, collapses ASCII whitespace in a title and trims its ends. A **folded comparison key**
> (`titleKey`: NFKC, lower-cased, punctuation and symbols removed) is computed **only** as a
> duplicate-candidate signal for a person; it is stored beside the revision for matching, and is
> never shown or published as content.

**Server-side HTML sanitisation happens here — before staging, not at render time**
(SECURITY_BASELINE.md §10.2).

### 4.7 Validate

Required fields · language identified · encoding valid · plausible dates · resolvable internal
references · retrievable assets · **domain-specific rules** (a Quran ayah reference must be
structurally valid; a Hadith must carry a source reference; a Fatwa must have an attributable
issuing authority).

**Validation failure blocks progression.** Failing records wait in the error queue for human
resolution; they are never auto-corrected.

### 4.8 Map canonical topics

Legacy categories map to canonical Topics through an explicit, reviewable mapping table using
**typed topic assignment** (DOMAIN_MODEL.md §6.2). Unmapped categories are **surfaced for
human decision, never auto-assigned by similarity**.

Automated suggestion may assist a reviewer. **It never decides.** For religious content, topic
assignment is confirmed by a human.

### 4.9 Acquire authorised assets

Download or copy authorised assets with checksum verification, deduplication by checksum, size
and type validation, **risk-appropriate malware scanning before publication**, and storage
through the StorageService abstraction.

**AssetProvenance is recorded per asset** — authorisation and licensing evidence for *the
asset*, not merely for the site it came from. A site-level authorisation does not
automatically license every third-party image or document on it.

**Video files are never downloaded.** Only provider identifiers and metadata are stored.

**Non-Quran audio is not a provider reference.** Media's AudioTrack holds its recording as a
**storage-backed `Asset`** (DOMAIN_MODEL.md §11, as delivered in Phase 11), so migrating it means
authorised audio metadata **plus** the authorised audio file, acquired as above only where the
rights evidence permits. Photos for Galleries are acquired the same way. **Quran recitations are
not Media audio**: they are Quran-owned (DOMAIN_MODEL.md §8.1) and migrate only on the Quran review
path — an AudioTrack never carries one.

### 4.10 Staging

Records land in a staging area **completely isolated from published content**: visible only to
authorised personnel, never publicly reachable, never indexable, never linkable. **The staging
environment as a whole is `noindex` and `Disallow`** (ROUTE_MAP.md §9.5).

Staging carries the normalised record, its raw snapshot link, validation results, proposed
topic mappings, duplicate candidates, unresolved links, and review state.

### 4.11 Domain-specific editorial and religious QA

The gate separating this from a bulk data load.

| Content type | Review requirement |
|---|---|
| **Quran text, translation, tafsir, recitation** | **Highest.** Verified against authoritative sources by authorised personnel. Automated import to published state is **prohibited** |
| **Hadith** | **Highest.** Text, reference numbers, chains and gradings verified. Gradings **never inferred or generated** |
| **Fatwa** | Verified as genuinely issued by an authorised Minhaj scholar, correctly attributed. Questions with personal data excluded |
| Works, research, publications | Editorial review: metadata, contributors, completeness, asset integrity |
| Articles, news, events | Editorial review: accuracy, dating, duplication |
| Video metadata | Provider references resolve; attribution correct |
| Non-Quran audio, photos and galleries | Metadata and attribution correct; per-asset rights evidence present; asset integrity verified; **no audio is a Quran recitation** |
| Public Learning catalogue | Course and path metadata only; **no enrolment, progress or other private learner data** |
| Collections | Every member resolves to an already-published record of its owning domain; none is guessed |
| Contributor profiles | Biographical accuracy |

**No religious content is published by an automated process. Ever.** Bulk tooling may assist
reviewers with batching and comparison; each religious record requires human confirmation.

### 4.12 Publish

An approved record becomes a live domain record **through the target domain's public
interface** (§2.2). On publication: canonical URL assigned · **`LegacyMapping` written** — the
data that legacy redirects resolve from, live legacy-domain 301s being served only from cutover
(§9.5) · **entry added to the run's `PublishManifest`** · search projection indexed ·
audit entry recording who approved it and when.

### 4.13 Reconcile

Every run closes with reconciliation (§6).

---

## 5. Idempotency, deduplication and change detection

### 5.1 Idempotency

- Every record carries a **stable external key**: source identifier + original URL or identifier.
- Re-fetch compares **checksums**; unchanged records are skipped.
- Changed records create a **new version for review** — never silently overwriting a
  published, human-reviewed record.
- Runs track per-record status, so an interrupted run resumes precisely.
- Stages are individually re-runnable against preserved raw snapshots.
- Large sources are processed in **bounded batches with checkpoints**, so memory stays bounded
  and an interruption costs one batch rather than one run (ARCHITECTURE.md §13.9).
- Every staged record carries **parser and adapter version provenance**, so records produced by
  a parser later found faulty can be identified and reparsed from raw snapshots (§10.3).

### 5.2 Deduplication

The same work, lecture or article frequently appears on several legacy sites. Naive import
would break the platform's central promise with triplicate records.

**Detection signals:** exact asset checksum · normalised title similarity within a type ·
shared ISBN or identifier · same video provider identifier · same contributor plus year ·
substantial body-text similarity.

**Resolution:**
- **Exact asset checksum match** → automatically the same **bytes**, and the stored blob may be
  shared. **It does not follow that it is the same asset** — see the rights rule below.
- **Same video provider identifier** → automatically the same video.
- **Everything else** → a **human deduplication queue**. Titles differ across transliterations
  and languages; automated merging of religious material is unacceptable.
- A merge **preserves all legacy URL mappings**, so every original URL still redirects.
- Merges are audited and **reversible**.

**Cross-language records are never merged.** An Urdu Work and its English translation are a
Work and a translated Edition (DOMAIN_MODEL.md §10.1) — related, not duplicates.

> **Byte identity is not rights identity.** The same PDF may appear on two sources under
> different licences, with different owners, different authorisation evidence and different
> visibility. **Deduplicating storage must never merge rights, provenance, ownership, access
> entitlement or publication permission.** Each asset keeps its own `AssetProvenance` (§4.9)
> even where the underlying bytes are stored once, so a restriction attached to one source's
> copy is never silently lost by pointing at another's.

### 5.3 Source withdrawal is not deletion evidence

A record that stops appearing at a source has **not** thereby been deleted, and treating absence
as an instruction to unpublish would let a transient failure remove reviewed religious content.

> **Absence is not evidence of withdrawal.** It is an observation requiring classification.

Delta processing distinguishes:

| Observation | Meaning |
|---|---|
| **Genuinely withdrawn** | The source has deliberately removed or retired the item |
| **Moved** | The item exists at a new URL — a mapping problem, not a deletion |
| **Source error** | The source is returning an error or a broken page for an item that still exists |
| **Transient fetch failure** | Timeout, rate limit, network failure — **retryable** (§4.2) |
| **Authentication or access failure** | Access has changed; **never worked around** (§1.2) |

**Removal or retirement of published content therefore requires reconciliation and human
review** (§6), never an automatic consequence of a failed fetch. An unresolved disappearance is
**reported**, and the published record is left as it is until a person decides.

---

## 6. Reconciliation

Absent from the prior revision, which could not prove a run complete or correct.

### 6.1 Run-level counts must balance

Every `ImportRun` records and reconciles:

```
discovered → fetched → parsed → rejected → staged → approved → published → mapped
```

**The arithmetic must balance.** Every discovered record is accounted for as published,
staged, rejected, skipped-unchanged or errored. A run whose counts do not reconcile is
**flagged and investigated before the next stage** — an unexplained discrepancy means records
were silently lost.

### 6.2 Source-to-target verification

After publication: record counts per source and content type compared against expectations ·
**asset checksums verified** between source and stored copy · every published record's legacy URL
resolves through `LegacyMapping` to its canonical URL — proven in staging or a controlled resolver
before cutover, and as a live 301 after it (§9.5) · **unresolved-link report reviewed** · spot-check comparison of
published records against their raw snapshots.

### 6.3 Manifests

A **`PublishManifest`** records exactly what one run published: record identifiers, target
domains, canonical URLs, mappings created, assets stored, timestamps and operator.

The manifest is what makes publication **reversible** (§7).

---

## 7. Rollback

### 7.1 Reversible publication

**Migration publication is reversible where practical.** Using the manifest, a run's
publication can be reverted: published records returned to staging or unpublished · created
`LegacyMapping` rows removed or disabled · created redirects withdrawn · merges undone ·
assets retained (never deleted on rollback — orphaned assets are harmless, lost assets are
not) · a full audit entry recording the rollback, its operator and its reason.

**Rollback is never silent** and never destroys the raw snapshots or the staged records.

### 7.2 When rollback is limited

Where a published record has since been **edited by an editor**, or **referenced by user
personalisation**, or **corrected through a religious review**, automatic rollback is **not**
performed. Those records are listed for human decision. Reverting human review work
automatically would destroy exactly the effort the pipeline exists to protect.

### 7.3 Cutover rollback

The launch cutover (§10.2) has its own rollback procedure.

**Triggers:** widespread incorrect redirects · a material share of legacy URLs unresolved ·
**religious content discovered to be incorrect after publication** · sustained availability or
performance failure · data-integrity errors discovered post-cutover.

**Procedure:** DNS or redirect changes reverted per the documented runbook · legacy sites
restored to serving where they remain available · the platform returned to pre-cutover state
or maintenance · incident recorded and root cause established before any re-attempt.

**Rollback criteria and the runbook are written and rehearsed before cutover**, not improvised
during an incident. Cutover requires DNS and legacy hosting access the project does not
control (OPEN_DECISIONS.md).

**Cutover additionally defines, in advance:**

- a **final source watermark or cutoff** — the point after which source changes belong to a
  later delta rather than to this cutover;
- **protection of new production writes** — once the platform is live, editors, donors and
  learners are creating real data, and **a rollback must never discard legitimate new production
  writes** in order to restore a pre-cutover state;
- a **named promotion and cutover owner**, and a **named rollback owner** with the authority and
  access to execute it (OPEN_DECISIONS.md §3.4);
- how delta reconciliation resumes afterwards.

> **Rollback restores the platform's pre-cutover *published* state; it does not roll back time.**
> Where new production writes exist, they are preserved and reconciled, exactly as §7.2 already
> refuses to automatically revert human review work.

---

## 8. Security during migration

### 8.1 SSRF and DNS rebinding

Source URLs are **operator-supplied** and therefore a server-side request forgery vector.

- Fetching is restricted to the registered source's **authorised domains**.
- Internal, loopback, link-local and private address ranges are **blocked**.
- **Resolved IP addresses are revalidated after DNS resolution and after every redirect** —
  the defence against DNS rebinding, where a hostname resolves to a public address on first
  check and an internal one on the actual request.
- Redirects are followed **only within the authorised domain**, to a bounded depth.
- Response size and timeouts are capped.

### 8.2 Untrusted content

Imported HTML is **sanitised server-side before staging** (SECURITY_BASELINE.md §10.2). **Raw
snapshots render inertly** — escaped text or sandboxed download, never live HTML, including in
admin tooling (SECURITY_BASELINE.md §10.3). Imported binaries receive risk-appropriate
validation and scanning before publication.

### 8.3 Incidental personal data

- **Only public content is ingested.** No authenticated area of any source is accessed.
- Incidental personal data in public pages — names, emails, phone numbers in bodies — is
  **flagged and excluded by default**, not carried through and cleaned up later.
- **Raw snapshots containing incidental personal data are access-restricted and carry a
  defined retention and secure-disposal policy.** A raw snapshot is evidence, not an
  indefinite personal data store; retention is bounded and disposal is deliberate.
- Migration operators work under a distinct, auditable role.
- Pages exposing apparently private data are **excluded and reported to Minhaj**.

### 8.4 Publication authority

**`migration.publish` requires step-up reauthentication** and is audited
(SECURITY_BASELINE.md §8). Religious content additionally requires its own domain approval —
migration publication authority does not substitute for scholarly review.

**Who may hold it is an external decision** (OPEN_DECISIONS.md §3.5): nobody holds it in the
current baseline, and real migrated content cannot be published in staging until the organisation
names a holder. That staging publication authority is distinct from **production promotion and
cutover authority**, which is Phase 35's (OPEN_DECISIONS.md §3.4).

---

## 9. Legacy URL mapping and 301 strategy

Minhaj content has been linked, cited, bookmarked and indexed for years. Breaking those links
would destroy accumulated search authority and, more importantly, **break citations to
religious material**.

### 9.1 Mapping

Every migrated record stores source system, original full URL, original identifier and
resulting canonical URL. Created at publication; permanent.

> **`LegacyMapping` maps legacy *source* URLs, and nothing else.** It is **not** the platform's
> runtime slug-history mechanism: an ordinary rename of a natively authored record is handled by
> **native slug history owned by that record's own context** (DOMAIN_MODEL.md §19.7). Using
> `LegacyMapping` for both would make every domain's rename depend on Migration, invert the
> dependency rules, and leave pre-migration renames with no redirect at all.

### 9.2 Redirect rules

- Legacy URL → canonical URL with **301**.
- **Data-driven from `LegacyMapping`**, never hardcoded.
- **Chains collapse to a single hop.**
- Locale preserved where the legacy URL indicated one.
- Later slug changes automatically create a further 301.
- **Targets resolve only from the internal mapping table**, never from user input.

### 9.3 Unmapped legacy URLs

A **helpful 404**: explanation, a search box pre-filled from the URL, links to the nearest
relevant section. **Hits are logged and reviewed** — they reveal missed content.

### 9.4 Domain-level cutover

Whether legacy domains redirect to Minhaj.org, and when, is an **organisational decision
requiring DNS and hosting access** (OPEN_DECISIONS.md §3.4). The platform supports it; the
platform does not decide it.

### 9.5 When redirects are proven, and when they are served

The rules of §9.2 are proven in three steps, and **only the last one serves a legacy domain**:

| Phase | What is proven | What is **not** claimed |
|---|---|---|
| **Phase 30** — initial migration | Complete, reviewed `LegacyMapping` data; every in-scope legacy URL resolves **deterministically** to its intended canonical target; **no chain inside the mapping** wherever that is evaluable — proven in staging or through a controlled resolver or test harness | That any real legacy domain is serving a 301 |
| **Phase 32** — SEO acceptance | The software redirect contract — mapping to a single-hop 301 at the canonical target, unmapped URLs to the helpful 404 — acceptance-tested through controlled routes, fixtures or resolvers | That a legacy host has been cut over |
| **Phase 35** — launch | Legacy-domain 301s activated and served; DNS and legacy-host cutover executed; resolution re-verified **live** after cutover; rollback held ready (§7.3) | — |

Canonical URL preservation is not weakened by this sequencing: the mapping is complete and proven
before launch, and cutover only puts it in front of the legacy domains.

---

## 10. Two-stage migration

### 10.1 Stage 1 — Initial migration

Executed **against staging**, well before launch. **A staging foundation milestone precedes
any live-source migration** (DELIVERY_PLAN.md) — the prior revision required staging in the
migration phase while delivering it only in final operations. **That milestone is Phase 28**
(ARCHITECTURE.md §10.6); it adds no migration objects and runs no migration. Before migrated
content first lands there (Phase 30), the staging reset guard and the backup-before-reset rule
already apply, and the restore proof covers SQL and Storage together.

Sequenced from lowest to highest risk, and so that **nothing is migrated before the records it
refers to exist**:

1. **Taxonomy first** — topics and legacy category mappings must exist before content maps to them.
2. **Reference data** — **contributors via People & Contributors**; countries, regions, cities
   and centres via Global Network.
3. **Editorial and public organisational content** — pages, articles, news, events.
4. **Library** — works, editions, research, publications.
5. **Media:**
   - **Video** — provider metadata and identifiers only, with series and playlists; no video files;
   - **non-Quran audio** — AudioTrack and AudioSeries metadata **plus authorised storage-backed
     audio assets** where rights permit (§4.9) — the delivered Phase-11 model, not a provider
     reference;
   - **Galleries** — Photo, Gallery and GalleryItem with their **authorised image assets**.
6. **Public Learning (eLearning) catalogue** — course and path metadata only; **never enrolments,
   progress or any other private learner data** (§11).
7. **Collections** — only once **every member they reference already exists** as a published
   record of its owning domain. A Collection is a curated selection of other domains' content and
   never creates a second canonical member route (DOMAIN_MODEL.md §7.3); a Collection that names
   later or higher-risk content (a Fatwa, an ayah, a Hadith) **waits for those mappings** rather than
   carrying a placeholder or a guessed link.
8. **Fatwa** — published rulings only.
9. **Quran and Hadith last**, with the longest review period. **Quran recitations** travel with
   Quran on its review path, never as Media audio.

Quran and Hadith come last deliberately: they carry the strictest review requirements, review
cannot be rushed, and by then the pipeline has been hardened on lower-risk content.

**Exit:** all in-scope content migrated, reviewed, approved and published in staging, through a
holder of `migration.publish` under step-up (§8.4; OPEN_DECISIONS.md §3.5) and, for religious
content, with its own domain approval · URL mappings complete and reviewed · **every in-scope
legacy URL resolves through the mapping to its canonical target, proven in staging or a controlled
resolver (§9.5)** — live legacy-domain 301s are Phase 35's · **reconciliation balanced** ·
unresolved-link report reviewed.

#### 10.1.0 Stage 1A and Stage 1B — one Phase 30, two corpus stages

Stage 1 runs in **two stages inside Phase 30**, decided by the owner for the pre-adoption build.
Neither is a separate product phase, and neither uses a separate code path.

| Stage | What runs | When |
|---|---|---|
| **Stage 1A — representative review corpus** | The SAME registered sources, adapters, normalisers, provenance, review, publishers and dedupe rules, over a **bounded selection** of real public records chosen for **coverage**, so every built public area can be reviewed with real content | Before Minhaj's review of the pre-adoption build |
| **Stage 1B — full initial corpus** | The SAME registrations with their selection **widened** to the full authorised scope, A–Z | After Minhaj's review and go-ahead |

**How Stage 1A is selected.** A run is given a bounded selection — listing pages, an item limit and,
where a source needs them, explicit items (surah numbers) — never "the first N URLs" of a whole
site. Selection fills at least one real first page of each major listing where the source can,
covers long and short, dated and sparse-translation cases, and English, Urdu and Arabic where the
source genuinely has them. **Nothing is fabricated to fill a page**: a source that cannot fill a
surface leaves an honest, polished unavailable or limited state, and the limitation is reported.
The selection is recorded by the run itself (its discovered items) and in the operator's local
evidence; there is no "sample data" feature and no DemoMode.

**How Stage 1B expands Stage 1A without rebuilding it.** Source keys never change; each record's
identity is its source plus a deterministic canonical external key (§5.1), so a widened discovery
meets every Stage-1A record again as the same record: unchanged bytes are \`unchanged\`, changed
bytes a new revision for review, published records never overwritten, duplicates still collapse
only on hard identity, every legacy mapping kept. Runs stay bounded, checkpointed and resumable
(§5.1). A Stage-1A record that a later, wider discovery does not see is **observed missing** and
classified by a person (§5.3) — never deleted.

**Reconciliation is per selection.** A Stage-1A run balances against what **its** selection
discovered; records of the source not yet selected are "not selected yet", never "missing".

**Exit.** Phase-30 **engineering** may be complete at Stage 1A. The **full Phase-30 corpus exit**
of §10.1 — all in-scope content migrated, reviewed and published in staging, religious content
signed off by Minhaj's religious authority — remains open until Stage 1B and the required content
acceptance complete. **Phase 31 requires Stage 1B**: search completeness is claimed only against the
full migrated corpus. Phase 35 remains the launch delta and production cutover (§10.2).

#### 10.1.1 Promotion from staging to production

> **Staging acceptance is not production promotion.** Content accepted in staging still has to
> reach production, and copying a staging environment wholesale would carry test state into the
> live platform.

Promotion runs from a **reviewed promotion manifest** — an explicitly approved corpus set — and
**carries forward**: provenance · approval and review integrity · checksums and revisions where
appropriate · legacy URL mappings.

**Promotion never carries forward:**

- ✘ **staging test accounts** or any **known-password user**;
- ✘ **development credentials** of any kind;
- ✘ unrelated **staging configuration**;
- ✘ arbitrary **test records** (PRODUCT_SCOPE.md §4.4, and the test-data rules of
  DELIVERY_PLAN.md §3).

Promotion is **bounded, checkpointed, idempotent and resumable** (§5.1): an interrupted
promotion resumes without duplicating, and a resumed promotion cannot republish content whose
approval has since been withdrawn (DOMAIN_MODEL.md §19.8).

### 10.2 Stage 2 — Launch delta migration

Legacy sites continue publishing during the migration period. The delta run captures
everything added or changed since Stage 1.

**Narrow and fast:** re-discover each source, compare checksums against preserved raw
snapshots, enqueue only new and changed items.

**Review requirements do not relax for delta content.** Delta religious content receives the
same human approval. Because delta volume is small, this is achievable within a launch window
— **provided the delta is genuinely a delta and not a deferred backlog**. Continuous small
deltas during the migration period, not one large final catch-up.

### 10.3 Post-launch

Once legacy sites stop publishing, ingestion ends; content is authored natively. **Migration
tooling is retained, not deleted** — for traceability, for any newly authorised source, and
for re-import of records whose parsing is later found faulty.

---

## 11. What migration explicitly does not do

| Not done | Reason |
|---|---|
| Import user accounts | No access to legacy user data; none sought |
| Import enrolments or progress | Private data |
| Import private Fatwa questions | Private data |
| Import messages | Private data |
| Download and host video files | Provider embeds; no custom video hosting |
| Auto-publish religious content | Human approval mandatory |
| Bypass any access restriction | Absolutely prohibited |
| Generate missing content | Absolutely prohibited |
| Merge cross-language records | Related works, not duplicates |
| Write directly to target domain tables | Publication goes through public interfaces |
| Retry ordinary permanent 4xx | Pointless load; edges toward circumvention |
| Render raw snapshots as live HTML | Stored XSS against administrators |
| **Treat a missing source record as a deletion instruction** | Absence is an observation, not evidence (§5.3) |
| **Merge rights or provenance because bytes match** | Byte identity is not rights identity (§5.2) |
| **Restore a legacy dump as the target database** | A legacy export is a source, never the target (§1.3) |
| **Promote staging test accounts or credentials to production** | Promotion carries content, not environment state (§10.1.1) |
| **Own runtime slug history** | Native renames belong to the owning context (§9.1) |

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Legacy markup varies wildly within one site | Per-source adapters; raw preservation permits reparsing without refetching |
| Religious content misattributed or corrupted | Human review; provenance retained; conflicts escalated; no generation |
| Arabic/Urdu text corrupted by normalisation | Explicit Unicode handling; checksums; character-level comparison against authoritative sources |
| Duplicates fragment the unified graph | Multi-signal detection; human deduplication queue |
| **Migrated pages still link to legacy sites** | **Link extraction, rewriting and unresolved-link reporting (§4.5)** |
| **A faulty run cannot be undone** | **Publish manifests and reversible publication (§7)** |
| **A run silently loses records** | **Reconciliation arithmetic that must balance (§6.1)** |
| Migration load harms Minhaj's live servers | Conservative limits; safe retry classification; raw preservation avoids refetching |
| Review capacity becomes the bottleneck | Sequenced by risk; reviewer tooling; no fixed deadline |
| Legacy links break at launch | Mandatory mapping; data-driven 301s; unmapped-URL logging |
| **Cutover goes wrong** | **Documented, rehearsed rollback with defined triggers (§7.3)** |
| Delta overwhelms launch | Continuous small deltas, not a final catch-up |
| Authorisation ambiguity | No ingestion without recorded written authorisation per source |
| **Asset licensing unclear** | **Per-asset provenance and licensing evidence (§4.9)** |

---

## 13. As delivered (Phase 29) — the generic framework, not a migration

> **Phase 29 delivered the framework and proved it against synthetic fixtures. It migrated
> nothing.** No real legacy source was contacted, no real page or asset was fetched or copied, and
> no real record exists in any Migration table. Real source adapters, live access and initial
> ingestion are **Phase 30**, gated on written authorisation recorded per source (§1.1,
> OPEN_DECISIONS.md §3.1).

| Delivered in Phase 29 — generic | Phase 30 and later — real |
|---|---|
| The Migration & Provenance context, its eighteen tables and their invariants (DOMAIN_MODEL.md §16.5) | Per-source adapters for the real Minhaj sites and any export Minhaj supplies (§3.1, OPEN_DECISIONS.md §3.2) |
| The source-adapter contract (§3.2), and two **fixture** adapters: a synthetic legacy video site and a synthetic executable export | Recording each source's written authorisation; an `authorised` source can be neither registered nor run in Phase 29 |
| The whole pipeline of §4 for one content kind, `media.video` (metadata only — §4.9), publishing a Media Video through Media's public service | Further content kinds, each with its own Layer-4 publisher, in the risk order of §10.1 |
| SSRF-safe fetching, retry classification and `Retry-After` (§4.2, §8.1) against a loopback fixture server | Fetching real hosts, with the per-source politeness each authorisation allows |
| Sanitisation before staging, inert raw evidence, incidental personal-data flagging and snapshot disposal (§8.2, §8.3) | A raw-snapshot **retention period** (OPEN_DECISIONS.md §2.2) |
| Deduplication, topic mapping, link rewriting with unresolved-link reporting, disappearance classification, per-acquisition rights (§4.5, §4.8, §5) | Resolving real duplicates, mappings and religious QA (§4.11) |
| Run reconciliation (§6.1), reversible manifests (§6.3, §7.1–§7.2), the reviewed promotion manifest carried into a local checksummed **bundle** (§10.1.1) | Promotion into production and serving legacy 301s (Phase 35; §7.3, §9) |

**What the fixtures prove, and how.**

- **One external key per record.** A record is identified per source by its canonical URL (lower-case
  scheme and host, no fragment or default port, query parameters sorted) or export identifier.
  Re-fetching identical bytes is recorded `unchanged`; changed evidence becomes a new staged revision
  for review, superseding the earlier pending or approved revision; a Video already published is
  never overwritten by it (§5.1).
- **Resumable, bounded runs.** Sequential, checkpointed batches of at most 25 under a lease, one
  open run per source; an interrupted run resumes without refetching or restaging (§5.1).
- **Hard identity only.** The same `provider:providerVideoId` collapses automatically; a folded-title
  match is a candidate for a person; a cross-language pair is never merged (§5.2).
- **Absence is an observation.** After a complete discovery, unseen records are marked `missing` and
  classified by a person; nothing is deleted, unpublished or redirected because of it (§5.3).
- **Byte identity is not rights identity.** Identical bytes may share one stored asset, but every
  acquisition keeps its own licence, holder, evidence and visibility (§5.2).
- **Unicode is conservative** (§4.6).
- **The executable export is a source.** `synthetic-export.sql` runs only in an in-memory,
  query-only `node:sqlite` database — another engine and schema — and is read through an export
  adapter, never restored into SQL Server or adopted as the target schema (§1.3).
- **Promotion carries content only.** The bundle schema is closed — content, provenance, mappings and
  checksums, never an account, session, credential or configuration — and each entry file is adopted,
  never overwritten, when an interrupted promotion resumes (§10.1.1).

**Runs and promotions are operator commands**, not browser actions: `npm run migration:run-fixture`
and `npm run migration:promote`. Every human decision — review, duplicates, mappings, errors,
disappearances, rights, manifests and promotion approval — is made in `/admin/migration`
(ROUTE_MAP.md §7). Publication needs `migration.publish` with a `migration-publication` step-up
(§8.4), which nobody holds yet (OPEN_DECISIONS.md §3.5).

---

## 14. As delivered (Phase 30) — real sources, eight kinds, Stage 1A

> **Phase 30 delivered the migration engineering for the real sources, and runs Stage 1A — a
> bounded, representative real review corpus for pre-adoption staging.** Stage 1B, the full initial
> corpus, has **not** run (§10.1.0). Nothing here is official Minhaj adoption, religious corpus
> acceptance or production promotion.

**Sources.** The seven anticipated sources (§3.1) are registered as eleven **authorised** sources,
one content kind each, from a committed catalogue (`scripts/migration/sources/catalogue.ts`: key,
kind, exact hosts, `https` base, declared default language, politeness, adapter — never evidence
or a secret). Each carries the written authorisation reference and date the operator supplies at
registration (§1.1). A registration is created **inactive** and activated as a separate audited
act. The database binds an authorised source to its reference and date, a real `https` base outside
`*.invalid`, real host names only (never a literal address or a single label) and a politeness
floor of one request at a time at least a second apart; the catalogue runs every source at three
seconds. A fixture never becomes an authorised source, nor the reverse.

| Source | Registrations (kind) | Notes |
|---|---|---|
| Main Minhaj.org | `minhaj-org-news-en`, `minhaj-org-news-ur` (`editorial.news`) · `minhaj-org-articles-en` (`editorial.article`) | Its "events" are news posts with no event dates, so they migrate as news; body images live on another host and are not acquired |
| Minhaj Books | `minhajbooks-works` (`library.work`) | Book landing pages: metadata and introductions; book PDFs exceed the acquisition cap and are not acquired in Stage 1A; the sale-point tab (contact data) is never read |
| Magazines (minhaj.info) | `minhaj-info-magazines` (`library.magazine`) · `minhaj-info-issues-mq`, `minhaj-info-issues-di` (`library.magazine-issue`) | Issue pages with their table of contents; no PDFs or covers |
| Minhaj.TV | `minhaj-tv-videos` (`media.video`) | YouTube identifiers and metadata from `/english/` pages only (`robots.txt`); audio is a SoundCloud embed, which the storage-backed audio model (§4.9) cannot hold — **source-limited** |
| TheFatwa | `thefatwa-rulings` (`fatwa.ruling`, review-only) | Published rulings; the asker's name and place are never read |
| Irfan-ul-Quran | `irfan-ul-quran-ur`, `irfan-ul-quran-en` (`quran.translation`, review-only) | Translation text per surah, exactly; no Arabic text, tafsir or recitation |
| eLearning (equranclass.com / femaletutor.com) | — | **Source-limited:** the public catalogue has no syllabus, and Learning cannot publish a course without one; a syllabus is never invented |

**Eight content kinds.** `media.video`, `library.work`, `library.magazine`,
`library.magazine-issue`, `editorial.news` and `editorial.article` are **publishable**: each has one
strict staged-payload schema, one normaliser and one Layer-4 publisher over its owning domain's
public service, routed fail-closed (`apps/web/src/composition/migration-target-router.ts`).
`fatwa.ruling` and `quran.translation` are **review-only**: Fatwa exists only as the answer to a
private question carried by distinct people, and Quran layered text hangs from an accepted canonical
corpus and an operator-registered source — no import path exists, and none is invented. Such
material is preserved, normalised, validated and reviewed as evidence; manifests refuse it
(`review-only-kind`), and the database refuses it a manifest entry.

**How far each domain carries a migrated record.** Media, Library (works, editions, magazines,
issues) publish directly under the publisher's own domain keys. **Editorial refuses
self-approval**, so a migrated news item or article is created and **submitted into Editorial's
own review** (`in-review`) and becomes public only when a different person approves and publishes
it; the manifest entry records that stage. A Work's PDF is attached only from a rights-cleared
acquisition (`public-eligible`, decided by a person). A magazine issue names its magazine by the
magazine's legacy URL and is refused until that magazine is published.

**Pipeline additions.** Real DNS through the system resolver, every answer validated and the
connection pinned (§8.1) with the honest identifying User-Agent; `robots.txt` read once per run,
percent-encoded before matching, a missing file allowing and any other failure disallowing;
headings h2–h4 admitted by the sanitiser (h1→h2, h5/h6→h4) and rich text staged as blocks rather than
markup; an oversize payload staged as a rejected stub (`body-too-long`); a strict closed list of
validation issues per kind; bounded bulk review of at most one page, each revision decided and
audited on its own.

**Typed targets.** A manifest entry and a legacy mapping name what they made by one typed,
nullable foreign key per target table — `videoId`, `workId`, `magazineId`, `magazineIssueId`,
`newsArticleId`, `articleId` — exactly one for a mapping, written once (migration
`20261027000000_phase30_source_adapters`).

**Operator commands.** `npm run migration:register-source` and `npm run migration:run`
(`--pages`, `--limit`, `--items`, `--max-items`); on staging `bin/migration-run.sh` runs them in the
exact-SHA operations image inside the `ingest` service — the one operator container with an
outbound network — as the runtime principal. Every human decision stays in `/admin/migration`.
