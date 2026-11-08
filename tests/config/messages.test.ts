import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { localeSchema } from '../../packages/contracts/src/env/shared.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * The interface message catalogues.
 *
 * Phase 3A delivers INTERFACE localisation only. These files hold UI strings —
 * a heading, two labels, the switcher's accessible name. They hold no Quran
 * translation, no Hadith, no Fatwa text and no organisational claim: that is
 * domain content, owned by later phases and by people qualified to write it.
 *
 * A missing key is not a crash; it renders the key path. That makes key parity
 * something a human would have to notice on a page in a language they may not
 * read, which is precisely the class of defect a mechanical gate is for.
 */

const messagesDirectory = path.join(repoRoot, 'apps', 'web', 'messages');

type Catalogue = Record<string, unknown>;

async function readCatalogue(locale: string): Promise<Catalogue> {
  const raw = await readFile(path.join(messagesDirectory, `${locale}.json`), 'utf8');

  return JSON.parse(raw) as Catalogue;
}

/** Every leaf key path in a catalogue, as `namespace.key`. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];

  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/** Every leaf value in a catalogue, paired with its key path. */
function leaves(value: unknown, prefix = ''): [string, unknown][] {
  if (typeof value !== 'object' || value === null) return [[prefix, value]];

  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('every supported locale has a catalogue', () => {
  it.each([...localeSchema.options])('%s.json parses as JSON', async (locale) => {
    await expect(readCatalogue(locale)).resolves.toBeTypeOf('object');
  });

  it('holds a catalogue for every supported locale and nothing else', async () => {
    // A stray `fr.json` would be a locale nobody can reach and nobody
    // maintains; a missing one is a locale that renders key paths. The
    // directory is checked against the accepted locale set in both directions.
    const files = (await readdir(messagesDirectory)).sort();

    expect(files).toEqual([...localeSchema.options].map((l) => `${l}.json`).sort());
  });
});

describe('the catalogues agree on their keys', () => {
  it('declares at least one message, so parity cannot pass vacuously', async () => {
    // Three empty files agree perfectly. That agreement would prove nothing,
    // and every assertion below would pass.
    expect(keyPaths(await readCatalogue('en')).length).toBeGreaterThan(0);
  });

  it.each([...localeSchema.options])(
    '%s declares exactly the English key set',
    async (locale) => {
      // English is the canonical SHAPE (`apps/web/src/types/messages.d.ts`
      // derives the message type from it), so it is what the others are
      // compared against — in both directions, because an EXTRA key in one
      // catalogue is a message that will never be shown and never updated.
      const expected = keyPaths(await readCatalogue('en')).sort();
      const actual = keyPaths(await readCatalogue(locale)).sort();

      expect(actual).toEqual(expected);
    },
  );

  it.each([...localeSchema.options])('%s has no empty message', async (locale) => {
    for (const [key, value] of leaves(await readCatalogue(locale))) {
      expect(typeof value, `${locale}: ${key} must be a string`).toBe('string');
      expect(String(value).trim(), `${locale}: ${key} must not be empty`).not.toBe('');
    }
  });

  it('translates the strings that a reader actually reads', async () => {
    // Parity alone is satisfied by copying the English file three times. The
    // labels and prose must genuinely differ per locale; the platform NAME is
    // deliberately exempt, because a brand is not translated.
    const [en, ur, ar] = await Promise.all([
      readCatalogue('en'),
      readCatalogue('ur'),
      readCatalogue('ar'),
    ]);

    // Retargeted at the surfaces that now exist: the Phase-4 home shell
    // replaced the Phase-0B foundation page, so the keys it used are gone. The
    // claim is unchanged, and it is made against MORE prose than before.
    for (const key of [
      // R2: the home page opens on its own heading and lede, and closes on
      // the My Minhaj invitation; the pre-adoption note lives in the footer.
      'shell.home.hero.title',
      'shell.home.hero.lede',
      'shell.home.account.body',
      'shell.nav.explore',
      'shell.nav.items.about.title',
      'shell.nav.intros.knowledge',
      'shell.nav.searchPlaceholder',
      'shell.footer.description',
      'shell.reserved.body',
      'shell.footer.preAdoption',
      'shell.notFound.body',
      'localeSwitcher.label',
      'quran.fixture',
      'quran.unavailable.body',
      'hadith.fixture',
      'hadith.unavailable.body',
      'fatwa.fixture',
      'fatwa.unavailable.body',
      'learn.trial.notBooked',
      'learn.filter.invalid',
      'messages.ended.body',
      'messages.thread.withheld',
      'adminMessaging.evidence.audited',
      'membership.process.decision',
      'membership.types.fallback',
      'myMembership.memberships.help',
      'adminMembership.application.audited',
      'donations.how.noDetails',
      'donations.status.notProof',
      'donations.banner.sandbox',
      'myDonations.give.help',
      'adminDonations.record.audited',
      'adminMigration.staged.inert',
      'adminMigration.missing.absenceIsNotDeletion',
    ]) {
      const value = (locale: Catalogue) =>
        Object.fromEntries(leaves(locale))[key] as string;

      expect(new Set([value(en), value(ur), value(ar)]).size, `${key} must differ`).toBe(
        3,
      );
    }
  });

  it('writes the Urdu and Arabic catalogues in their own scripts', async () => {
    // A catalogue that parses, matches on keys and is entirely in English is
    // the failure mode parity cannot see.
    for (const locale of ['ur', 'ar']) {
      const prose = Object.fromEntries(leaves(await readCatalogue(locale)));

      for (const key of [
        'shell.home.hero.lede',
        'shell.reserved.heading',
        'shell.footer.preAdoption',
        'shell.nav.myMinhaj',
        'admin.navigation.title',
        'localeSwitcher.label',
        // Phase 18: the statements a Quran reader must be able to read in their
        // own language — that no corpus is available, that the text on a proof
        // deployment is not the Quran, and which text is the Arabic.
        'quran.unavailable.body',
        'quran.fixture',
        'quran.layer.arabic',
        // Phase 19: likewise for Hadith — that no collection is available, that
        // the text on a proof deployment is not Hadith, which text is the
        // original, and that a grading is the source's, not this site's.
        'hadith.unavailable.body',
        'hadith.fixture',
        'hadith.original',
        'hadith.gradings.note',
        // Phase 20: likewise for Fatwa — that the service is not available, and
        // that a ruling on a proof deployment is not a genuine Fatwa.
        'fatwa.unavailable.body',
        'fatwa.fixture',
        // Phase 22: that a trial-class request books nothing, and why a
        // filtered catalogue lists nothing — both read in the visitor's own
        // language.
        'learn.trial.notBooked',
        'learn.filter.invalid',
        // Phase 24: that a conversation has ended, that a moderator withheld a
        // message, and that opening a support conversation or a report's
        // evidence is audited — each read in the reader's own language.
        'messages.ended.body',
        'messages.thread.withheld',
        'adminMessaging.conversation.audited',
        'adminMessaging.evidence.audited',
        // Phase 26: that applying guarantees no approval, that a type is not
        // translated, that a Membership is not the account, and that opening
        // an application is audited — each read in the reader's own language.
        'membership.process.decision',
        'membership.types.fallback',
        'myMembership.memberships.help',
        'adminMembership.application.audited',
        // Phase 27: that no card or bank detail is entered here, that the
        // status page is not proof of payment, that a test environment moves
        // no real money, what giving from an account links, and that opening
        // a donation record is audited — each read in the reader's language.
        'donations.how.noDetails',
        'donations.status.notProof',
        'donations.banner.sandbox',
        'myDonations.give.help',
        'adminDonations.record.audited',
        // Phase 29: that legacy content on the review page is inert text, and
        // that a missing record is an observation, never a deletion — each
        // read in the reviewer's language.
        'adminMigration.staged.inert',
        'adminMigration.missing.absenceIsNotDeletion',
      ]) {
        expect(String(prose[key]), `${locale} ${key}`).toMatch(/\p{Script=Arabic}/u);
      }
    }
  });
});

describe('missing-message behaviour is explicit', () => {
  it('renders a key path in production rather than blanking or throwing', async () => {
    // ROUTE_MAP.md aside, this is a rendering-safety property: a missing Urdu
    // string must not fail the page for the visitor who came to read it, and
    // must not silently render nothing or some unrelated English text either.
    //
    // Asserted against the configuration the application ships, because the
    // behaviour is a configuration decision. `onError` re-raises outside
    // production — a missing key is a defect a developer fixes — and returns
    // quietly inside it, and `getMessageFallback` pins the rendered value to
    // the key path rather than inheriting whatever the library defaults to.
    const source = await readFile(
      path.join(repoRoot, 'apps/web/src/i18n/request.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');

    expect(code).toMatch(/onError\s*\(/);
    expect(code).toMatch(/getMessageFallback\s*\(/);
    expect(code).toMatch(/namespace === undefined \? key : `\$\{namespace\}\.\$\{key\}`/);

    // Nothing in the fallback path may log a message, a header or a request:
    // an interpolated message value is user content
    // (SECURITY_BASELINE.md §19.2).
    expect(code).not.toMatch(/console\./);
  });
});
