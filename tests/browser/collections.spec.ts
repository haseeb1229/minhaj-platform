import { randomUUID } from 'node:crypto';

import type { BrowserContext, Locator, Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  accountIdFor,
  baseUrl,
  expect,
  grantRole,
  privilegedSession,
  registerAndSignIn,
  test,
} from './support';

/**
 * Phase 15 — Editorial Collections in a real browser, against the production
 * build.
 *
 * WHAT ONLY A BROWSER CAN SHOW, beyond what the contract, SQL and composition
 * proofs already establish: the Collection editor gathers public records of
 * four different owners through its member controls, narrowed by the reference
 * search, and keeps an unsaved list across that search; the order is arranged
 * from the KEYBOARD, with focus kept on the moved item and the move announced
 * politely; three separate hands submit, approve and publish, refusing
 * self-approval and a read-only or unrelated account at the action as well as
 * in the markup; a membership edit after approval returns the Collection to
 * draft; the public listing and page show the members in the saved order,
 * typed and linked to their OWNERS' canonical addresses, for an anonymous
 * visitor with no cookie and the same body signed in; a former slug is one
 * 301; a withdrawn member disappears — title and address alike — while the
 * rest keep their order, and an all-withdrawn Collection says so honestly;
 * archiving the Collection touches no member; and Urdu and Arabic render
 * right-to-left at 320 pixels and at 200% zoom with no horizontal scroll.
 *
 * EVERYTHING IS SYNTHETIC. Titles say they are fixtures, every address is
 * `.invalid`, and the member records are written here the way their owners'
 * own fixtures write them.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;
const contexts: BrowserContext[] = [];
let author: Page, reviewer: Page, publisher: Page, reader: Page, outsider: Page;
let authorId = '';
let reviewerId = '';

const run = randomUUID().replaceAll('-', '').slice(0, 8);

/** The member records, one per owner family, each public when seeded. */
const id = {
  article: randomUUID(),
  news: randomUUID(),
  work: randomUUID(),
  edition: randomUUID(),
  video: randomUUID(),
};
const SHELF = `${run}-shelf`;
const MEMBER = {
  article: {
    kind: 'article',
    title: `Synthetic collection article fixture ${run}`,
    slug: `browser-collection-article-${run}`,
    editorType: 'Article',
    publicType: 'Article',
  },
  news: {
    kind: 'news-article',
    title: `Synthetic collection news fixture ${run}`,
    slug: `browser-collection-news-${run}`,
    editorType: 'News article',
    publicType: 'News',
  },
  // The narrower search below finds only these two, by the `-shelf` suffix.
  work: {
    kind: 'work',
    title: `Synthetic collection book fixture ${SHELF}`,
    slug: `browser-collection-book-${run}`,
    editorType: 'Book',
    publicType: 'Book',
  },
  video: {
    kind: 'video',
    title: `Synthetic collection video fixture ${SHELF}`,
    slug: `browser-collection-video-${run}`,
    editorType: 'Video',
    publicType: 'Video',
  },
} as const;
type MemberName = keyof typeof MEMBER;

const tokenOf = (name: MemberName) =>
  `${MEMBER[name].kind}:${name === 'news' ? id.news : id[name]}`;

/** The owner's canonical address for each member, as the page must link it. */
const OWNER_PATH: Record<MemberName, string> = {
  article: `/library/articles/${MEMBER.article.slug}`,
  news: `/news/${MEMBER.news.slug}`,
  work: `/library/books/${MEMBER.work.slug}`,
  video: `/watch/videos/${MEMBER.video.slug}`,
};

/** The Collection's slugs — the renaming test moves the current one on. */
const slug = {
  main: `browser-collection-${run}`,
  renamed: `browser-collection-${run}-renamed`,
};
const TITLE = {
  en: `Synthetic browser collection fixture ${run}`,
  ur: `آزمائشی مجموعہ ${run}`,
};

/** The order the author arranges from the keyboard, then extends after approval. */
const SAVED_ORDER: readonly MemberName[] = ['work', 'news', 'article'];
const FINAL_ORDER: readonly MemberName[] = ['work', 'news', 'article', 'video'];

let mainEditor = '';

/* ========================================================================== */

/** Presses a workflow button and waits for the version it produces. */
async function clickSaved(page: Page, name: string) {
  const next =
    Number(await page.locator('input[name="version"]').first().inputValue()) + 1;
  await page.getByRole('button', { name, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `Version ${String(next)}` }),
  ).toBeVisible();
}

/** Submit, approve by another person, publish by a third. */
async function throughWorkflow(editor: string) {
  await author.goto(editor);
  await clickSaved(author, 'Submit for review');
  await reviewer.goto(editor);
  await clickSaved(reviewer, 'Approve revision');
  await publisher.goto(editor);
  await clickSaved(publisher, 'Publish');
}

async function collectionRow(collectionId: string) {
  const [row] = await sql.query<{
    state: string;
    version: number;
    currentRevision: number;
    approvedRevision: number | null;
  }>(
    `SELECT [state],[version],[currentRevision],[approvedRevision] FROM [dbo].[Collection] WHERE [id]=N'${collectionId}';`,
  );
  if (row === undefined) throw new Error(`No Collection ${collectionId}`);
  return {
    ...row,
    version: Number(row.version),
    currentRevision: Number(row.currentRevision),
  };
}

/** The current revision's members as stored: `kind:id`, by position. */
async function storedOrder(collectionId: string): Promise<string[]> {
  const rows = await sql.query<{ member: string }>(
    `SELECT CASE
       WHEN i.[articleId] IS NOT NULL THEN N'article:' + i.[articleId]
       WHEN i.[newsArticleId] IS NOT NULL THEN N'news-article:' + i.[newsArticleId]
       WHEN i.[workId] IS NOT NULL THEN N'work:' + i.[workId]
       WHEN i.[videoId] IS NOT NULL THEN N'video:' + i.[videoId]
       ELSE N'other' END AS [member]
     FROM [dbo].[CollectionItem] i
     JOIN [dbo].[Collection] c ON c.[id]=i.[ownerId] AND c.[currentRevision]=i.[revisionNumber]
     WHERE i.[ownerId]=N'${collectionId}'
     ORDER BY i.[position];`,
  );
  return rows.map((row) => row.member);
}

/** Every member record's state and version — what archiving must not touch. */
async function targetStates(): Promise<string> {
  const rows = await sql.query(
    `SELECT N'article' AS [kind],[state],[version] FROM [dbo].[Article] WHERE [id]=N'${id.article}'
     UNION ALL SELECT N'news',[state],[version] FROM [dbo].[NewsArticle] WHERE [id]=N'${id.news}'
     UNION ALL SELECT N'work',[state],[version] FROM [dbo].[Work] WHERE [id]=N'${id.work}'
     UNION ALL SELECT N'edition',[state],[version] FROM [dbo].[Edition] WHERE [id]=N'${id.edition}'
     UNION ALL SELECT N'video',[state],[version] FROM [dbo].[Video] WHERE [id]=N'${id.video}'
     ORDER BY [kind];`,
  );
  if (rows.length !== 5) throw new Error('A member record is missing.');
  return JSON.stringify(rows);
}

const collectionIdOf = (editor: string) => editor.split('/').pop() ?? '';

/** The editor's member section — a fieldset named by its legend. */
const membersOf = (page: Page): Locator =>
  page.getByRole('group', { name: 'Items in this collection', exact: true });

/** The editor's member list, in its current order, each with its type and title. */
async function expectEditorOrder(page: Page, order: readonly MemberName[]) {
  const items = membersOf(page).locator('ol > li');
  await expect(items).toHaveCount(order.length);
  for (const [index, name] of order.entries()) {
    const item = items.nth(index);
    await expect(item).toContainText(`${String(index + 1)}.`);
    await expect(item).toContainText(MEMBER[name].editorType);
    await expect(item).toContainText(MEMBER[name].title);
  }
}

/** Chooses one public record in the member controls and adds it. */
async function addMember(page: Page, name: MemberName, position: number) {
  const members = membersOf(page);
  await members.locator('#member-add-type').selectOption(MEMBER[name].kind);
  await members.locator('#member-add-target').selectOption({ label: MEMBER[name].title });
  await members.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(members.getByRole('status')).toHaveText(
    `Added ${MEMBER[name].title} at position ${String(position)} of ${String(position)}.`,
  );
}

/** The public page's members, in order: type, title and owner link. */
async function expectPublicOrder(page: Page, order: readonly MemberName[]) {
  const section = page.locator('section[aria-labelledby="collection-items"]');
  const items = section.locator('ol > li');
  await expect(items).toHaveCount(order.length);
  for (const [index, name] of order.entries()) {
    const item = items.nth(index);
    await expect(item).toContainText(MEMBER[name].publicType);
    await expect(item.getByRole('link', { name: MEMBER[name].title })).toHaveAttribute(
      'href',
      `/en${OWNER_PATH[name]}`,
    );
  }
}

/* ---------------------------------------------------------------------------
 * A Server Action, replayed by another account — exactly as the Event proof
 * does: a real submission is captured as the browser sends it and posted again
 * from a different signed-in context, with chosen fields rewritten.
 * ------------------------------------------------------------------------- */

interface CapturedAction {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

async function captureAction(page: Page, trigger: () => Promise<void>) {
  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.headers()['next-action'] !== undefined,
  );
  await trigger();
  const request = await sent;
  const all = await request.allHeaders();
  const headers: Record<string, string> = {};
  for (const name of [
    'next-action',
    'next-router-state-tree',
    'content-type',
    'accept',
    'origin',
  ])
    if (all[name] !== undefined) headers[name] = all[name];
  return {
    url: request.url(),
    headers,
    body: request.postDataBuffer()?.toString('utf8') ?? '',
  } satisfies CapturedAction;
}

async function replayAction(
  page: Page,
  captured: CapturedAction,
  fields: Record<string, string>,
): Promise<string> {
  let body = captured.body;
  for (const [name, value] of Object.entries(fields)) {
    // React prefixes a bound form's fields with its argument slot (`_1_`).
    const pattern = new RegExp(`(name="(?:_?\\d+_)?${name}"\\r\\n\\r\\n)[^\\r]*`);
    expect(pattern.test(body), `the captured action carries ${name}`).toBe(true);
    body = body.replace(pattern, `$1${value}`);
  }
  const response = await page.request.post(captured.url, {
    headers: captured.headers,
    data: Buffer.from(body, 'utf8'),
    maxRedirects: 0,
  });
  return response.text();
}

/**
 * How far the page scrolls sideways, and — when it does — the innermost
 * elements reaching past the edge, so a failure names its cause.
 */
async function overflowOf(
  page: Page,
): Promise<{ overflow: number; offenders: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;
    if (overflow <= 0) return { overflow, offenders: [] };
    const beyond = [...document.body.querySelectorAll('*')].filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.right > root.clientWidth + 1 || box.left < -1);
    });
    const innermost = beyond.filter(
      (element) => !beyond.some((other) => other !== element && element.contains(other)),
    );
    return {
      overflow,
      offenders: innermost.slice(0, 5).map((element) => {
        const box = element.getBoundingClientRect();
        return `<${element.tagName.toLowerCase()}> ${String(Math.round(box.width))}px: ${(element.textContent ?? '').trim().slice(0, 60)}`;
      }),
    };
  });
}

/** One Editorial record (Article or NewsArticle) published by two hands. */
function publishedEditorial(table: 'Article' | 'NewsArticle', recordId: string) {
  const member = table === 'Article' ? MEMBER.article : MEMBER.news;
  const document = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Synthetic non-authoritative member body.' }],
      },
    ],
  });
  return `
    INSERT INTO [dbo].[${table}] ([id],[slug],[state],[version],[creatorId],[updatedAt])
      VALUES (N'${recordId}', N'${member.slug}', N'draft', 1, N'${authorId}', SYSUTCDATETIME());
    INSERT INTO [dbo].[${table}SlugHistory] ([ownerId],[slug]) VALUES (N'${recordId}', N'${member.slug}');
    INSERT INTO [dbo].[${table}Revision] ([ownerId],[number],[editorId],[slug],[primaryLanguage])
      VALUES (N'${recordId}', 1, N'${authorId}', N'${member.slug}', N'en');
    INSERT INTO [dbo].[${table}RevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html])
      VALUES (N'${recordId}', 1, N'en', N'${member.title}', N'Synthetic fixture', N'', N'', N'${document}', N'<p>Synthetic non-authoritative member body.</p>');
    UPDATE [dbo].[${table}] SET [currentRevision]=1 WHERE [id]=N'${recordId}';
    UPDATE [dbo].[${table}] SET [approvedRevision]=1, [approvedById]=N'${reviewerId}', [state]=N'published', [publishedAt]=SYSUTCDATETIME(), [version]=2 WHERE [id]=N'${recordId}';
  `;
}

/* ========================================================================== */

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  sql = await privilegedSession();

  const roles: readonly (readonly string[])[] = [
    // The author ALSO holds review, so the self-approval refusal is the
    // workflow's rule and not merely a missing permission.
    ['content.read', 'content.author', 'content.review'],
    ['content.read', 'content.review'],
    ['content.read', 'content.publish'],
    ['content.read'],
    ['global.read', 'global.administer', 'media.read', 'media.administer'],
  ];
  const pages: Page[] = [];
  const accounts: string[] = [];
  for (const [index, keys] of roles.entries()) {
    const context = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': `100.64.246.${String(index + 1)}` },
    });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    const { email } = await registerAndSignIn(page, `collections-${String(index)}`);
    const accountId = await accountIdFor(sql, email);
    accounts.push(accountId);
    await grantRole(sql, accountId, keys, 'Collections browser proof');
  }
  [author, reviewer, publisher, reader, outsider] = pages as [
    Page,
    Page,
    Page,
    Page,
    Page,
  ];
  [authorId, reviewerId] = accounts as [string, string];

  // Four public members from three owners — Editorial (an Article and a
  // NewsArticle, each approved by someone other than its editor), Library (a
  // Work with a published Edition) and Media (a published Video).
  await sql.query(`
    ${publishedEditorial('Article', id.article)}
    ${publishedEditorial('NewsArticle', id.news)}
    INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured],[version],[updatedAt])
      VALUES (N'${id.work}', N'${MEMBER.work.slug}', N'en', N'published', 0, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description])
      VALUES (N'${id.work}', N'en', N'${MEMBER.work.title}', N'Non-authoritative fixture.');
    INSERT INTO [dbo].[Edition] ([id],[workId],[languageCode],[label],[state],[publicationYear],[reading],[download],[version],[updatedAt])
      VALUES (N'${id.edition}', N'${id.work}', N'en', N'Synthetic edition', N'published', 2021, N'unavailable', N'denied', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[format],[languageCode],[durationSeconds],[publishedOn],[captions],[transcript],[seriesId],[seriesPosition],[version],[updatedAt])
      VALUES (N'${id.video}', N'${MEMBER.video.slug}', N'en', N'published', 0, N'youtube', 'Cx${run}x', N'available', N'lecture', N'en', 600, '2031-01-02', 0, NULL, NULL, NULL, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description])
      VALUES (N'${id.video}', N'en', N'${MEMBER.video.title}', N'A synthetic description.');
  `);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ========================================================================== */

test.describe('authoring a Collection', () => {
  /** A real save, made by the author, which the other accounts replay. */
  let capturedSave: CapturedAction | null = null;

  test('gathers members, keeps an unsaved list across a search, and orders them from the keyboard', async () => {
    test.setTimeout(180_000);
    const members = membersOf(author);
    const status = members.getByRole('status');

    // Every public member type is offered, narrowed by the search.
    await author.goto(`/en/admin/editorial/collections/new?referenceQuery=${run}`);
    await expect(members.getByText(/^No items yet\./)).toBeVisible();
    await addMember(author, 'article', 1);
    await addMember(author, 'news', 2);
    await expect(members.getByText('Item changes are not saved yet.')).toBeVisible();

    // A narrower search reloads the editor — and the unsaved list comes back.
    await author
      .getByLabel('Contributor name or item title', { exact: true })
      .fill(SHELF);
    await author
      .getByRole('button', { name: 'Find contributors and items', exact: true })
      .click();
    await author.waitForURL(/referenceQuery=/);
    const query = new URL(author.url()).searchParams;
    expect(query.get('referenceQuery')).toBe(SHELF);
    expect(query.get('pendingVersion')).toBe('0');
    expect(query.getAll('pending')).toEqual([tokenOf('article'), tokenOf('news')]);
    await expectEditorOrder(author, ['article', 'news']);
    await expect(members.getByText('Item changes are not saved yet.')).toBeVisible();
    // The narrower search offers no Article any more, and the Book still.
    await members.locator('#member-add-type').selectOption('article');
    await expect(members.locator('#member-add-target option')).toHaveText([
      'No public items of this type match the search',
    ]);
    await addMember(author, 'work', 3);
    await expectEditorOrder(author, ['article', 'news', 'work']);

    // KEYBOARD ORDERING. Enter on "Move up" moves the Book to position two
    // and focus stays on the Book's own control, now renamed for its place.
    const moveUp = (name: MemberName, position: number) =>
      members.getByRole('button', {
        name: `Move up: ${MEMBER[name].title}, position ${String(position)} of 3`,
        exact: true,
      });
    const moveDown = (name: MemberName, position: number) =>
      members.getByRole('button', {
        name: `Move down: ${MEMBER[name].title}, position ${String(position)} of 3`,
        exact: true,
      });
    await moveUp('work', 3).focus();
    await author.keyboard.press('Enter');
    await expect(status).toHaveText(`Moved ${MEMBER.work.title} to position 2 of 3.`);
    await expect(moveUp('work', 2)).toBeFocused();
    await expectEditorOrder(author, ['article', 'work', 'news']);

    // Space moves it again, to the top: "Move up" is disabled there, so focus
    // moves to the same item's "Move down".
    await author.keyboard.press('Space');
    await expect(status).toHaveText(`Moved ${MEMBER.work.title} to position 1 of 3.`);
    await expect(moveUp('work', 1)).toBeDisabled();
    await expect(moveDown('work', 1)).toBeFocused();
    await expectEditorOrder(author, ['work', 'article', 'news']);

    // Moving the Article down to the end keeps focus on its "Move up".
    await moveDown('article', 2).focus();
    await author.keyboard.press('Enter');
    await expect(status).toHaveText(`Moved ${MEMBER.article.title} to position 3 of 3.`);
    await expect(moveDown('article', 3)).toBeDisabled();
    await expect(moveUp('article', 3)).toBeFocused();
    await expectEditorOrder(author, SAVED_ORDER);

    // The text fields, then the save: what was arranged is what is stored.
    await author.getByLabel('Canonical slug', { exact: true }).fill(slug.main);
    await author.locator('#en-title').fill(TITLE.en);
    await author
      .getByRole('textbox', { name: 'Body (en)', exact: true })
      .fill('Synthetic non-authoritative collection introduction.');
    await author.getByText('Content language: ur', { exact: true }).click();
    await author.locator('input[name="ur-enabled"]').check();
    await author.locator('#ur-title').fill(TITLE.ur);
    await author
      .getByRole('textbox', { name: 'Body (ur)', exact: true })
      .fill('آزمائشی غیر مستند تعارف۔');
    await author.getByRole('button', { name: 'Save revision', exact: true }).click();
    await author.waitForURL(/\/en\/admin\/editorial\/collections\/[0-9a-f-]{36}$/);
    mainEditor = new URL(author.url()).pathname;
    await expectEditorOrder(author, SAVED_ORDER);
    await expect(members.getByText('Item changes are not saved yet.')).toHaveCount(0);
    expect(await storedOrder(collectionIdOf(mainEditor))).toEqual(
      SAVED_ORDER.map(tokenOf),
    );
  });

  test('submits, refuses self-approval, approves by another hand, and returns to draft on a membership edit', async () => {
    test.setTimeout(240_000);
    const collectionId = collectionIdOf(mainEditor);

    // The author submits; approval of their own work is not offered...
    await author.goto(mainEditor);
    const submitted = await captureAction(author, () =>
      clickSaved(author, 'Submit for review'),
    );
    await expect(
      author.getByRole('button', { name: 'Approve revision', exact: true }),
    ).toHaveCount(0);
    // ...and refused at the action when it is posted anyway.
    const before = await collectionRow(collectionId);
    expect(before.state).toBe('in-review');
    const selfApproval = await replayAction(author, submitted, {
      action: 'approve',
      version: String(before.version),
    });
    expect(selfApproval).toContain('"failure":"self-approval"');
    expect(await collectionRow(collectionId)).toEqual(before);

    // An independent reviewer approves; the reviewer cannot publish.
    await reviewer.goto(mainEditor);
    await clickSaved(reviewer, 'Approve revision');
    await expect(
      reviewer.getByRole('button', { name: 'Publish', exact: true }),
    ).toHaveCount(0);
    expect((await collectionRow(collectionId)).approvedRevision).not.toBeNull();

    // Adding a member after approval is an ordinary edit: it returns the
    // Collection to draft, clears the approval, and publication is withdrawn.
    await author.goto(`${mainEditor}?referenceQuery=${run}`);
    await expectEditorOrder(author, SAVED_ORDER);
    await addMember(author, 'video', 4);
    const saved = await captureAction(author, () => clickSaved(author, 'Save revision'));
    expect(saved.body).toContain(tokenOf('video'));
    await expect(
      author.getByRole('status').filter({ hasText: /^Draft · Version \d+$/ }),
    ).toBeVisible();
    await expectEditorOrder(author, FINAL_ORDER);
    const drafted = await collectionRow(collectionId);
    expect(drafted).toMatchObject({ state: 'draft', approvedRevision: null });
    expect(await storedOrder(collectionId)).toEqual(FINAL_ORDER.map(tokenOf));
    await publisher.goto(mainEditor);
    await expect(
      publisher.getByRole('status').filter({ hasText: /^Draft · / }),
    ).toBeVisible();
    await expect(
      publisher.getByRole('button', { name: 'Publish', exact: true }),
    ).toHaveCount(0);
    // A publish posted anyway is refused, and nothing changes.
    const early = await replayAction(publisher, submitted, {
      action: 'publish',
      version: String(drafted.version),
    });
    expect(early).toMatch(/"failure":"(approval-required|invalid-state)"/);
    expect(await collectionRow(collectionId)).toEqual(drafted);

    // Resubmitted, approved afresh by the reviewer and published by a third.
    await throughWorkflow(mainEditor);
    expect((await collectionRow(collectionId)).state).toBe('published');

    capturedSave = saved;
  });

  test('gives a read-only account the editor without a form, and refuses what it posts anyway', async () => {
    const collectionId = collectionIdOf(mainEditor);
    await reader.goto('/en/admin/editorial/collections');
    await expect(
      reader.getByRole('heading', { name: 'Collections', exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('link', { name: TITLE.en })).toBeVisible();
    await expect(reader.getByRole('link', { name: 'Create draft' })).toHaveCount(0);

    await reader.goto(mainEditor);
    await expect(
      reader.getByRole('status').filter({ hasText: /^Published · Version \d+$/ }),
    ).toBeVisible();
    await expect(reader.getByLabel('Canonical slug', { exact: true })).toHaveCount(0);
    await expect(membersOf(reader)).toHaveCount(0);
    for (const name of [
      'Save revision',
      'Submit for review',
      'Approve revision',
      'Publish',
      'Archive',
    ])
      await expect(reader.getByRole('button', { name, exact: true })).toHaveCount(0);

    // The save the author really made, posted by the reader — and by an
    // account with no editorial permission at all — against the current
    // version with a new title: refused, and nothing is written.
    const before = await collectionRow(collectionId);
    expect(capturedSave).not.toBeNull();
    for (const [who, page] of [
      ['reader', reader],
      ['outsider', outsider],
    ] as const) {
      const refused = await replayAction(page, capturedSave!, {
        version: String(before.version),
        'en-title': `MUST-NOT-WRITE ${who} ${run}`,
      });
      expect(refused, who).toContain('"failure":"denied"');
    }
    expect(await collectionRow(collectionId)).toEqual(before);
    const [written] = await sql.query<{ count: number }>(
      `SELECT COUNT(*) AS [count] FROM [dbo].[CollectionRevisionTranslation] WHERE [title] LIKE N'MUST-NOT-WRITE %${run}';`,
    );
    expect(Number(written?.count)).toBe(0);
  });

  test('refuses the Collection administration to an unrelated account and to an anonymous visitor', async ({
    page,
  }) => {
    const collectionId = collectionIdOf(mainEditor);
    for (const surface of [
      'collections',
      'collections/new',
      `collections/${collectionId}`,
    ]) {
      const response = await outsider.goto(`/en/admin/editorial/${surface}`);
      // Refused as not-found — never a page that confirms what is there.
      expect([200, 404], surface).toContain(response?.status());
      if (response?.status() === 200)
        await expect(outsider.locator('meta[name="robots"]').first()).toHaveAttribute(
          'content',
          /noindex/,
        );
      await expect(outsider.getByText(TITLE.en)).toHaveCount(0);
      await expect(outsider.getByLabel('Canonical slug', { exact: true })).toHaveCount(0);
      await expect(membersOf(outsider)).toHaveCount(0);
    }

    await page.goto('/en/admin/editorial/collections');
    await page.waitForURL(/\/en\/signin\?returnTo=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toMatch(/^\/en\/admin/);
    expect(await page.context().cookies()).toHaveLength(0);
  });
});

/* ========================================================================== */

test.describe('an anonymous visitor finds Collections', () => {
  test('lists the Collection with no cookie and the same body signed in, and News leads here', async ({
    page,
  }) => {
    const response = await page.goto('/en/collections');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Collections');
    const list = page.getByRole('list', { name: 'Collections', exact: true });
    await expect(list.getByRole('link', { name: TITLE.en })).toHaveAttribute(
      'href',
      `/en/collections/${slug.main}`,
    );
    // A card states only what the Collection owns: no picture, no member.
    await expect(page.locator('main img')).toHaveCount(0);
    await expect(list.getByText(MEMBER.work.title)).toHaveCount(0);

    const anonymous = await page.getByRole('main').innerText();
    const signedIn = await author.goto('/en/collections');
    expect(signedIn?.headers()['set-cookie']).toBeUndefined();
    expect(await author.getByRole('main').innerText()).toBe(anonymous);
    expect(await page.context().cookies()).toHaveLength(0);

    // News and Events leads here.
    await page.goto('/en/news');
    await expect(
      page.getByRole('main').locator('a[href="/en/collections"]').first(),
    ).toBeVisible();
  });

  test('shows the members in the saved order, typed and linked to their owners', async ({
    page,
  }) => {
    const response = await page.goto(`/en/collections/${slug.main}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE.en);
    await expect(page.getByRole('main')).toContainText(
      'Synthetic non-authoritative collection introduction.',
    );
    await expectPublicOrder(page, FINAL_ORDER);
    await expect(page.locator('iframe, embed, object')).toHaveCount(0);

    // Every member link resolves at its owner.
    for (const name of FINAL_ORDER)
      expect(
        (await page.request.get(`/en${OWNER_PATH[name]}`)).status(),
        OWNER_PATH[name],
      ).toBe(200);

    // The deployment is pre-adoption: noindex, no canonical claim and no
    // structured data at all (ROUTE_MAP.md §9.5) — so certainly no ItemList or
    // CollectionPage. The indexable half — canonical, hreflang and the
    // BreadcrumbList — is proved where the posture can be switched.
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain('ItemList');
    expect(html).not.toContain('CollectionPage');
    // ...and the sitemap is not served, so no partition can advertise a slug.
    for (const path of ['/sitemap.xml', '/sitemaps/collections-en.xml'])
      expect((await page.request.get(path)).status(), path).toBe(404);

    // The same knowledge signed in, and no cookie was ever set.
    const text = await page.getByRole('main').innerText();
    const signedIn = await author.goto(`/en/collections/${slug.main}`);
    expect(signedIn?.headers()['set-cookie']).toBeUndefined();
    expect(await author.getByRole('main').innerText()).toBe(text);
    expect(await page.context().cookies()).toHaveLength(0);

    // An unknown Collection is not public, signed in or not.
    expect((await page.request.get(`/en/collections/no-such-${run}`)).status()).toBe(404);
  });
});

/* ========================================================================== */

test.describe('reading direction and reflow', () => {
  test('renders Urdu and Arabic right-to-left, with the Collection in its own language', async ({
    page,
  }) => {
    await page.goto('/ur/collections');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('main').getByRole('link', { name: TITLE.ur }),
    ).toBeVisible();

    await page.goto(`/ur/collections/${slug.main}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE.ur);
    await expect(
      page
        .locator('section[aria-labelledby="collection-items"] ol > li')
        .first()
        .getByRole('link'),
    ).toHaveAttribute('href', `/ur${OWNER_PATH.work}`);

    // Arabic has no translation: the English words, marked English, and said so.
    await page.goto(`/ar/collections/${slug.main}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE.en);
    await expect(page.locator('h1').locator('xpath=..')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('main').getByRole('status').filter({ hasText: 'English' }),
    ).toBeVisible();
  });

  test('reflows at 320 pixels and at 200% zoom with no horizontal scroll', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 800 });
      for (const target of [
        '/ur/collections',
        `/ur/collections/${slug.main}`,
        '/ar/collections',
        `/ar/collections/${slug.main}`,
      ]) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        const { overflow, offenders } = await overflowOf(page);
        expect
          .soft(overflow, `${String(width)}px ${target}\n${offenders.join('\n')}`)
          .toBeLessThanOrEqual(0);
      }
    }
  });
});

/* ========================================================================== */

test.describe('former addresses', () => {
  test('answers a renamed Collection with ONE 301 that keeps the locale', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    await author.goto(mainEditor);
    await author.getByLabel('Canonical slug', { exact: true }).fill(slug.renamed);
    await clickSaved(author, 'Save revision');
    // The rename is an ordinary edit: withdrawn until it is published again.
    expect(
      (await request.get(`/en/collections/${slug.main}`, { maxRedirects: 0 })).status(),
    ).toBe(404);
    expect(
      (
        await request.get(`/en/collections/${slug.renamed}`, { maxRedirects: 0 })
      ).status(),
    ).toBe(404);
    await throughWorkflow(mainEditor);

    const old = slug.main;
    slug.main = slug.renamed;
    for (const locale of ['en', 'ur', 'ar']) {
      const from = `/${locale}/collections/${old}`;
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(301);
      const target = new URL(response.headers()['location'] ?? '', baseUrl()).pathname;
      expect(target, from).toBe(`/${locale}/collections/${slug.main}`);
      // The target is final: no second hop.
      expect((await request.get(target, { maxRedirects: 0 })).status(), target).toBe(200);
    }

    // The listing names the current address only.
    const listing = await (await request.get('/en/collections')).text();
    expect(listing).toContain(`/en/collections/${slug.main}"`);
    expect(listing).not.toContain(`/en/collections/${old}"`);
  });
});

/* ========================================================================== */

test.describe('withdrawn members and an archived Collection', () => {
  test('omits a withdrawn member, keeps the rest in order, and says so when none remain', async ({
    page,
  }) => {
    const detail = `/en/collections/${slug.main}`;
    const collectionId = collectionIdOf(mainEditor);
    const stored = await storedOrder(collectionId);
    const record = await collectionRow(collectionId);

    // The Video is withdrawn by its owner: gone from the page, title and
    // address alike, and the others keep their curated order.
    await sql.query(
      `UPDATE [dbo].[Video] SET [state]=N'archived', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.video}';`,
    );
    const response = await page.goto(detail);
    expect(response?.status()).toBe(200);
    await expectPublicOrder(page, ['work', 'news', 'article']);
    let html = await page.content();
    expect(html).not.toContain(MEMBER.video.title);
    expect(html).not.toContain(MEMBER.video.slug);
    await expect(
      page.getByRole('main').getByText('None of the items in this collection'),
    ).toHaveCount(0);

    // The editor keeps the member, by its type and a generic label only.
    await author.goto(mainEditor);
    const last = membersOf(author).locator('ol > li').nth(3);
    await expect(last).toContainText('Video');
    await expect(last).toContainText('No longer public');
    await expect(membersOf(author)).not.toContainText(MEMBER.video.title);

    // The Book is withdrawn by the Library: its Work, not merely its Edition.
    await sql.query(
      `UPDATE [dbo].[Work] SET [state]=N'archived', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.work}';`,
    );
    await page.goto(detail);
    await expectPublicOrder(page, ['news', 'article']);
    html = await page.content();
    expect(html).not.toContain(MEMBER.work.title);

    // The Article and the News are archived by Editorial: nothing remains,
    // and the page says so in words rather than showing an empty list.
    await sql.query(`
      UPDATE [dbo].[Article] SET [state]=N'archived', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.article}';
      UPDATE [dbo].[NewsArticle] SET [state]=N'archived', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.news}';
    `);
    const empty = await page.goto(detail);
    expect(empty?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE.en);
    await expect(
      page
        .getByRole('main')
        .getByText('None of the items in this collection is available at the moment.'),
    ).toBeVisible();
    await expect(
      page.locator('section[aria-labelledby="collection-items"] ol'),
    ).toHaveCount(0);
    html = await page.content();
    for (const name of FINAL_ORDER) {
      expect(html, name).not.toContain(MEMBER[name].title);
      expect(html, name).not.toContain(OWNER_PATH[name]);
    }

    // The Collection itself was never touched by any of it.
    expect(await collectionRow(collectionId)).toEqual(record);
    expect(await storedOrder(collectionId)).toEqual(stored);
  });

  test('archives the Collection without changing any member', async ({ page }) => {
    const collectionId = collectionIdOf(mainEditor);
    const before = await targetStates();
    await publisher.goto(mainEditor);
    await clickSaved(publisher, 'Archive');
    expect((await collectionRow(collectionId)).state).toBe('archived');
    expect(await targetStates()).toBe(before);

    expect((await page.request.get(`/en/collections/${slug.main}`)).status()).toBe(404);
    await page.goto('/en/collections');
    await expect(page.getByRole('main').getByText(TITLE.en)).toHaveCount(0);
  });
});
