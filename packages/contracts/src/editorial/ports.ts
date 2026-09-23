import type {
  ArticleDetail,
  PublicEditorialSummary,
  EditorialScheduleCandidate,
  PageDetail,
  EditorialDirectory,
  RevisionDirectory,
  SafeEditorialContent,
  WorkflowCommand,
  PublicEditorial,
  PublicPage,
  EditorialSitemapEntry,
  EditorialState,
  ContactInquiryView,
  FeedbackView,
  ContactDirectory,
  FeedbackDirectory,
  CorrespondenceState,
} from './values.ts';

export interface EditorialActor {
  readonly accountId: string;
}
export interface EditorialWrite {
  readonly actorId: string;
  readonly content: SafeEditorialContent;
}
export interface EditorialEdit extends EditorialWrite {
  readonly id: string;
  readonly expectedVersion: number;
}
export interface EditorialTransition extends WorkflowCommand {
  readonly actorId: string;
  readonly now: Date;
  readonly scheduledExecution: boolean;
}
export interface EditorialQuery {
  readonly offset: number;
  readonly limit: number;
  readonly state: EditorialState | null;
}
export interface EditorialPublicReaderPort {
  articleCanonicalSlug(slug: string): Promise<string | null>;
  pageCanonicalSlug(routeBinding: string, slug: string): Promise<string | null>;
  publishedHelpPages(
    offset: number,
    limit: number,
  ): Promise<readonly PublicEditorialSummary[]>;
  publicArticle(slug: string): Promise<PublicEditorial | null>;
  publicPage(routeBinding: string, slug: string): Promise<PublicPage | null>;
  publishedArticles(
    offset: number,
    limit: number,
  ): Promise<readonly PublicEditorialSummary[]>;
  articleSitemap(
    offset: number,
    limit: number,
  ): Promise<readonly EditorialSitemapEntry[]>;
  pageSitemap(offset: number, limit: number): Promise<readonly EditorialSitemapEntry[]>;

  /**
   * Search projection reads (DELIVERY_PLAN.md Phase 17 — "Article and
   * published Page records").
   *
   * PUBLISHED ONLY, AND THE PREDICATE IS IN THE QUERY, exactly as it is for the
   * public article and page routes. A draft, in-review, approved, scheduled or
   * archived record is `null` — including one that WAS published and has since
   * been revised back to draft.
   */
  searchArticle(id: string): Promise<EditorialSearchRecord | null>;
  searchPage(id: string): Promise<EditorialSearchRecord | null>;
  searchArticles(input: {
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly id: string; readonly stamp: string }[]>;
  searchPages(input: {
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly id: string; readonly stamp: string }[]>;

  /**
   * The CURRENT public address data of whichever ids are published right now.
   * Bounded; one call per result page, never one per result.
   */
  publishedArticleTargets(
    ids: readonly string[],
  ): Promise<readonly { readonly id: string; readonly slug: string }[]>;
  publishedPageTargets(ids: readonly string[]): Promise<
    readonly {
      readonly id: string;
      readonly routeBinding: string;
      readonly slug: string;
    }[]
  >;
}

/** What Search may know about one published Article or Page. */
export interface EditorialSearchRecord {
  readonly id: string;
  /** The record's `version`, which every editorial mutation moves. */
  readonly stamp: string;
  readonly publishedAt: Date;
  readonly topicIds: readonly string[];
  readonly translations: readonly {
    readonly languageCode: string;
    readonly title: string;
    readonly excerpt: string;
    /** The stored, already-validated editor document. */
    readonly document: string;
  }[];
}
export interface EditorialPersistencePort {
  article(id: string): Promise<ArticleDetail | null>;
  page(id: string): Promise<PageDetail | null>;
  articles(query: EditorialQuery): Promise<EditorialDirectory>;
  pages(query: EditorialQuery): Promise<EditorialDirectory>;
  articleRevisions(id: string, offset: number): Promise<RevisionDirectory>;
  pageRevisions(id: string, offset: number): Promise<RevisionDirectory>;
  createArticle(input: EditorialWrite): Promise<ArticleDetail>;
  createPage(
    input: EditorialWrite & { readonly routeBinding: string },
  ): Promise<PageDetail>;
  reviseArticle(input: EditorialEdit): Promise<ArticleDetail>;
  revisePage(input: EditorialEdit): Promise<PageDetail>;
  transitionArticle(input: EditorialTransition): Promise<ArticleDetail>;
  transitionPage(input: EditorialTransition): Promise<PageDetail>;
  dueArticles(now: Date, limit: number): Promise<readonly EditorialScheduleCandidate[]>;
  duePages(now: Date, limit: number): Promise<readonly EditorialScheduleCandidate[]>;
  failArticleSchedule(
    id: string,
    expectedVersion: number,
    reason: 'authority-revoked' | 'execution-failed',
  ): Promise<void>;
  failPageSchedule(
    id: string,
    expectedVersion: number,
    reason: 'authority-revoked' | 'execution-failed',
  ): Promise<void>;
}
export interface EditorialAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
}
export interface EditorialReferencesPort {
  validTopics(ids: readonly string[]): Promise<boolean>;
  validContributors(ids: readonly string[]): Promise<boolean>;
  validLanguages(codes: readonly string[]): Promise<boolean>;
}
export interface CorrespondencePersistencePort {
  submitContact(input: {
    readonly name: string;
    readonly email: string;
    readonly subject: string;
    readonly body: string;
    readonly retainUntil: Date;
  }): Promise<void>;
  submitFeedback(input: {
    readonly category: string;
    readonly body: string;
    readonly retainUntil: Date;
  }): Promise<void>;
  contacts(offset: number, state: CorrespondenceState | null): Promise<ContactDirectory>;
  feedback(offset: number, state: CorrespondenceState | null): Promise<FeedbackDirectory>;
  triageContact(input: {
    readonly id: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly state: CorrespondenceState;
    readonly note: string;
  }): Promise<ContactInquiryView>;
  triageFeedback(input: {
    readonly id: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly state: CorrespondenceState;
    readonly note: string;
  }): Promise<FeedbackView>;
  purgeExpired(now: Date, limit: number): Promise<number>;
}
