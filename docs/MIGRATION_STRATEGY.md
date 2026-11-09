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
which has **not** run. Since Rebaseline R2 the owner's further attestation widens what pre-adoption
staging may carry, still in Stage 1A's kind, with 23 catalogued sources (§19; OPEN_DECISIONS.md
§3.9).

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
6. **A reference into the record's own document is dropped** (Phase 30-RV, §18) — `#…`, or the
   record's own URL with a fragment. Sanitisation keeps no `id`, so the fragment can never
   resolve; the words stay and the link goes. Another page's URL with a fragment is unchanged.

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

**As applied since Phase 30-R (§15):** pictures are reached only on a source's exact page and
registered first-party asset hosts; an acquired JPEG or PNG — or, since Phase 30-RF (§16), a still
WebP — keeps its evidence bytes and gains a metadata-stripped public copy, the only bytes a domain
may show (and only a domain that shows that type); and a person decides each acquisition's public
eligibility.

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
- **A false positive may be cleared by a person, and only a false positive** (Phase 30-RD, §17;
  SECURITY_BASELINE.md §10.9). Each distinct match is recorded as evidence (never its text); a holder
  of the externally gated `migration.clearPersonalData`, after its own step-up, classifies each one,
  with a reason; only when every match is a public organisational contact or identifier does a
  replay of the retained snapshot produce a NEW `cleared` revision of the same bytes, approved by a
  different person. Private or unresolved matches keep the record held, exactly as before.

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

> **Current state since Rebaseline R2 (owner decision 2026-11-06, OPEN_DECISIONS.md §4.2).** Still
> no DemoMode and no sample-data feature in the application, and nothing synthetic ever enters the
> migrated corpus. Separately from migration, the **pre-adoption staging environment only** may hold
> clearly synthetic demo personas and their private journeys (classes, messages, a membership on a
> demo type, fixture donations), put there by an operator with `staging:demo:*` / `demo.sh` as
> **environment data**: written through the ordinary services, refused on any deployment that is
> not exactly staging or is indexable, idempotent and resettable, with no real person's name, no
> mail sent and no money moved. It is never an application mode, flag or branch, and promotion never
> carries it (§10.1.1, which already excludes accounts and test records). The R2 corpus itself
> widens Stage 1A without becoming Stage 1B (§19).

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
| Irfan-ul-Quran | `irfan-ul-quran-ur`, `irfan-ul-quran-en` (`quran.translation`, review-only) | Translation text per surah, exactly, and since parser version 3 (Quran Part 6) the translator's own notes beside it, verbatim; no Arabic text, tafsir or recitation (§19) |
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

**Stage 1A on staging (2026-10-28/29).** All eleven sources were registered under the owner's
attestation `OWNER-ATTESTATION-2026-10-27-PREADOPTION-STAGING` (2026-10-27) and activated; each
ran its bounded selection once, from the exact-SHA operations image, at three seconds a request.

| Run | Discovered | Staged | Rejected | Reviewed | Published (stage) |
|---|---|---|---|---|---|
| `minhaj-org-news-en` | 20 | 20 | 0 | 20 approved | 20 (in review → published) |
| `minhaj-org-news-ur` | 20 | 19 | 1 (dated in the future) | 19 approved, 1 rejected | 19 (in review → published) |
| `minhaj-org-articles-en` | 20 | 20 | 0 | 20 approved | 20 (in review → published) |
| `minhajbooks-works` | 25 | 25 | 0 | 25 approved | 25 (public) |
| `minhaj-info-magazines` | 2 | 2 | 0 | 2 approved | 2 (public) |
| `minhaj-info-issues-mq` | 12 | 12 | 0 | 12 approved | 12 (public) |
| `minhaj-info-issues-di` | 12 | 12 | 0 | 12 approved | 12 (public) |
| `minhaj-tv-videos` | 24 | 24 | 0 | 24 approved | 24 (public) |
| `thefatwa-rulings` (review-only) | 24 | 24 | 0 | awaiting qualified review | — |
| `irfan-ul-quran-ur`, `irfan-ul-quran-en` (review-only; surahs 1, 36, 67) | 6 | 6 | 0 | awaiting qualified review | — |
| **Total** | **165** | **164** | **1** | **134 approved** | **134** |

Every run completed **balanced** against its own selection, with nothing missing, errored, excluded
or flagged for personal data. Eight manifests published 134 entries with none refused, and wrote
134 active legacy mappings — each naming exactly one typed target, none duplicated, no chain. The 59
editorial records entered Editorial's own review and were approved and published by a **second**
administrator, never by the account that migrated them. The 30 Fatwa and Quran revisions remain
staged for a qualified reviewer; nothing approved them and no manifest can carry them.

**What Stage 1A shows, and what it cannot.** No image is shown anywhere: the sources' images live
on other hosts or under no recorded rights, and none was acquired or substituted. Editorial has no
field for a source's original publication date, so a migrated news item shows the date it was
published on this platform; the source date remains migration provenance, visible to reviewers.


> *Historical, superseded by §15:* the paragraph above is the state at the first Stage-1A run
> (2026-10-29). Phase 30-R gave Editorial a source date and a lead image, gave the minhaj.org
> sources their first-party image hosts, and re-read the same retained evidence.

---

## 15. As delivered (Phase 30-R) — review completeness: visuals, original dates, more kinds

> **An operational macro inside Phase 30 Stage 1A, not a new phase and not Stage 1B.** The owner
> judged the first 134-record corpus too sparse to present to Minhaj-ul-Quran International and,
> on 2026-10-29, authorised a materially broader, still bounded review corpus with the real
> first-party pictures and original dates its sources carry (OPEN_DECISIONS.md §3.7; owner
> attestation `OWNER-ATTESTATION-2026-10-29-PREADOPTION-CONTENT-BRAND-EXPANSION`). Nothing here is
> official adoption, religious acceptance or production promotion.

**Schema.** Migration `20261030000000_phase30r_review_completeness` (30 migrations; its reviewed
rollback refuses while any row uses what it added). Four more publishable kinds —
`editorial.press-release`, `editorial.page`, `people.person`, `global.country` — with typed targets
`pressReleaseId`, `pageId`, `personId`, `countryId`; a manifest entry `mode` (`create` | `refresh`);
a source host `role` (`page` | `asset`); an acquisition's public copy (`publicAssetId`,
`publicChecksum`, `width`, `height`, all or none). In the owning domains: an optional lead image on
Article, NewsArticle, PressRelease and Page revisions (alt text per translation), the source's
original publication date on the three dated families and the root `chronologyAt` every listing
orders by, a Person portrait, Edition and MagazineIssue covers and a Video poster — each one NO
ACTION key to a stored Storage `Asset` with its measured box (DOMAIN_MODEL.md §16.7). The runtime
principal may never UPDATE the new mapping targets, the public-copy columns or an entry's mode.

**Original dates are product truth.** A dated payload's `publishedOn` — the date the source page
states — is carried into Editorial as `sourcePublishedOn`, and becomes the record's reader-facing
chronology; the migration timestamp and the approval date stay audit and workflow facts. A source
that states no date leaves the platform's own first publication as the chronology. No date is
guessed.

**First-party assets (§4.9 as applied).**
- **Asset hosts.** Each catalogued source names the exact first-party hosts its own pages use for
  pictures — for the minhaj.org sources `minhaj.net` and `www.minhaj.net` (its pages name them;
  minhaj.org lists `www.minhaj.net` as its Minhaj Internet Bureau; both state the same copyright
  holder). A source registered earlier receives each as an audited, append-only
  `migration.source.asset-host-added` act carrying that evidence. Images are fetched through a
  boundary over the page and asset hosts only — the same SSRF, DNS-pinning, redirect and body
  rules — and an asset host's own `robots.txt` is honoured.
- **What an adapter offers.** Only an `https` picture on the source's page or asset hosts whose
  name says JPEG or PNG, presented by the page AS PART OF the record (a post's first picture, a
  book's or issue's `og:image`, a video page's own poster). WebP, GIF and SVG are never acquired
  (at Phase-30-R exit; since Phase 30-RF a magazine issue's still-WebP cover is, §16);
  third-party, social and provider images never. minhaj.info presents each issue cover only
  through its resizer, `/i/{width}/{path}`, which answers in WebP whatever the file is called; the
  cover taken is that same file's original, `/{path}`, on the same host — nothing else is
  rewritten, and an address whose bytes are not the JPEG or PNG its name states is still refused by
  Storage's type check. Its licence claim is `organisation-owned` only
  when the page itself states the © Minhaj-ul-Quran International notice — recorded verbatim as
  evidence — and `unknown` otherwise.
- **Acquisition.** The evidence bytes are stored exactly as fetched, checksum verified and
  scanned; a JPEG or PNG also gets a PUBLIC copy through Storage's image pipeline — structurally
  validated, at most 40 megapixels and 16,384 pixels on a side, every EXIF, XMP, IPTC, comment,
  embedded-thumbnail and trailing segment removed — with its own checksum and measured box. The
  same URL is never fetched twice by a source.
- **Rights.** A PERSON decides each acquisition `public-eligible`, one by one or in the audited bulk
  act at `/admin/migration/runs/{id}/rights` (each acquisition decided and audited on its own;
  only `organisation-owned` or `licensed`, with stated evidence and rights holder). Unknown rights
  stay restricted, and a record is then published without its picture — never with a substitute.
- **Use.** A target records an image only as the public copy of the rights-cleared acquisition of
  exactly the staged URL; the owning domain checks Storage's `servableImages` answer again and
  serves the bytes only through its own route.

**Replay and refresh.** `migration:run --replay` re-reads the source's retained raw snapshots with
the current parser and normaliser (`NORMALIZER_VERSION` 30.3 since Phase 30-RV, §18; 30.2 before
it) without fetching pages — the same bytes read by newer code are a new revision; only images not
yet acquired are fetched. A manifest
over such revisions is made of REFRESH entries for records already published: each is carried into
the record its active legacy mapping names through the owning domain's own update (Editorial: an
author's revision then submission, so the record is in review until a second person approves and
publishes it; Media, Library, People and Global keep the record published), makes no new mapping
and is never rolled back by migration (§7.2).

**Sources.** Sixteen registrations. Five new: `minhaj-org-news-ar` (Arabic news),
`minhaj-org-press-releases-en`, `minhaj-org-pages-en` (eight catalogued pages, each bound to one
reserved Explore route: about/introduction, about/global-impact, shaykh-ul-islam/biography,
organization/forums, organization/un-recognition, our-work/peace, digital-resources/mobile-apps,
digital-resources/social-media), `minhaj-org-people-en` (three leadership profiles; the founder's
own profile is the Shaykh-ul-Islam biography Page, so no legacy address maps to two records) and
`minhaj-overseas-countries` (the Directorate of Foreign Affairs' "MQI in different Countries of
the world" page, linked from minhaj.org's contact page; a fixed ISO table, "Korea" deliberately
absent). Minhaj Books now walks six catalogued categories in order, The Hadith first; Minhaj.TV and
minhaj.info offer their pages' own posters and covers. The English editorial listings never take a
`tid` the catalogue binds as an Explore page (the Articles listing also shows tid 35509, the peace
page), so one legacy address maps to one record. The Press-Release listing names its items in its
own widget and writes its page links with the listing's name after the number; both are read.
A LISTING page is decoded with replacement characters, because only its links are read and its
text never becomes a record (the English News listing cuts one excerpt in the middle of a
character); a record's own page is still decoded strictly.

**Manifests over a large run.** A new manifest is offered only the approved revisions no live
manifest entry holds — the same rule its creation is refused under — so a run of more than one page
of approved revisions is manifested page after page.

**Source-limited, honestly.** Learning (the public catalogue has no syllabus), Events (the source's
"events" are dated news with no schedule), Collections (no genuine curated legacy grouping was
migrated), Audio (SoundCloud embeds only), Galleries and Photos (no authorised gallery listing; a
post's picture is its lead image), Centres (no public directory with addresses — countries of
presence only). Fatwa and Quran stay review-only; Hadith has no authoritative edition. (At
Phase-30-R exit; Phase 30-RF re-checked each area against its source and records the final matrix
in §16.)

### 15.1 Stage-1A expansion on staging

Run on pre-adoption staging on 2026-10-29/30 UTC from the exact CI-green releases `730159e` (the
macro build, migration 30 applied), `d956ce4` (Press-Release listing, minhaj.info cover originals)
and `821dca7` (listing decoding, manifest offer). The three minhaj.org sources registered earlier
received their two asset hosts by the audited act; the five new sources were registered under the
owner attestation `OWNER-ATTESTATION-2026-10-29-PREADOPTION-CONTENT-BRAND-EXPANSION` and activated.
Every Stage-1A source was REPLAYED from its retained evidence first, then expanded under a bounded
selection. **21 runs, every one completed and `balanced`.**

| Source | Replay: staged / rejected | Expansion: discovered · staged · unchanged · rejected · errored · excluded | Published entries (create + refresh) | Stage |
| --- | --- | --- | --- | --- |
| `minhaj-org-news-en` | 20 / 0 | 60 · 39 · 20 · 1 · 0 · 0 | 39 + 20 | in review → published by a second person |
| `minhaj-org-news-ur` | 19 / 1 (date implausible) | 60 · 40 · 20 · 0 · 0 · 0 | 40 + 19 | in review → published |
| `minhaj-org-news-ar` | — | 30 · 29 · 0 · 0 · 1 (title missing) · 0 | 29 + 0 | in review → published |
| `minhaj-org-articles-en` | 20 / 0 | 60 · 30 · 20 · 2 · 1 · 7 | 26 + 20 (2 held unreviewed for their flags) | in review → published |
| `minhaj-org-press-releases-en` | — | 30 · 30 · 0 · 0 · 0 · 0 | 30 + 0 | in review → published |
| `minhaj-org-pages-en` | — | 8 · 4 · 0 · 0 · 0 · 4 | 3 + 0 (1 held unreviewed) | in review → published |
| `minhaj-org-people-en` | — | 3 · 3 · 0 · 0 · 0 · 0 | 3 + 0 | public |
| `minhaj-overseas-countries` | — | 30 · 30 · 0 · 0 · 0 · 0 | 30 + 0 | public |
| `minhajbooks-works` | 25 / 0 | 120 · 103 · 0 · 1 · 16 (primary locale undetermined) · 0 | 77 + 25 (2 refused) | public |
| `minhaj-info-issues-mq` | 12, then 36 / 0 | 36 · 24 · 12 · 0 · 0 · 0 | 24 + 12 | public |
| `minhaj-info-issues-di` | 12, then 36 / 0 | 36 · 24 · 12 · 0 · 0 · 0 | 24 + 12 | public |
| `minhaj-tv-videos` | 24 / 0 | 72 · 40 · 23 · 6 · 3 (locale, provider or language missing) · 0 | 39 + 24 | public |

Twenty-nine manifests over the macro's runs hold **498 entries: 364 creations and 132 refreshes
published, 2 refused** by Library — one work whose only labels are Sindhi (Library labels a work
in the interface locales only) and one whose target already existed. Every refusal is final and
the record stays on the source. Of the eight bound Explore pages, four use the site's
section-landing layout rather than a post and were excluded at parse (`not-an-editorial-post`:
global-impact, the Shaykh-ul-Islam biography, forums, social-media) and the introduction page is
held unreviewed for its personal-data flag; those five remain reserved Explore pages. (Corrected
in Phase 30-RF, §16: the four are ordinary posts the site redirects under an empty category
segment, and they were excluded as `not-a-tid-page`; the exclusion reason is not persisted, and
the one recorded here was inferred.) Eleven rows
invalid on review were rejected. Two articles and one page
held a personal-data or validity flag and were left unreviewed; nothing flagged was approved.

**Pictures.** **461 acquisitions** (lead images 222, portraits 3, book covers 104, issue covers
63, video posters 69 — counted per acquisition, a replayed record's image fetched once), every one with a
metadata-stripped public copy and every one decided `public-eligible` by a person as
`organisation-owned` under the page's own © notice; **none was left restricted** and none of
unknown rights was cleared. Refused: **63** issue-cover answers that were WebP behind `.jpg`/`.png`
names (the minhaj.info resizer — refused by Storage's type check before `d956ce4` took the
originals); no non-first-party picture was offered. On the published records: news 146 of 147
with a lead image, articles 39 of 45, press releases 25 of 30, pages 3 of 3, works 102 of 102 with
a cover, issues 63 of 72 (the nine newest issues present only a `.webp` cover, left on the
source), videos 63 of 63 with a poster, people 3 of 3 with a portrait; countries carry none.

**Dates and the second person.** Every published news item (147), article (45) and press release
(30) carries its source's own publication date, and listings order by it. The Editorial creations
and refreshes landed in review; a second administrator (`content.review`, `content.publish`, never
the migration actor) approved and published every one — 226 items — and the review queue is empty.

**Mappings and reconciliation.** **497 active legacy mappings**; **0** chains, **0** mappings made
by a refresh, **0** mappings naming more than one target. One cross-source duplicate was found:
minhaj.org tid 35509 had been taken both as the bound Explore page and as an article (the active
mapping key is per source). The article copy's mapping was disabled by the audited act, the
duplicate article archived through Editorial, and the English editorial listings now reserve the
bound pages' tids (`3bdd7a4`), so no legacy address has two destinations. Review-only material is
untouched: 24 Fatwa and 6 Quran-translation revisions remain `pending`, with **0** manifest
entries. A post-migration backup set (`20261030T120812Z`: SQL 130 MB, 885 Storage files) was
restored from Blob into an isolated database — 30 migrations, constraints trusted, runtime least
privilege, 885 of 885 assets verified, the restored database dropped and the live one untouched.

## 16. As delivered (Phase 30-RF) — final Stage-1A gap closure

> **An operational continuation inside Phase 30 Stage 1A, not a new phase and not Stage 1B.**
> "30-RF" is a working checkpoint label. It closed the ordinary engineering gaps the Phase-30-R
> record left open, made one bounded evidence sweep of the source-limited areas, and accepted the
> final review build. No schema change: the migration count stays **30**.

**The four "section-landing" Explore pages were ordinary posts (a correction to §15.1).** The
retained raw evidence of global-impact (tid 8721), the Shaykh-ul-Islam biography (8718), forums
(8722) and social-media (27184) shows each is a normal `article.post`. The site redirects a page
filed under no category to `/english//tid/{n}/{slug}.html` — an EMPTY category segment — and the
adapter's address pattern required a non-empty one, so each was excluded as `not-a-tid-page`
before it was read; the exclusion reason is not persisted, and §15.1 inferred the wrong one. The
pattern now accepts an empty segment (one stable rule, not four exceptions); a listing link under
such an address is keyed by its `tid` like any other. Replayed from the retained snapshots — no
page fetched again — all four parse with their title, body and source date, none is flagged, and
the biography takes its first-party portrait as its lead image. On staging the four were created
in review and a second administrator approved and published them: **seven of the eight bound
Explore pages are now published**.

**The introduction page stays reserved — a decision, not a defect (OPEN_DECISIONS.md §3.8).** Its
personal-data flag comes from the Central Secretariat's postal address, office, UAN and fax numbers
and an organisational mailbox in its body: a person classified every match as a public
organisational office contact (class B). But a flagged revision cannot be approved (§8.3: flagged
material is excluded by default), and its staged text already reads `[redacted]` where each match
was; clearing a flag is a new privacy control the accepted model does not have. No prose was
rewritten to pass. (Historical: decided and delivered in Phase 30-RD — the page is published, §17.)

**Still WebP for magazine covers.** Storage admits a still WebP for a policy that names
`image/webp` — container-level validation and metadata removal without decoding a pixel; animation,
trailing bytes, malformed chunks, contradictory feature flags and oversized canvases are refused
(SECURITY_BASELINE.md §10.8). Migration's acquisition and public-copy policies name it; minhaj.info
issue covers may now be a `.webp` original on the same host; a migrated image reaches a domain only
when that domain shows its type, so a WebP becomes a Library cover and never an Editorial lead
image, a portrait or a poster. Of the nine issues §15.1 left without a cover, **eight** now carry
their WebP original (July–October 2026 of both magazines), each sanitised by Storage, decided
public by a person and carried in by a refresh entry. The ninth, December 2024, is not a WebP case:
its own page names its cover `…/titlethumbs/2024-12.php`, a script path rather than an image, so
no cover is offered and it stays without one.

**The source-limitation sweep (2026-10-31; about a dozen polite requests to authorised hosts,
robots honoured).** Each area kept YELLOW only with its evidence:

| Area | Official source checked | What the source has | What the target needs | Result |
| --- | --- | --- | --- | --- |
| Learning | `equranclass.com` course pages (the eLearning catalogue minhaj.org links) | title, description, levels with class length and plan durations | a Course publishes only with a complete module-and-lesson syllabus; no migration kind exists | **YELLOW** — no syllabus is published; none is invented |
| Events | minhaj.org Top-Events and its 14 themed archives | dated news coverage of conferences, retreats and gatherings | an Event's identity with a schedule (start, end, time zone) and venue or online truth | **YELLOW** — coverage is news, not an Event |
| Collections | minhaj.org `lkcatid` archives | genuine curated archives (Al-Hidayah 20 posts; Mawlid Conferences 43 in four sections; Itikaf 51 in two) | a new publishable kind with a typed target, member posts migrated first, and the Phase-30-R boundary on members lifted | **YELLOW — needs a decision** (OPEN_DECISIONS.md §3.8), not a source limitation (historical: decided and delivered in Phase 30-RD, §17) |
| Audio | minhaj.tv audio pages | SoundCloud embeds only — no first-party audio bytes, no `<audio>` | stored first-party audio with its rights | **YELLOW** — third-party audio is never downloaded |
| Galleries / Photos | minhaj.org navigation and pages | no gallery or photo section; a post's pictures are its lead image | a gallery identity, ordered photos, captions, credits and rights | **YELLOW** — no gallery is manufactured from lead images |
| Centres | minhajoverseas.com country pages; minhaj.org contact page | countries of presence and prose about centres; departments' contacts | a current directory of named centres with an address, privacy-permitted contacts | **YELLOW** — no directory; no centre inferred from news, no coordinates guessed |

Fatwa and Quran stay review-only and Hadith unactivated (no authoritative edition or qualified
review).

### 16.1 On staging (2026-10-31)

Run from the exact CI-green release `0945a86` (branch CI 41182517179, 5/5 first attempt; staging
deploy 41183695614). Three replays of retained evidence — `minhaj-org-pages-en` (8),
`minhaj-info-issues-mq` (36) and `minhaj-info-issues-di` (36) — **every one completed and
`balanced`**, nothing rejected or errored, no page fetched again; nine images acquired (eight WebP
covers, one portrait), every one with a public copy and none refused. Each new revision was
compared with its record's previous revision: the **13** that differ (four new pages, the peace
page, whose links to its own legacy address now resolve to its platform path because its mapping
exists, eight issues with a cover) were approved; the **66** identical
to what is already published (same payload checksum, only the parser version moved) were rejected
with that reason, so nothing was republished for no change; the flagged introduction revision was
left unreviewed. Three manifests published **13 entries** (4 creations, 9 refreshes, none refused);
the five Pages landed in review and a second administrator approved and published each.

**Final Stage-1A review build:** **501 ordinary public records** (147 news, 45 articles, 30 press
releases, 7 organisational pages, 102 books, 2 magazines, 72 issues, 63 videos, 3 leadership
profiles, 30 countries); **501 active legacy mappings** with **0** chains, **0** addresses mapped
twice, **0** mappings made by a refresh and **0** naming more than one target; **470** first-party
pictures, every one decided public by a person (issues 71 of 72 with a cover, pages 4 of 7 with a
lead image); 24 runs since Phase 30-R began, all balanced. Fatwa (24) and Quran (6) revisions stay
review-only with **0** manifest entries. A backup set `20261031T093409Z` (SQL 134 MB, 903 Storage
files) passed an isolated restore proof from Blob — 30 migrations, constraints trusted, runtime
least privilege, 903 of 903 assets verified, the restored database dropped and the live one
untouched.

**Final review on staging.** 47 public and administrative routes — home, Explore and all eight
bound pages, leadership and a profile, News in English and Urdu, articles, press releases,
Library, books, magazines and two newest issues with their WebP covers, Watch and a video, Listen,
photos, galleries, the media archive, Global, a country, Find a Centre, Learn, Events,
Collections, Quran, Hadith, Fatwa, search, topics, help, My Minhaj and the migration overview — in
en, ur and ar at 390, 768 and 1440 px: **423 loads**, each answering 200 in its locale's direction
with one main heading, no horizontal overflow, no broken or alt-less image and **no request to any
other host** before a visitor acts. (`/media` itself has no index by design and answers 404; no
navigation links to it.) One presentation defect was found and fixed: an undated Page showed the
platform's own publication day as its "Published" date, so the 2009 founder's profile read as new
(DOMAIN_MODEL.md §7.2.1); re-checked on the redeployed release `0b3cea0`. The edge still refuses a
request without its credential (401, including the realtime path), redirects HTTP to HTTPS, serves
`robots.txt` disallowing everything and marks every response `noindex`.

## 17. As delivered (Phase 30-RD) — owner decisions: personal-data clearance, curated archives

> **An operational continuation inside Phase 30 Stage 1A, not a new phase and not Stage 1B.**
> "30-RD" is a working checkpoint label. It implements the two owner decisions of
> OPEN_DECISIONS.md §3.8 for the pre-adoption review build. One schema migration,
> `20261031000000_phase30rd_owner_decisions`: the count becomes **31**.

**Clearing a personal-data false positive (§8.3; SECURITY_BASELINE.md §10.9).** The detector is
unchanged and still the default. What is new:

- **Findings.** A run that stages a flagged revision records each DISTINCT match once — type,
  a SHA-256 over the input checksum, the type and the matched text (never the text itself), and the
  already-redacted words around it — as one complete set (`MigrationPersonalDataFinding`). A
  flagged revision staged before findings existed is re-staged ONCE by the next replay so its
  findings are recorded; otherwise an undecided revision of unchanged bytes stays unchanged.
- **Classification.** On the staged record's page, a holder of the externally gated
  `migration.clearPersonalData`, after a `migration-personal-data` step-up, classifies each finding
  — `public-organisational-contact`, `public-organisational-identifier`, `personal-or-private` or
  `unresolved` — with a reason, one at a time, at the version shown. The exact text is read in the
  audited raw-evidence preview; the audit row carries no text, context or reason.
- **The cleared replay.** When every finding of the CURRENT flagged revision is cleared, the next
  replay of the retained snapshot re-reads the same bytes with the same normaliser, leaving exactly
  the cleared texts as written — and only if this read finds exactly those findings. The result is
  a new revision, `personalData = cleared`, naming the flagged one, which is kept unchanged. Any
  private or unresolved match keeps the record held; changed bytes are flagged afresh.
- **Two people, then Editorial's workflow.** A cleared revision is approved only by someone who
  cleared none of its findings; a manifest carries it like any approved revision, and Editorial
  needs a different person again to approve and publish it.

**Curated archives as Editorial Collections (DOMAIN_MODEL.md §7.3.1, §16.8).** One more
publishable kind, `editorial.collection`, with the typed target `collectionId`:

- **Two bounded sources, both committed in the catalogue.** `minhaj-org-collections-en` reads
  exactly the three owner-approved archives by `lkcatid` — Al-Hidayah (12), Mawlid Conferences (1)
  and Itikaf during Ramadhan (2) — never every category: the title, the page's own meta
  description less the template's "by Minhaj-ul-Quran International." tail, and every post card of
  the main column's archive list in document order, each with the section (`h3`) and group (`h4`)
  heading above it. A card linking anywhere but a `tid` post of the site in the archive's language,
  a paginated archive or an empty one fails the parse: an archive is migrated exactly or not at
  all. `minhaj-org-archive-news-en` migrates the posts those archives hold, from a fixed reviewed
  list of **114** `tid`s (20 + 43 + 51, Itikaf's one repeat kept once) as `editorial.news` — the
  site files them under regional news categories, which each keeps from its own address; the
  English listing sources reserve those `tid`s so one legacy address never maps to two records.
- **Normalisation.** Members by the canonical form of their legacy address, in source order; a
  repeat kept once at its first place and counted (`repeatedMembers`); a non-`https` member or an
  empty archive holds the record; at most 100 members (Editorial's bound). The slug is the title's,
  never the numeric category.
- **Members first, then the Collection.** The Collection target resolves every member's legacy URL
  through an ACTIVE legacy mapping only, to the exact typed record migration published — never a
  title match. A member without one (`member-unmapped`) or of a type a Collection may not hold
  (`member-kind-refused`: only Article, the four News families, Work and Video) refuses the whole
  archive. Editorial then asks each member's owner — Editorial, Library, Media — whether it is
  public now, through the same public reads the public pages use, strictly: the rule a curator's
  Collection meets. The Collection is created and submitted through Editorial's own workflow; a
  different person approves and publishes it. Its standfirst is the source's description; its
  introduction is left empty rather than written. Refresh revises it through the same workflow in
  the source's current order; rollback archives it.
- **Two entries no record can be made of — named, never silently dropped (owner decision
  2026-11-02).** The member run found one Al-Hidayah entry ("European al-Hidayah Camp 2017:
  Highlights", tid 41122) that is only pictures and social-media embeds, with no text an Editorial
  record can carry (rejected `body-missing`), and one Mawlid entry (tid 3484) the source no longer
  serves (its address redirects to the site's home page; excluded). The committed catalogue records
  exactly these two with their reasons (`MINHAJ_ORG_ARCHIVE_EXCLUSIONS`); the Collection adapter
  carries them as `excluded`, and the staged payload names them in `excludedMembers` for the
  person who approves the Collection. Every other entry still resolves exactly or refuses the
  archive, so Al-Hidayah is published with 19 of its 20 entries and Mawlid Conferences with 42 of
  43; Itikaf (51 entries, its one repeat kept once) is exact.

### 17.1 On staging (2026-10-31 – 2026-11-02)

Run from exact CI-green releases: `c5d0dbb` (branch CI 41226330077, 5/5 on its second attempt —
the first lost only the browser job's global teardown to a SQL timeout, all 509 browser tests
having passed; migrate-and-deploy 41229333489, a backup set `20261031T183715Z` taken before the
schema moved to **31** migrations) for the clearance and the member posts, and `576e5b3` (branch CI
41480782196, 5/5 first attempt; deploy 41484695429), which adds the two recorded exclusions, for
the Collections.

- **The clearance.** A second administrator created the custom role `staging-personal-data-clearer`
  (`migration.clearPersonalData`, `migration.read`) and granted it to the first under
  `permissions.grant` — never a self-grant. A replay of `minhaj-org-pages-en` re-staged the
  introduction page once to record its findings (seven pages unchanged): **six**, five phone-like
  runs and one email — the Central Secretariat's office, UAN and fax numbers and the head office's
  telephone, fax and mailbox, all printed under "Our Contact" and the organisation's address. The
  first administrator, after the `migration-personal-data` step-up, classified each one
  `public-organisational-contact` with a reason (six audited decisions, no text in the audit). The
  next replay produced the `cleared` revision of the same input checksum with no `[redacted]` left;
  the flagged revisions are unchanged. The second administrator approved it (the database would
  have refused the first); the first published its manifest, and the second approved and published
  the Page in Editorial: **all eight bound Explore pages are now published**. The six findings were
  recorded by a release whose context folding dropped every letter "s" from the surrounding words;
  findings are immutable evidence, so they keep that context — the exact text was read in the
  audited raw preview — and the fold is fixed for every later finding.
- **Members first.** `minhaj-org-archive-news-en` fetched the 114 catalogued posts (balanced): 112
  staged valid, **none flagged**, one rejected (tid 41122, no text) and one excluded (tid 3484, gone
  from the source) — the two the catalogue now records. 107 lead images were acquired, each with a
  public copy, and decided public by a person; the 112 were approved, published by five manifests
  into Editorial review and approved and published there by the second administrator.
- **The Collections.** `minhaj-org-collections-en` read the three archives (balanced, nothing
  flagged): **Al-Hidayah 19** members (one excluded), **Mawlid Conferences 42** (one excluded),
  **Itikaf during Ramadhan 51** (its one repeat kept once). Every member resolved through an active
  mapping to a published news record; one manifest published all three into Editorial review, and
  the second administrator approved and published each.

**Totals after 30-RD:** **617 ordinary public records** — 259 news items (147 + 112), 45 articles, 30
press releases, 8 organisational pages, **3 Collections**, 102 books, 2 magazines, 72 issues, 63
videos, 3 leadership profiles, 30 countries; **617 active legacy mappings** with **0** chains, **0**
addresses mapped twice and **0** made by a refresh; **577** first-party pictures, each decided public
by a person; 28 runs since Phase 30-R began, every one balanced. Fatwa (24) and Quran (6) revisions
stay review-only with **0** manifest entries. A backup set `20261102T171008Z` (SQL 162 MB, 1,113
Storage files) passed an isolated restore proof from Blob — 31 migrations, constraints trusted,
runtime least privilege, 1,113 of 1,113 assets verified, the restored database dropped and the live
one untouched.

**Final review on staging.** 26 routes — home, Explore and all eight bound pages (the introduction
among them), the Collections listing and its three Collections, News, articles, books, magazines,
videos, leadership, countries, Learn, Quran, Hadith, Fatwa and search — in en, ur and ar at 390, 768
and 1440 px: **234 loads**, each answering 200 in its locale's direction with one main heading, no
horizontal overflow, no broken or alt-less image, no `[redacted]` placeholder anywhere and **no
request to any other host**. Each Collection page links every member to its own canonical address
(19, 42 and 51 links) in every locale and width.

## 18. As delivered (Phase 30-RV) — owner staging review: defect-only closure

> "30-RV" is a working checkpoint label: the defect-only closure of the owner's final staging
> review, not a new phase and no new scope. No schema change.

The final review of the deployed build (41 routes, en, ur and ar, 390, 768 and 1440 px, plus a
read-only content pass) found five ordinary defects, each fixed at its cause:

- **Footnote references reloaded the page** (§4.5 rule 6). Word-style footnotes (`#_ftn1`) were
  resolved against the record's own URL and rewritten to its own canonical path: 86 "[n]" links on
  the peace page pointed at the page itself. A reference into the record's own document is now
  dropped — the words stay.
- **Image-only links lost their words.** The mobile-apps page links each app only through its
  icon; with the image not carried, each link was left empty and removed, leaving eight bare names.
  An image inside a link to anything but a picture is now that link's label: sanitisation keeps its
  non-empty `alt` as the link's words (redacted like any other text). When such an image is a
  minhaj.org post's first picture it is still the lead picture, but it no longer leaves the body
  with it, so the link keeps its words (`isPictureAddress` decides "a link to a picture" in both
  places). An image in a link to a picture is a picture only, as before.
- **A profile's opening heading stood as its card summary.** A biography is plain text; a heading
  before any of its prose ("Current Status") is now dropped — the profile's own Biography heading
  titles that section — and every later heading stays.
- **A Page's search result stated "Published" and the platform's publication year**, though the
  Page itself states no date (DOMAIN_MODEL.md, Editorial). It states none now.
- **A romanised title's Urdu description read left to right.** One Work label holds one locale for
  title and description; 44 migrated books pair a Latin-script title with an Urdu description.
  Under a left-to-right label a description now takes its direction from its own text; its `lang`
  still names the label's locale.

`NORMALIZER_VERSION` is **30.3**, and the four minhaj.org adapters that read posts have new parser
versions, so a replay of their retained evidence restages every record they made; records not
replayed keep their published revision until their source is next run.

**Observed and not changed** (each needs a decision, not a defect fix):

- **Magazine issues and books list in slug order.** No minhaj.info issue page states a date or
  number, so an issue's month and year exist only in its title; and every migrated book's slug is
  its legacy number (`book-120`). Ordering them chronologically or by title needs a
  month-precision issue date or a Library ordering rule — a model decision.
- **Private and sign-in pages carry the product name as their whole document title** (about 170
  routes under `/admin`, `/my`, `/teacher` and the sign-in flow) — a consistent gap since those
  areas were built, recorded for a later accessibility pass.
- Source artefacts kept as written: an orphan closing heading on one 2025 post, `<br>`-ended list
  items on the introduction, a leadership name that carries its role in parentheses (the profile
  title as written).

### 18.1 On staging (2026-11-03)

The defect fixes ran on release `8d5d49a` (branch CI 41605219941, deploy 41608188495). An earlier
replay on `c8ba0a7` showed the first form of the image rule removing a real lead image — the UN
recognition page's photograph links to the UN press release — so none of that replay was
approved; the rule was corrected as above and the parsers moved to new versions.

- **Replays** of `minhaj-org-pages-en` (8) and `minhaj-org-people-en` (3) from retained evidence,
  both balanced. Five revisions differ from the published ones, each only by a fix: the peace page
  (86 footnote markers kept as words, no self-link), the mobile-apps page (8 app links), the UN
  recognition page (its photograph kept, the press-release link added), the biography page (a
  book-category banner's link kept as words) and the Hassan Mohi-ud-Din Qadri profile (the opening
  heading dropped). No lead image or portrait changed. They were approved, published by two refresh
  manifests, and the four pages approved and published in Editorial by the second administrator.
  The five identical revisions were rejected as identical; the introduction's replay matched its
  earlier flagged revisions exactly and was rejected, so its published, cleared revision stands
  (its replays recorded 12 findings on revisions that are not published).
- **Search** was rebuilt; a Page result states no year, an Article result still does.
- **Totals unchanged:** 617 ordinary public records, 617 active mappings (0 chains, 0 duplicates,
  0 made by a refresh), 577 pictures, 32 runs since Phase 30-R began, every one balanced; Fatwa (24)
  and Quran (6) still review-only with 0 manifest entries; 31 migrations.
- **Final review:** 41 routes in en, ur and ar at 390, 768 and 1440 px — **369 loads**, each 200
  in its locale's direction with one main heading, no horizontal overflow, no broken or alt-less
  image, no `[redacted]` placeholder and no request to any other host.

## 19. As delivered (Rebaseline R2) — the comprehensive pre-adoption presentation corpus

> **An owner-directed operational macro, not a canonical phase and not Stage 1B.** The owner
> attested on 2026-11-06 that the pre-adoption staging build may carry the public official content
> of every built kind, not artificially capped
> (`OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS`, OPEN_DECISIONS.md §3.9) —
> still staging only, `noindex`, behind the environment gate, and still Stage 1A in kind (§10.1.0):
> the same registrations, adapters, normalisers, provenance, review and publishers, with wider
> selections. It is not Minhaj's content acceptance, not production and not adoption. **No
> Migration & Provenance schema change** and no new kind; the platform's two R2 migrations belong
> to Quran and Storage, so the count becomes **33** (DOMAIN_MODEL.md §1.1, §8.4, §16.9).

**Sources.** 23 catalogued authorised sources (`scripts/migration/sources/catalogue.ts`), five of
them new, each on an existing kind and under the same politeness (three seconds between requests,
one at a time, robots respected):

- `minhaj-org-press-releases-ur` and `minhaj-org-articles-ur` — the Urdu Press Release and Articles
  listings of minhaj.org;
- `minhaj-info-issues-ulama` — the quarterly al-Ulama on minhaj.info (titles, dates and the table
  of contents; no PDF), beside the two existing magazines;
- `minhaj-tv-videos-ur` — the Urdu Speeches listing of minhaj.tv (metadata and YouTube identifiers
  only, from the `/english/Urdu-Speeches/` listing robots allows); a video the English listing also
  holds collapses into one record by its YouTube id, as before;
- `minhajbooks-authors` (`people.person`) — eight Minhaj Books author pages as public profiles:
  the name, the full biography paragraph (never the cut teaser) and the author's own first-party
  photo; no social link, contact detail or book list. The publisher's author index less the four
  authors already public as one record each (the founder's biography Page and three leadership
  profiles): one person, one record.

And wider catalogues on existing sources: `minhaj-org-collections-en` reads **all fourteen**
editor-curated `lkcatid` archives the site's archive index listed on 2026-11-06 — the three of
Phase 30-RD plus Women Activities, Welfare Projects & Events, Conferences & Seminars, Interfaith
Activities, Quaid Day Programs, Spiritual Gatherings, Processions & Rallies, Educational Projects,
Overseas Activities, Visits & Delegations, and Peace, Integration and Reconciliation (the owner's
extension of OPEN_DECISIONS.md §3.8 to every genuine archive; still never every category);
`minhaj-org-archive-news-en` names the **519** posts those archives hold (114 before), each `tid`
once under the first archive that lists it, the two recorded exclusions kept (§17); the Minhaj
Books works source walks every English category the site's sitemap names (33); the countries table
names **39** countries, "Korea" placed as the Republic of Korea only on its own page's evidence; and
the Explore page bindings gain two: the contact page (tid 1797) at `/contact` and the Annual Reports
page (56402).

**The same post through two sources — a soft identity.** The organisation's sites share one CMS
whose post number (`tid`) is one number space across languages, sections and hosts, so a press
release is also under "All News" and an archive member also in a section listing. A news item,
article or press release whose legacy identifier is `tid-{n}` carries `tid:{n}` as an identifier
signal that is **not hard** (§5.2): a second record with it is a duplicate candidate a person decides
at `/admin/migration/duplicates` (merge or distinct) — never collapsed automatically and never a
title guess. `NORMALIZER_VERSION` is unchanged (30.3).

**Deliberate deviations from the R2 working plan** — each a recorded limit, never a gap filled by
guessing:

- **No year archives.** Selection stays bounded listing pages, newest first.
- **Only two more Explore pages.** No other organisational page of the site's own site map
  truthfully *is* a reserved route: the founder's profile sections are one page, the peace award
  (57642) is a news post, Minhaj-ul-Amal (3421) a self-assessment form, the websites list (1801)
  would replace the Digital resources landing, and the copyright notice (455) is no legal page.
- **Eight authors, and no Work ↔ author link.** The publisher's book grid names books only by slug,
  which cannot be keyed without fetching each book, so no Work is related to a profile.
- **Deferred hosts.** minhajsisters.com, youth.com.pk, msmpakistan.org, research.com.pk,
  equranclass.com, itikaf.com and welfare.org.pk are not registered in R2; the wing sites publish on
  the same `tid` CMS, so any later registration relies on the soft identity above.
  **minhajwelfare.org (UK)** is a separate legal entity and needs its own authorisation before any
  contact (OPEN_DECISIONS.md §3.9).

**Run-wide acts — a person's decision, still item by item** (DOMAIN_MODEL.md §16.9;
SECURITY_BASELINE.md §10.11). A run's review pages offer three acts over its whole candidate set:

- **Approve the run** (`/admin/migration/runs/{id}/approve`) — candidates are pending, valid, free of
  personal data, of a publishable kind and named by no open duplicate pair; the page counts what the
  act leaves and why (invalid, flagged, cleared, review-only, awaiting a duplicate decision).
- **Clear pictures by registered host** (`/admin/migration/runs/{id}/rights`) — only restricted
  acquisitions on a page or asset host the run's source registers, claimed `organisation-owned`
  with stated evidence and having a public copy, under the licence, evidence and holder the person
  states. Unknown rights are never in the set.
- **Draft a manifest of the next 100** approved, publishable revisions no live manifest holds; it is
  then an ordinary manifest, published only by a `migration.publish` holder after the
  `migration-publication` step-up.

Each act is confirmed by the set's **count and SHA-256 fingerprint** (every candidate's
`id:version`, in order, one per line); the service re-reads the set and refuses `conflict` unless
both still match, refuses a run that is not completed and balanced (`run-unreconciled`), confirms
over at most 10,000 candidates and decides at most **150** per act, each through the single
decision's own path, checks and audit, attributed to the person. **Just before each approval it
asks again whether an open duplicate pair now names the record** (`duplicate-open`), because the
fingerprint names versions, not pairs. A refused item is reported with its reason and never forced;
an outage stops the act after what was done. Fatwa and Quran revisions are never in a run-wide set.

**Seeing a picture before clearing it.** `GET /api/admin/migration/assets/{provenanceId}` serves the
metadata-stripped public copy of one acquisition — never the acquired evidence bytes, never an asset
the acquisition does not name, never a PDF — to a live `migration.administer` holder, so the browser
contacts no other host; every refusal is the same empty `404`, `private, no-store`
(SECURITY_BASELINE.md §10.11).

**Editorial's side.** After a manifest publishes, a **second administrator** may approve and publish
a selection from one kind's queue page (at most 25) in one act — each record still approved and
published through the single-record workflow and audited on its own, self-approval still refused
(DOMAIN_MODEL.md §7.2).

**Irfan-ul-Quran feeds the Quran reference preview, not a migration publication.** The two Irfan
sources' revisions stay review-only and are never in a manifest (§14). On staging only,
`quran:reference:translations` (`quran-reference.sh translations`) reads them exactly as staged and
saves each surah through Quran's own administrative service as the layered `reference` translation
beside the Tanzil text — since Quran Part 6 with the revision's translator's notes (below); a surah
whose staged revision fails validation is skipped and reported, never repaired (DOMAIN_MODEL.md
§8.4; OPEN_DECISIONS.md §1.2).

**The Urdu translator's notes (parser version 2, 2026-11-09 — historical; since parser version 3
the notes are read, below).** The first staging run of
`irfan-ul-quran-ur` over all 114 surahs staged 77 and failed 37 at parse
(`translation-structure-unexpected`); `irfan-ul-quran-en` staged all 114. Every surah is one page
(no pagination), and every ayah row carries two `h2.ur`: the translation, and a second that is empty
unless the translation sets the mark "٭" — then it holds the translator's note that mark points to,
opened by the same mark (2:9, 9:101, 24:11 and 24:35, 33:37, 63:5 among the surveyed pages; the
English page keeps the same notes in `p.en`, which it never read). Version 1 refused any non-empty
second heading. Version 2 (`cheerio-irfan-ul-quran-translation`, adapter
`scripts/migration/adapters/irfan-ul-quran.ts`) as first deployed (`878e323`) recognised a later
`h2.ur` as a note only when it opened with "٭" and the row's translation carried at least as many
"٭" marks as the row had notes; the note is commentary and is **not read**, the mark stays in the
ayah's text exactly as written, and anything else in a later heading — or any later non-empty
`h2.en` — still fails the page. The check that the rows are exactly ayat 1…N of the surah, once
each and in order, is unchanged. The English output is unchanged by version 2. A replay of the Urdu
source's retained evidence re-reads all 114 surahs.

**Three more note forms (2026-11-10).** The version-2 replay staged 110 of 114; surahs 39, 42, 47
and 108 still failed. Their pages show three forms the first rule did not know, all still tied to
the translation's own marks (`translatorNotesOnly`):

- **ASCII star.** The translation may mark with "*" instead of "٭", and a note may open with
  either, mixed (39:31 "*" and "*"; 47:19 "*" and "٭"). A star note is admitted while the row has
  no more star notes than star marks of either kind.
- **Numbered.** The translation marks "(1)", "(2)" … and ONE note holds the entries "1:-",
  "2:-" … (42:52). Admitted only when the marks are exactly 1…m in order and the note's entries
  are exactly 1…m in order.
- **Unmarked.** The note opens with no mark (108:1). Admitted only as the row's only note, when
  the translation carries exactly one mark of any form and the row's English note slot `p.en` is
  filled (its text is still never read; every surveyed note row has one).

Every row the first rule admitted is admitted unchanged and the text read is the same, so every
surah it parsed parses byte-identically (checked on 2, 9, 24, 33, 36, 63 and 112); the parser
therefore stayed at **version 2** (as at 2026-11-10, before Quran Part 6) and a replay left the 110
staged surahs unchanged while re-reading the four that had no staged revision. Anything else in a
later heading still failed the page.

**Parser version 3 — the translator's notes are read (Quran Part 6, 2026-11-10).** Versions 1 and 2
recognised the translator's notes only to tell them from anything else, and left them unread. Version
3 (`cheerio-irfan-ul-quran-translation`, `translatorNotes` in
`scripts/migration/adapters/irfan-ul-quran.ts`) reads each note **verbatim into its own place**: the
ayah, the mark it opens with exactly as written (`'٭'`, `'*'`, `'**'`, `'٭:'`, `'1:-'` …, or `''`
when it opens with none) and its words — on the Urdu page from every later `h2.ur` of the row, on
the English page from the row's `p.en` (inside the row's own `a.ayat-div`, one per row on every
page; nothing else is in it). A `<br>` run or a blank source line breaks a note's paragraphs, kept as
one blank line; a paragraph that opens with a mark begins a note, one that opens with none continues
the note before it; one numbered note ("1:- … 2:- …") is split into its entries, each its own note;
ASCII whitespace is collapsed and every other character kept; of markup (an italic, the appendix link
of 4:34) only the words are read, never an address. A mark with no words after it ("* " at 33:6,
40:55, 48:2) is not a note. **The mark stays in the ayah's text exactly where the translation sets
it; no note is ever moved, merged or reworded.** Each note must still be tied to the translation's
own marks in a surveyed form, or the page fails (`translation-structure-unexpected`): a star note
takes, in order, the next star run of the same length ("*" and "**" at 9:29); a numbered entry list
answers exactly "(1)" … "(m)" (Urdu only); a note opened with no mark is the row's only note and
answers the one mark its translation carries (Urdu 108:1 with its English note slot filled, English
53:39); and — the English page only — a star note on a translation that carries **no** star at all is
the ayah's as a whole, because the site drops the English mark (9:101, 24:11, 63:5 and 24 more). A
later `h2.en` that holds anything still fails the page. Survey of all 114 pages (fetched 2026-11-10
with the authorised User-Agent, sequentially, every one HTTP 200): both sources parse all 114 surahs,
**46 Urdu notes** (43 star, 2 numbered entries of 42:52, 1 unmarked) and **134 English notes** (106
tied to a star mark, 27 on the ayah as a whole, 1 unmarked; 9:29 holds two, 24:35 and 55:2 two
paragraphs); every one satisfies Quran's own tie rule (`tieTranslationNotes`, DOMAIN_MODEL.md §8.6),
and every ayah's text is **byte-identical** to version 2's on all 228 records. Marks without a note
(Urdu 93:6–7, English 22:5) stay text.

The staged payload gains `notes` — `{ ayah, marker, text }` in the source's order, each note's ayah
one the payload carries, at most twenty to an ayah — or **`null`** in a revision a parser before
version 3 staged, which says nothing about whether the source has notes. Because the parser version
changed, a `--replay` of each source's retained evidence re-reads and re-stages all 114 records
(the ayat unchanged, the notes added) with nothing fetched. `quran-reference.sh translations` then
saves each surah's texts **with** its notes through the same Quran save, which ties every note to a
mark again and refuses one it cannot (that surah skipped as `notes-untied`, never repaired); a
revision with `notes: null` changes texts only and leaves notes held untouched, and a re-run whose
texts and notes are already held reports the surah unchanged. The summary counts notes written per
language — never their words.

### 19.1 Run plan on staging — PLANNED, not yet run

Every figure below is an **expected** count from the R2 survey of the sources, not a result; the
recorded outcome replaces it when the runs complete. Each run is
`migration-run.sh run --source <key> --operator <adminId> --pages P --limit L [--max-items 500]` on
the staging ingest profile, in the background over several hours. First the five new keys are
registered (`register --source <key> --operator <id> --authorisation-reference
OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS --authorised-on 2026-11-06
--activate`).

| # | Source | Pages / limit | Expected (planned, not a result) |
|---|---|---|---|
| 1 | `minhaj-overseas-countries` | 1 / 39 | +9 countries |
| 2 | `minhajbooks-authors` | 1 / 8 | 8 profiles |
| 3 | `minhaj-org-pages-en` | 1 / 10 (`--items 1797,56402`) | 2 pages |
| 4 | `minhaj-info-magazines` | 1 / 3 | +1 magazine (al-Ulama), published before its issues |
| 5–7 | `minhaj-info-issues-mq` · `-di` · `-ulama` | 1/300 · 1/300 · 1/20 | about 278 (about 242 new) · 259 · 4 issues |
| 8 | `minhajbooks-works` | 30 / 1000 | about 600 works (about 500 new) |
| 9–10 | `minhaj-tv-videos` · `minhaj-tv-videos-ur` | 10/300 · 90/3000 | about 180 + about 2,700, merged by YouTube id |
| 11–17 | press releases en (28/560) → ur (26/520) → articles en (8/320) → ur (19/760) → news en (82/1230) → ur (72/1080) → ar (8/120) | — | about 4,600 records; same-`tid` pairs go to the duplicates queue |
| 18 | `minhaj-org-archive-news-en` | 1 / 519 | 405 new posts |
| 19 | `minhaj-org-collections-en` | 1 / 14 | 11 new Collections, only after their members are public |
| 20 | `thefatwa-rulings` | 5 / 250 | about 226 new, review-only |
| 21 | `irfan-ul-quran-ur` · `-en` | 1 / 114 (`--items 1..114`) | 228 staged (222 new), review-only |

After each run: the run-wide approval, pictures by host, manifests of 100, each manifest published
under step-up, then the second administrator's Editorial queue selections. The contact page (1797)
is expected to be flagged for its organisational contact details and to go through the 30-RD
clearance (§17); its first picture (a "read in Urdu" button) stays restricted.

### 19.2 Review and publication on staging by host command

> **Staging only.** Under OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP (OPEN_DECISIONS.md §4.2;
> SECURITY_BASELINE.md §8.1) the operator may perform, on the proven staging host and as the named
> administrators, the acts of §19 a person otherwise clicks in `/admin/migration` and
> `/admin/editorial`. Production keeps every browser act and confirmation unchanged and never runs
> this.

`docker/staging/bin/migration-review.sh <act> …` runs `staging-migration-review` in the exact-SHA
operations image after root, the staging host proof, the deployed web service's non-indexable
posture and the host lock; the command refuses again unless the process declares exactly staging
and `PUBLIC_INDEXING_ENABLED=false`, runs the whole staging guard, and starts the review tool
(`scripts/review/review-runtime.ts`, root `apps/web/src/composition/staging-review-runner.ts`) as
the **runtime principal**. The tool calls the **same services** the screens call — Migration's
decision, publication and read services and Editorial's batch — so every rule of §19 holds
unchanged: the count-and-fingerprint confirmation, `run-unreconciled`, 10,000 candidates and 150
decisions per act, the open-duplicate question before each approval, manifests of 100, one audit
row per item in the named person's name.

| Act | Who acts | What it does |
|---|---|---|
| `status --operator <id> (--run <runId> \| --source <key>)` | `migration.read` (`content.read` for the queues) | Counts what awaits each act; the run's draft and publishing manifests by id and version |
| `approve-run --run <runId> --operator <id> [--note …]` | `migration.administer` | Preview: the run's counts and the whole set's size and fingerprint. With `--confirm-count N --confirm-fingerprint F`: the run-wide approval over exactly that set |
| `rights --run <runId> --host <host> --operator <id>` | `migration.administer` | Preview per host; with `--licence`, `--evidence`, `--rights-holder` and the confirmation, the pictures-by-host decision |
| `manifest --run <runId> --operator <id>` | `migration.administer` | Preview; with the confirmation, a draft manifest of the next 100 |
| `publish --manifest <id> --operator <id>` | `migration.publish` + live `migration-publication` step-up | Preview: state and version. With `--confirm-version V`: publication by the publisher Identity's gate mints for the session the grant is bound to (`step-up.sh grant --purpose migration-publication` first; the one live session holding it is found when `--session` is not named) |
| `editorial --kind <kind> --approver <secondAdminId>` | `content.review` + `content.publish` | Preview: the first page of that kind's review queue (at most 25), size and fingerprint. With the confirmation: Editorial's approve-and-publish, self-approval refused per record |

**Pictures — the standing rule.** Only hosts of Minhaj-ul-Quran International's own domains
(`minhaj.org`, `minhaj.net`, `minhaj.info`, `minhaj.tv`, `minhajbooks.com`, `minhajoverseas.com`,
`irfan-ul-quran.com`, `thefatwa.com`, or a subdomain) are decided public, and their evidence must
name `OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS`. Any other host stays
restricted unless `--decide-non-first-party-host` repeats that exact host. The licence, evidence and
holder are always explicit arguments; nothing defaults. Migration's service still admits only
restricted acquisitions on a registered host, claimed `organisation-owned` with evidence, with a
public copy.

**Search.** An Editorial publication (and a target's publication) writes its search request in the
same transaction; the web service's own sweep indexes it within about thirty seconds. The host
command runs no second search processor: one built from the operations image's environment would
project every due scope, other domains' included, under a configuration the web does not have (the
reference-preview admission among it).

**One completed run, end to end** (placeholders for identifiers). Each act is run twice: first as
printed (a preview), then with the count and fingerprint — or version — the preview printed. An act
that leaves `remaining` above 0 (150 per act) or a further manifest candidate is previewed and
confirmed again:

```sh
migration-review.sh status      --operator <adminA> --run <runId>
migration-review.sh approve-run --run <runId> --operator <adminA>
migration-review.sh approve-run --run <runId> --operator <adminA> --confirm-count <n> --confirm-fingerprint <f>
# per host `status` lists with candidates:
migration-review.sh rights      --run <runId> --host <host> --operator <adminA>
migration-review.sh rights      --run <runId> --host <host> --operator <adminA> \
  --licence organisation-owned --rights-holder 'Minhaj-ul-Quran International' \
  --evidence '<the page notice>; OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS' \
  --confirm-count <n> --confirm-fingerprint <f>
migration-review.sh manifest    --run <runId> --operator <adminA>
migration-review.sh manifest    --run <runId> --operator <adminA> --confirm-count <n> --confirm-fingerprint <f>
step-up.sh grant --account <adminA> --purpose migration-publication --minutes 15
migration-review.sh publish     --manifest <manifestId> --operator <adminA>
migration-review.sh publish     --manifest <manifestId> --operator <adminA> --confirm-version <v>
# per kind with records in review (the second administrator, never the author):
migration-review.sh editorial   --kind <kind> --approver <adminB>
migration-review.sh editorial   --kind <kind> --approver <adminB> --confirm-count <n> --confirm-fingerprint <f>
```

The administrators sign in once in the ordinary way (the grant binds to a live session). The command
holds the host lock, so it does not run beside an ingest run: issue the step-up after an ingest, not
before it.
