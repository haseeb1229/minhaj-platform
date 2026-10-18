/**
 * THE platform permission vocabulary, as the delivered phases have built it.
 *
 * Permissions are the SOLE enforcement path (SECURITY_BASELINE.md §3.1,
 * DOMAIN_MODEL.md §4.4). There is no role-name check, no profile flag and no
 * capability boolean anywhere that decides authority — a `can(user, key)` over
 * this vocabulary is the only question the platform asks.
 *
 * LAYER 0 AND BROWSER-SAFE. Keys and descriptions, no policy and no reach. The
 * interface needs the keys to label a catalogue page; the enforcement that
 * gives them meaning lives in the authorization service.
 *
 * MIGRATION-SEEDED AND RUNTIME-IMMUTABLE. The catalogue below is the source
 * this repository ships; each phase's migration seeds exactly ITS OWN rows, the
 * runtime principal holds SELECT and nothing else on the table, and a test
 * proves the union of the migrations equals this list. A permission that could
 * be created at runtime would be a permission nobody reviewed.
 *
 * APPENDED ONLY BY AN OWNING PHASE. Phase 2 seeded the Identity and system
 * surfaces' vocabulary; Phase 3B appended Taxonomy's two keys with the
 * migration that delivered those surfaces; Phase 4 appended the one read key
 * its navigation status surface needs; Phase 18 appended Quran's three,
 * `quran.editCanonical` among them; Phase 19 appended Hadith's three,
 * `hadith.editCanonical` among them; Phase 20 appended Fatwa's three,
 * `fatwa.publish` among them; Phase 21 appended the two newsletter keys;
 * Phase 22 appended Learning's two catalogue keys; Phase 23 appended
 * `teaching.perform` and the two class keys; Phase 24 appended Messaging's two
 * externally gated keys; Phase 26 appended Membership's two ordinary keys. `teaching.perform` and the
 * rest are named by DOMAIN_MODEL.md §4.4 as INDICATIVE examples of the shape;
 * they belong to slices that do not exist yet — `teaching.perform` to Phase
 * 23's teacher experience, whose holders OPEN_DECISIONS.md §6.3 reserves to the
 * organisation. Seeding one now would fix another owner's vocabulary before
 * that owner can have an opinion about it, and would leave grantable authority
 * over nothing (DELIVERY_PLAN.md).
 *
 * EXTENDING IT IS USUALLY A PRIVILEGE CHANGE. The protected Platform
 * Administrator bundle below is the whole catalogue EXCEPT the externally gated
 * keys, so appending an ordinary key widens what a live administrator may do.
 * The owning phase's migration therefore performs the same invalidation an
 * ordinary bundle change performs — it revokes the holders' sessions and
 * step-up grants in the transaction that extends the bundle
 * (SECURITY_BASELINE.md §8.1). Appending an externally gated key changes no
 * bundle and so invalidates nobody.
 */

/**
 * The authority required to change what an account is permitted to do.
 *
 * NAMED BY THE SECURITY BASELINE ITSELF (§3.4 rule 6): "`permissions.grant` is
 * required to change permissions, is never self-applicable, requires step-up
 * reauthentication, and is audited." The key is therefore not this
 * implementation's to choose, and it is not renamed for tidiness.
 */
export const PERMISSION_GRANT = 'permissions.grant';

/** One entry of the immutable catalogue. */
export interface PermissionDefinition {
  /** Stable code. The enforcement vocabulary; never a display string. */
  readonly key: string;
  /** Human-readable, for the read-only catalogue surface. */
  readonly description: string;
}

/**
 * The complete catalogue, in phase order, derived from the administrative
 * surfaces ROUTE_MAP.md §7 assigns to each delivered phase and from the
 * privileged operations SECURITY_BASELINE.md §8.1 lists.
 *
 * READ AND ADMINISTER ARE SEPARATE KEYS, deliberately. Seeing that an account
 * is suspended and suspending one are different authorities, and collapsing
 * them would mean every operator who may look must also be able to act
 * (§4, separation of duties).
 */
export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = Object.freeze([
  Object.freeze({
    key: 'users.read',
    description: 'View Identity accounts and their status.',
  }),
  Object.freeze({
    key: 'users.administer',
    description: 'Change an account status: disable, suspend or reactivate.',
  }),
  Object.freeze({
    key: 'roles.read',
    description: 'View roles and the permissions bundled into them.',
  }),
  Object.freeze({
    key: 'roles.administer',
    description: 'Create, rename and deactivate custom roles.',
  }),
  Object.freeze({
    key: 'permissions.read',
    description: 'View the permission catalogue.',
  }),
  Object.freeze({
    key: PERMISSION_GRANT,
    description:
      'Change what a role permits and which accounts hold it. Never self-applicable.',
  }),
  Object.freeze({
    key: 'assignments.read',
    description: 'View role assignments and their grant history.',
  }),
  Object.freeze({
    key: 'security.read',
    description: 'View privileged second-factor posture and bootstrap status.',
  }),
  Object.freeze({ key: 'audit.read', description: 'Read the audit record.' }),
  Object.freeze({
    key: 'integrations.read',
    description: 'View outbound email provider configuration and status.',
  }),
  Object.freeze({
    key: 'delivery.read',
    description: 'View pending, failed and suppressed outbound mail.',
  }),
  Object.freeze({
    key: 'delivery.operate',
    description: 'Reschedule or abandon a stuck outbound delivery.',
  }),

  /* ---- Phase 3B — Taxonomy ------------------------------------------- */
  //
  // APPENDED BY THE OWNING PHASE, which is the rule this catalogue is meant to
  // demonstrate rather than merely state. Phase 2 seeded its own vocabulary and
  // stopped; Taxonomy adds exactly the two keys its administrative surfaces
  // need, at the phase that delivers them, and the Phase-3B migration is what
  // puts them in the database. `quran.*`, `fatwa.*`, `learning.*` and the rest
  // still belong to contexts that do not exist.
  //
  // READ AND ADMINISTER, for the same reason the Identity pairs are split:
  // seeing the canonical subject taxonomy and changing it are different
  // authorities, and an editor who must consult topics should not thereby be
  // able to re-parent them (§4, separation of duties).
  //
  // TWO KEYS, NOT FOUR. Topics, content languages and tags are one
  // administrative concern with one owner, and `taxonomy.topics.administer`
  // beside `taxonomy.tags.administer` would be grantable authority nobody asked
  // to separate. A later phase may split them if a real role needs it.
  Object.freeze({
    key: 'taxonomy.read',
    description: 'View canonical topics, content languages and tags.',
  }),
  Object.freeze({
    key: 'taxonomy.administer',
    description:
      'Create and change canonical topics, their translations, content languages and tags.',
  }),

  /* ---- Phase 4 — Public shell ----------------------------------------- */
  //
  // ONE KEY, AND READ ONLY.
  //
  // ROUTE_MAP.md §7 promises `/{locale}/admin/system/navigation` at Phase 4,
  // and every admin route is gated by a permission key rather than by a role
  // name. No existing key means this: `taxonomy.read` is the canonical subject
  // taxonomy, and stretching it to cover the public shell's navigation status
  // would make one grant confer two unrelated authorities.
  //
  // THERE IS DELIBERATELY NO `navigation.administer`. The surface has no
  // mutation to authorise — the shell route registry is code, reviewed as code,
  // and no accepted contract promises an editing screen. A write key added for
  // symmetry would be grantable authority over nothing, and a permission that
  // authorises nothing is a permission nobody can reason about. It arrives with
  // a mutation contract, if one is ever accepted.
  Object.freeze({
    key: 'navigation.read',
    description: 'View the effective public shell navigation and its availability.',
  }),

  /* ---- Phase 5 — People & Contributors -------------------------------- */
  //
  // READ AND ADMINISTER, for the reason every other pair here is split: seeing
  // the contributor directory and changing it are different authorities, and an
  // operator who must look up an author should not thereby be able to publish a
  // contributor record (§4, separation of duties).
  //
  // TWO KEYS, NOT FIVE. ROUTE_MAP.md §7 gives People five administrative routes
  // — persons, authors, speakers, scholars, teachers — and it would have been
  // easy to mint a key apiece. They are five VIEWS of one administrative
  // concern with one owner, and `people.authors.administer` beside
  // `people.teachers.administer` would be grantable authority nobody asked to
  // separate. A later phase may split them if a real role needs it.
  //
  // WHAT IS DELIBERATELY STILL ABSENT, and is most tempting at exactly this
  // phase: `teaching.perform`, `question.receive`, `content.review` and
  // `fatwa.publish`. Phase 5 consumes the capability projections those four
  // codes feed (DOMAIN_MODEL.md §4.5, `./capabilities.ts`), so seeding one
  // would have made a projection test trivial to write. They belong to
  // Learning, Fatwa and Editorial, which have not shipped, and OPEN_DECISIONS.md
  // §6.3 separately reserves who receives them to the organisation. A Phase-5
  // database correctly projects all four as false.
  Object.freeze({
    key: 'people.read',
    description: 'View contributor records and their profiles.',
  }),
  Object.freeze({
    key: 'people.administer',
    description: 'Create, edit, link and archive contributor records and their profiles.',
  }),
  // PHASE 13 ADDS NO KEY. NewsArticle, PressRelease, Statement and
  // MediaCoverage follow the same editorial workflow with the same separated
  // author, reviewer and publisher authority, so these keys govern them and
  // only the two descriptions that named Article and Page changed (migration
  // 20260928000000). `news.*` beside `content.*` would split one workflow's
  // authority nobody asked to split. PHASE 14 ADDS NO KEY EITHER: Event joins
  // the same workflow, and the same two descriptions now name it (migration
  // 20260930000000). No `event.*` key exists. PHASE 15 LIKEWISE: Collection
  // joins the same workflow and the same two descriptions (migration
  // 20261001000000). No `collection.*` key exists.
  Object.freeze({
    key: 'content.read',
    description:
      'Read private Article, Page, news, press release, statement, media coverage, event and collection drafts and revisions.',
  }),
  Object.freeze({
    key: 'content.author',
    description:
      'Create and revise Article, Page, news, press release, statement, media coverage, event and collection drafts and submit them for review.',
  }),
  Object.freeze({
    key: 'content.review',
    description: 'Approve or return an independently authored editorial revision.',
  }),
  Object.freeze({
    key: 'content.publish',
    description: 'Publish, schedule, cancel and archive reviewed editorial content.',
  }),
  Object.freeze({
    key: 'correspondence.read',
    description: 'Read private ContactInquiry and Feedback submissions.',
  }),
  Object.freeze({
    key: 'correspondence.administer',
    description: 'Triage private correspondence and dispose of expired submissions.',
  }),

  /* ---- Phase 8 — Library ----------------------------------------------- */
  //
  // TWO KEYS, AND NEITHER OF THEM IS `content.*`.
  //
  // It would have been easy to reuse Editorial's vocabulary: both manage
  // published material, and `content.publish` already exists. They are DIFFERENT
  // AUTHORITIES over different aggregates with different owners — a person
  // trusted to publish an Article has not thereby been trusted to change which
  // edition of a book the platform offers for download, and an operator
  // maintaining the book catalogue should not acquire the editorial workflow.
  // One key covering both would be a grant nobody could reason about (§4).
  //
  // TWO, NOT FOUR. Library has no independent review step and no scheduling:
  // ROUTE_MAP.md §7 gives it four administrative routes — works, editions,
  // translations, sale-points — which are four VIEWS of one concern with one
  // owner, and Phase 8 delivers no workflow that separates authoring from
  // publishing. So there is no `library.author`, no `library.review` and no
  // `library.publish`; minting them for symmetry with Editorial would be
  // grantable authority over transitions that do not exist. They arrive with a
  // workflow contract, if one is ever accepted.
  //
  // TWO, NOT ONE PER ENTITY EITHER. `library.works.administer` beside
  // `library.editions.administer` would separate authority nobody asked to
  // separate — an Edition without its Work is not an administrable thing.
  //
  // `library.administer` IS ALSO WHAT AUTHORISES A PRIVATE ASSET PREVIEW, and
  // that is deliberate rather than convenient: previewing a file already attached
  // to an Edition the holder may already edit is the same authority as editing
  // it. The relation is still checked, so the permission never becomes a
  // general-purpose file reader (SECURITY_BASELINE.md §10.1).
  //
  // PHASE 9 ADDED NO KEY. Research, research papers, publications, magazines,
  // their issues and encyclopedias are Library aggregates with the same single
  // owner and no workflow of their own, so these two keys cover them; a
  // `research.*` or `magazine.*` key would be authority nobody asked to separate.
  Object.freeze({
    key: 'library.read',
    description:
      'View Library works, editions, translations, sale points, research, publications, magazines and encyclopedias.',
  }),
  Object.freeze({
    key: 'library.administer',
    description:
      'Create, edit, link and archive Library works, editions, translations, sale points, research, publications, magazines and encyclopedias.',
  }),

  /* ---- Phase 10 — Media: Video, Series, Playlist ----------------------- */
  //
  // READ AND ADMINISTER, split for the reason every pair here is split: seeing
  // the video catalogue and changing what the public Watch surfaces offer are
  // different authorities.
  //
  // TWO KEYS, NOT SIX. `media.videos.administer` beside
  // `media.playlists.administer` would separate authority nobody asked to
  // separate: a Playlist is an ordering of Videos and a Series a grouping of
  // them, with the same single owner and no workflow of their own. There is no
  // `media.publish` because Media has no review step to separate publishing
  // from editing.
  //
  // PHASE 11 ADDS NO KEY. AudioTrack and AudioSeries are Media's, administered
  // by the same operators with the same single owner and no workflow of their
  // own, so these two keys govern them too and only their descriptions changed
  // (migration 20260926000000). `audio.*` and `media.audio.*` would split one
  // owner's authority nobody asked to split.
  //
  // PHASE 12 ADDS NO KEY EITHER. Photographs and galleries are Media's, with the
  // same single owner and no workflow of their own, so these two keys govern
  // them and only their descriptions changed (migration 20260927000000).
  //
  // A SPEAKER PROFILE GRANTS NOTHING. Being named on a Video or an audio track
  // is attribution and confers no Media authority; only a role holding these
  // keys does.
  Object.freeze({
    key: 'media.read',
    description:
      'View Videos, Series, Playlists, audio tracks, audio series, photographs and galleries, including drafts.',
  }),
  Object.freeze({
    key: 'media.administer',
    description:
      'Create, edit, publish and archive Videos, Series, Playlists, audio tracks, audio series, photographs and galleries, order Playlists and galleries, and upload audio files and photographs.',
  }),

  /* ---- Phase 17 — Search foundation ------------------------------------ */
  //
  // TWO KEYS, READ AND OPERATE, for the reason every pair here is split — and
  // exactly the shape `delivery.read` and `delivery.operate` already have for
  // the other derived-work surface. Seeing indexing lag and failures and
  // changing what the indexer does next are different authorities.
  //
  // NEITHER CONFERS AUTHORITY OVER ANY CONTENT. Retrying, rebuilding and
  // reconciling only re-project what the owners ALREADY publish; nothing reached
  // through these keys can publish, withdraw or change a record. That is why no
  // content owner's key is reused for them, and why there is no `search.*` key
  // for anything a visitor does: public search needs no permission at all.
  Object.freeze({
    key: 'search.read',
    description: 'View search indexing lag and failures.',
  }),
  Object.freeze({
    key: 'search.operate',
    description:
      'Retry failed search indexing, and rebuild or reconcile the search index.',
  }),

  /* ---- Phase 16 — Global Network --------------------------------------- */
  //
  // READ AND ADMINISTER, split for the reason every pair here is split: seeing
  // the directory's drafts and archived records and changing what the public
  // directory says are different authorities.
  //
  // TWO KEYS, NOT TWELVE. `country.*`, `region.*`, `city.*` and `centre.*` would
  // separate authority nobody asked to separate: the four levels are one owner's
  // one directory. There is no `global.publish` because Global has no review
  // step, and no contact or import key — contacts belong to their Centre, and no
  // import exists.
  //
  // NEITHER CONFERS EDITORIAL AUTHORITY. Scoping a NewsArticle to a Centre is an
  // Editorial revision under the `content.*` keys; these keys cannot author,
  // review or publish News, and the `content.*` keys cannot change a Centre.
  // Public directory reads need no permission at all.
  Object.freeze({
    key: 'global.read',
    description:
      'View Global Network countries, regions, cities and centres, including drafts and archived records.',
  }),
  Object.freeze({
    key: 'global.administer',
    description:
      'Create, edit, localise, publish and archive Global Network countries, regions, cities and centres, and manage centre contacts and the cities a centre serves.',
  }),

  /* ---- Phase 18 — Quran -------------------------------------------------- */
  //
  // THREE KEYS, AND THE THIRD IS NAMED BY THE ACCEPTED DOCUMENTS THEMSELVES.
  // DOMAIN_MODEL.md §4.4 and §8.2 and SECURITY_BASELINE.md §5.1 and §8.1 name
  // `quran.editCanonical` as the authority over canonical Arabic, so the key is
  // not this implementation's to rename.
  //
  // READ AND ADMINISTER, split for the reason every pair here is split. Seeing
  // canonical history, verification evidence and draft layered works is not
  // changing what the public reader offers.
  //
  // `quran.administer` IS DELIBERATELY NARROW. It governs the LAYERED works —
  // translations, transliterations, tafsir, recitations and their audio,
  // tajweed guidance — plus Surah display names and Ayah topic assignments. It
  // can never reach canonical Arabic or canonical structure: there is no
  // persistence method behind it that writes either, and the application
  // principal holds no INSERT, UPDATE or DELETE on those tables at all.
  // "Separate works with their own permissions" (SECURITY_BASELINE.md §5.1)
  // means isolated from canonical text and from the general CMS — not one key
  // per work; `quran.translations.administer` beside `quran.tafsir.administer`
  // would separate authority nobody asked to separate.
  //
  // `quran.editCanonical` IS NEVER EXERCISED ALONE. Every use also costs a
  // complete second-factor posture and a step-up grant for the dedicated
  // `quran-canonical-edit` purpose, and the database procedure behind it checks
  // that grant again before it writes.
  //
  // NONE OF THE THREE IS RELIGIOUS APPROVAL. Whether a corpus, a translation, a
  // tafsir or a reciter is authoritative is the external authority's decision
  // (OPEN_DECISIONS.md §1.1, §1.2), recorded as a registered source that only
  // the operator can create. No permission here can register one. Neither
  // `content.*`, `library.*` nor `media.*` confers anything over the Quran.
  Object.freeze({
    key: 'quran.read',
    description:
      'View Quran administration: canonical text and history, verification evidence, sources and draft layered works.',
  }),
  Object.freeze({
    key: 'quran.administer',
    description:
      'Manage Quran translations, transliterations, tafsir, recitations and audio, tajweed guidance, Surah display names and Ayah topics. Never canonical text.',
  }),
  Object.freeze({
    key: 'quran.editCanonical',
    description:
      'Accept a verified canonical Quran corpus and correct canonical Ayah text against a registered source, with step-up.',
  }),

  /* ---- Phase 19 — Hadith ------------------------------------------------- */
  //
  // THREE KEYS, THE SAME SHAPE AS QURAN'S AND NEVER SHARED WITH IT.
  // DOMAIN_MODEL.md §4.4 and §9 and SECURITY_BASELINE.md §5.2 and §8.1 name
  // `hadith.editCanonical` as the authority over canonical Hadith, so the key is
  // not this implementation's to rename. No `quran.*` key confers anything over
  // Hadith, and no `hadith.*` key anything over the Quran.
  //
  // `hadith.administer` IS DELIBERATELY NARROW. It governs translations,
  // commentary, sciences study material, display names and record topics. It
  // can never reach a sourced fact — text, source reference, chain, grading,
  // structure, verification or a public citation: no persistence method behind
  // it writes one, and the application principal holds no INSERT, UPDATE or
  // DELETE on those tables at all. One key per table (`hadith.grade`,
  // `hadith.chain`, `hadith.publish`) would separate authority nobody asked to
  // separate: every sourced fact is canonical, and canonical is one authority.
  //
  // `hadith.editCanonical` IS NEVER EXERCISED ALONE. Every use also costs a
  // complete second-factor posture and a step-up grant for the dedicated
  // `hadith-canonical-edit` purpose, and every database procedure behind it
  // checks that grant again before it writes.
  //
  // NONE OF THE THREE IS SCHOLARLY APPROVAL. Which collections, editions,
  // numbering and grading authority are accepted is the external authority's
  // decision (OPEN_DECISIONS.md §1.3), recorded as a registered source system
  // and edition that only the operator can create, and a collection is public
  // only by the operator's activation. No permission here can do either.
  Object.freeze({
    key: 'hadith.read',
    description:
      'View Hadith administration: records and their history, sources and editions, verification, citation mapping, conflict evidence and draft layered records.',
  }),
  Object.freeze({
    key: 'hadith.administer',
    description:
      'Manage Hadith translations, commentary, sciences study material, display names and record topics. Never canonical records, gradings, chains or citations.',
  }),
  Object.freeze({
    key: 'hadith.editCanonical',
    description:
      'Create Hadith structure and source-qualified records, correct their sourced text, chain and gradings, verify them and map public citations, with step-up.',
  }),

  /* ---- Phase 20 — Fatwa -------------------------------------------------- */
  //
  // THREE KEYS, EACH NAMED BY THE ACCEPTED DOCUMENTS THEMSELVES
  // (DOMAIN_MODEL.md §4.4, §4.5; SECURITY_BASELINE.md §3.2, §6, §8.1;
  // OPEN_DECISIONS.md §1.4, §6.3), so none is this implementation's to rename,
  // and there is no fourth. Each is one STAGE of one workflow, and none implies
  // another:
  //
  //   `question.receive` — triage incoming private questions: read the ones
  //                        still in intake, categorise, assign to a current
  //                        `fatwa.answer` holder, decline. Never drafts or
  //                        publishes.
  //   `fatwa.answer`     — draft and revise the ruling and the separately
  //                        written anonymised public question for a question
  //                        assigned to the holder NOW, and submit it for
  //                        review. Never publishes.
  //   `fatwa.publish`    — final scholar review: return a revision, publish it
  //                        or a correction, or withdraw a ruling, each publish
  //                        and withdrawal behind the dedicated
  //                        `fatwa-publication` step-up. It also maintains the
  //                        Fatwa categories, which classify published rulings.
  //                        It confers no general access to private intake: a
  //                        private question is readable to it only while that
  //                        question's ruling is under review.
  //
  // THERE IS NO `fatwa.read`, `fatwa.review` OR `fatwa.administer`. Review IS
  // publication authority, and a separate read key would be private-question
  // access nobody needs. `content.review` and every other content key confer
  // nothing here: a Fatwa is not an editorial record.
  //
  // EXTERNALLY GATED — see `EXTERNALLY_GATED_PERMISSIONS` below. These three
  // are deliberately NOT in the protected Platform Administrator bundle: who
  // may hold them is the organisation's decision (OPEN_DECISIONS.md §1.4,
  // §6.3), and an administrator is not thereby a triage officer, answerer or
  // scholar.
  Object.freeze({
    key: 'question.receive',
    description:
      'Triage incoming private Fatwa questions: read those still in intake, categorise, assign to a current answerer, or decline. Never drafts or publishes.',
  }),
  Object.freeze({
    key: 'fatwa.answer',
    description:
      'Draft and revise the ruling and its separately written anonymised public question for a question currently assigned to you, and submit it for scholar review. Never publishes.',
  }),
  Object.freeze({
    key: 'fatwa.publish',
    description:
      'Review a submitted Fatwa revision, return it, publish it or a correction, or withdraw a ruling, with step-up; and maintain Fatwa categories.',
  }),

  /* ---- Phase 21 — Personalisation & Notifications ------------------------ */
  //
  // THE NEWSLETTER, AND NOTHING ELSE. ROUTE_MAP.md §5.1 places
  // `/admin/communications/newsletter` under Personalisation & Notifications:
  //
  //   `newsletter.read`    — subscription states, consent dates and masked
  //                          addresses, with counts.
  //   `newsletter.operate` — suppress a subscription, or reinstate a suppressed
  //                          one so that it must be confirmed afresh.
  //
  // THERE IS NO `personalisation.read` AND NO `personalisation.administer`.
  // Saved items, notes, history, progress and notifications are their owner's
  // alone; no staff key browses them, and neither of these reaches them
  // (SECURITY_BASELINE.md §19.1). There is no sending or campaign key either:
  // no campaign, segment or broadcast capability exists (DOMAIN_MODEL.md
  // §14.5). Both are ordinary keys, bundled into the protected role.
  Object.freeze({
    key: 'newsletter.read',
    description:
      'View newsletter subscription states, consent dates and masked addresses. Never the saved items, notes, history or notifications of any account.',
  }),
  Object.freeze({
    key: 'newsletter.operate',
    description:
      'Suppress a newsletter subscription, or reinstate a suppressed one so it must be confirmed again. No sending or campaign capability exists.',
  }),

  /* ---- Phase 22 — Learning: courses & paths ------------------------------ */
  //
  // READ AND ADMINISTER, the convention every catalogue context with no review
  // step follows (Library, Media, Global). Seeing draft Courses and how many
  // people are enrolled is not changing what the public catalogue offers.
  //
  // TWO KEYS, NOT ONE PER AGGREGATE. Course, module, lesson and LearningPath are
  // one owner's one catalogue; `learning.publish`, `learning.author` or
  // `learning.review` would separate transitions no Learning workflow has.
  //
  // NEITHER IS TEACHING AUTHORITY, AND NEITHER REACHES A LEARNER. Being named as
  // a Course's teacher is public attribution and grants nothing; teaching is
  // Phase 23's `teaching.perform`, which is not catalogued here. These keys read
  // COUNTS of enrolments and trial requests, never who made them, and no key
  // edits anybody's Progress. Both are ordinary keys, bundled into the
  // protected role by the established revocation convention.
  Object.freeze({
    key: 'learning.read',
    description:
      'View Courses, their modules and lessons, and LearningPaths, including drafts, with counts of enrolments and trial-class requests. Never a learner, their progress or teaching authority.',
  }),
  Object.freeze({
    key: 'learning.administer',
    description:
      'Create, edit, publish and archive Courses, their modules and lessons, and LearningPaths, and order them. Never confirms a trial class, edits a learner progress or grants teaching authority.',
  }),

  /* ---- Phase 23 — Learning: teacher experience & live classes ------------ */
  //
  // THREE KEYS, TWO KINDS. `teaching.perform` is the teacher's authority and
  // is EXTERNALLY GATED (OPEN_DECISIONS.md §6.3): catalogued, grantable
  // through the ordinary audited lifecycle, bundled into NO role and held by
  // nobody until the organisation names a teacher. It opens nothing on its
  // own — a teacher also needs a CURRENT typed Course teaching scope, which an
  // operator makes under `learning.classes.administer`.
  //
  // `learning.classes.read` and `learning.classes.administer` are ordinary
  // operator keys, bundled into the protected role by the usual convention.
  // They are deliberately SEPARATE from Phase 22's catalogue keys: those show
  // counts and never a learner; these reach private booking, class, participant
  // and attendance state, and every identity read under them is audited
  // (SECURITY_BASELINE.md §13.2). Neither grants `teaching.perform`, and no
  // `attendance.*`, `meeting.*`, `booking.*` or `availability.*` key exists.
  Object.freeze({
    key: 'teaching.perform',
    description:
      'Teach live classes on Courses scoped to you: their enrolled learners, your sessions, windows and attendance, and your own scheduled class meeting address. Nothing on other Courses.',
  }),
  Object.freeze({
    key: 'learning.classes.read',
    description:
      'View teaching scopes, trial requests with who asked, bookings, sessions, participants, attendance and a scheduled class meeting address. Identity access is audited. Changes nothing.',
  }),
  Object.freeze({
    key: 'learning.classes.administer',
    description:
      'Scope a current teaching.perform holder to a Course, confirm trial requests, schedule, move, cancel and complete sessions, replace a teacher and correct attendance. Grants no Identity key.',
  }),

  /* ---- Phase 24 — Messaging ---------------------------------------------- */
  //
  // TWO KEYS, BOTH EXTERNALLY GATED (OPEN_DECISIONS.md §6.6): who staffs
  // support and who moderates reported messages is the organisation's
  // decision. Catalogued, grantable through the ordinary audited lifecycle,
  // bundled into NO role and held by nobody. Ordinary messaging needs no key
  // at all: a person reaches a conversation through their CURRENT relationship
  // (DOMAIN_MODEL.md §15.3), never through a permission.
  Object.freeze({
    key: 'messaging.support',
    description:
      'Take part in authenticated support conversations: see the support queue, claim, reply to and resolve a conversation. Every opening of support content is audited.',
  }),
  Object.freeze({
    key: 'messaging.moderate',
    description:
      'Review reported messages and conversations: read the bounded evidence one report authorises, then withhold a message, close a conversation or dismiss. Every evidence read is audited.',
  }),

  /* ---- Phase 26 — Membership ---------------------------------------------- */
  //
  // TWO ORDINARY KEYS, bundled into the protected role by the usual
  // convention, and nothing else: no review, publish, finance or payment key
  // exists, because Membership has no separate review workflow and no payment
  // concept (DOMAIN_MODEL.md §17.2). An applicant needs NO key for their own
  // application or Membership — they reach it through ownership. Neither key
  // reads an applicant's address or profile: an operator sees an account's
  // display name, resolved by Identity at Layer 4, and every read that names
  // an applicant or member is audited.
  Object.freeze({
    key: 'membership.read',
    description:
      'View membership types in every state, the application queue and members, with who applied. Every read that names an applicant or member is audited. Changes nothing.',
  }),
  Object.freeze({
    key: 'membership.administer',
    description:
      'Create, edit, publish and archive membership types, begin review of an application, approve or reject it, and close a Membership. Grants no Identity key.',
  }),
]);

/** Every catalogue key, as a union. Mistyping one is a compile error. */
export type PermissionKey = (typeof PERMISSION_CATALOGUE)[number]['key'];

const PERMISSION_KEYS: ReadonlySet<string> = new Set(
  PERMISSION_CATALOGUE.map((entry) => entry.key),
);

/** Is this string a permission this phase defines? */
export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEYS.has(value);
}

/* ===========================================================================
 * Roles
 * ========================================================================= */

/**
 * THE protected system role, and the only one.
 *
 * SECURITY_BASELINE.md §8.3 names the initial privileged operator; nothing in
 * the accepted documents names a second protected role, and inventing a
 * hierarchy to look complete would create privileged rows nobody asked for.
 * Narrower operator roles are created at runtime as CUSTOM roles, which is
 * what the custom-role lifecycle exists for.
 */
export const PLATFORM_ADMINISTRATOR_ROLE = 'platform-administrator';

/**
 * Keys whose holders the ORGANISATION names, not the platform.
 *
 * OPEN_DECISIONS.md §1.4 and §6.3 reserve to Minhaj which named individuals
 * receive `question.receive`, `fatwa.answer` and `fatwa.publish`, and
 * DELIVERY_PLAN.md Phase 20 issues real grants only to those individuals. A
 * bundle defined as "the whole catalogue" would have made every Platform
 * Administrator an intake reader, answerer and Fatwa publisher the moment the
 * keys were catalogued — before anybody approved anybody.
 *
 * So these keys are catalogued and grantable through the ordinary audited role
 * and assignment lifecycle (`permissions.grant`, step-up, never
 * self-applicable), and are NOT bundled into the protected role. The
 * administrator keeps the authority to grant them once the organisation names a
 * holder; it does not hold them. There is no boolean beside the permission and
 * no second authorisation system: a holder is exactly an account with a live
 * assignment of a role carrying the key.
 */
export const EXTERNALLY_GATED_PERMISSIONS = Object.freeze([
  'question.receive',
  'fatwa.answer',
  'fatwa.publish',
  // Phase 23: who teaches is the organisation's decision (OPEN_DECISIONS.md
  // §6.3, with §2.1 safeguarding open). Catalogued, bundled into no role.
  'teaching.perform',
  // Phase 24: who staffs support and who moderates is the organisation's
  // decision (OPEN_DECISIONS.md §6.6). Catalogued, bundled into no role.
  'messaging.support',
  'messaging.moderate',
] as const satisfies readonly PermissionKey[]);

const EXTERNALLY_GATED: ReadonlySet<string> = new Set(EXTERNALLY_GATED_PERMISSIONS);

/** Is this a key whose holders only the organisation may name? */
export function isExternallyGatedPermission(key: string): boolean {
  return EXTERNALLY_GATED.has(key);
}

/**
 * The protected bundle: every catalogued key except the externally gated ones.
 *
 * Migration-controlled foundation data rather than an ordinary editable row:
 * the role has to exist before the one-time bootstrap can assign it, and a
 * runtime path that could re-bundle or deactivate it would be a path to
 * removing the platform's only administrator (SECURITY_BASELINE.md §8).
 */
export const PLATFORM_ADMINISTRATOR_PERMISSIONS: readonly PermissionKey[] = Object.freeze(
  PERMISSION_CATALOGUE.map((entry) => entry.key).filter(
    (key) => !isExternallyGatedPermission(key),
  ),
);

/* ===========================================================================
 * Step-up
 * ========================================================================= */

/**
 * What a step-up grant authorises.
 *
 * SCOPED, because a universal elevation token is exactly what
 * SECURITY_BASELINE.md §8 forbids: re-proving a credential to change one's own
 * second factor must not silently also authorise granting somebody else the
 * administrator role.
 *
 * Phase 2 closed the vocabulary at three classes, matching the three kinds of
 * consequence it had, so that no scope could be invented for an operation that
 * matched none of them.
 *
 * PHASE 18 ADDS THE FOURTH, AND ONLY FOR THE OPERATION THE BASELINE NAMES.
 * SECURITY_BASELINE.md §8.1 lists canonical Quran edits as their own step-up
 * operation under `quran.editCanonical`. Reusing `privilege-administration`
 * would let a grant earned to change a role bundle also authorise rewriting
 * scripture, which is exactly the universal elevation this vocabulary exists to
 * refuse; so the canonical Quran authority has its own purpose, and no other
 * purpose authorises it.
 *
 * PHASE 19 ADDS THE FIFTH FOR THE SAME REASON. §8.1 lists canonical Hadith
 * edits as their own operation under `hadith.editCanonical`; a grant earned to
 * correct an Ayah must not also authorise rewriting a Hadith's grading, nor the
 * reverse, so canonical Hadith authority has its own purpose too.
 *
 * PHASE 20 ADDS THE SIXTH. §8.1 lists Fatwa publication as its own operation
 * under `fatwa.publish` — the highest-consequence act on the platform — so no
 * grant earned for privilege administration or canonical text authorises it,
 * and a `fatwa-publication` grant authorises nothing else.
 */
export const STEP_UP_PURPOSES = Object.freeze([
  /** Role lifecycle, permission bundles, assignment grant and revoke. */
  'privilege-administration',
  /** Account status administration performed on somebody else's account. */
  'account-administration',
  /** Second-factor and recovery-code administration of one's own account. */
  'second-factor',
  /** Canonical Quran corpus acceptance and Ayah correction (Phase 18). */
  'quran-canonical-edit',
  /** Canonical Hadith structure, records, verification and citations (Phase 19). */
  'hadith-canonical-edit',
  /** Fatwa publication, correction publication and withdrawal (Phase 20). */
  'fatwa-publication',
] as const);

export type StepUpPurpose = (typeof STEP_UP_PURPOSES)[number];

/**
 * How long a step-up grant lives.
 *
 * Short on purpose. It is "this person proved themselves a moment ago", not a
 * session: an elevation that outlived the operation would be a second, weaker
 * session sitting beside the real one.
 */
export const STEP_UP_LIFETIME_SECONDS = 300;
