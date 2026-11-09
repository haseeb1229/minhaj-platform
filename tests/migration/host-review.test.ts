import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assertMigrationReviewPosture,
  parseMigrationReviewArguments,
} from '../../packages/database/src/lifecycle/staging-migration-review.ts';
import {
  assertRightsPolicy,
  FIRST_PARTY_MINHAJ_DOMAINS,
  isFirstPartyMinhajHost,
  R2_ATTESTATION,
  selectionConfirmation,
} from '../../scripts/review/policy.ts';

/**
 * The staging HOST REVIEW (Rebaseline R2;
 * OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP): the owner-side command's
 * strict argument and posture checks, made before any connection opens, and
 * the review tool's own picture rule and queue confirmation, made before any
 * service is asked. Every act through the real services, against a real SQL
 * Server: `host-review.integration.test.ts`.
 */

const OPERATOR = 'host-review-admin-1';
const APPROVER = 'host-review-admin-2';
const RUN = '0b6f2c1e-9a4d-4c3b-8e7f-1a2b3c4d5e6f';
const MANIFEST = '7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6';
const FINGERPRINT = 'a'.repeat(64);
const EVIDENCE = `The page's own copyright notice; ${R2_ATTESTATION}`;

const parse = (...argv: string[]) => parseMigrationReviewArguments(argv);
const refused =
  (...argv: string[]) =>
  () =>
    parse(...argv);

describe('the host review command — arguments, before any connection', () => {
  it('reads each act and hands the tool its flags in one fixed order', () => {
    expect(parse('status', '--run', RUN, '--operator', OPERATOR)).toEqual({
      act: 'status',
      toolArguments: ['status', '--operator', OPERATOR, '--run', RUN],
      publisherSessionFor: null,
    });
    expect(
      parse('status', '--operator', OPERATOR, '--source', 'minhaj-org-news-en')
        .toolArguments,
    ).toEqual(['status', '--operator', OPERATOR, '--source', 'minhaj-org-news-en']);
    expect(
      parse(
        'approve-run',
        '--confirm-fingerprint',
        FINGERPRINT,
        '--operator',
        OPERATOR,
        '--confirm-count',
        '12',
        '--run',
        RUN,
      ).toolArguments,
    ).toEqual([
      'approve-run',
      '--run',
      RUN,
      '--operator',
      OPERATOR,
      '--confirm-count',
      '12',
      '--confirm-fingerprint',
      FINGERPRINT,
    ]);
    expect(
      parse(
        'rights',
        '--run',
        RUN,
        '--host',
        'www.minhaj.net',
        '--operator',
        OPERATOR,
        '--licence',
        'organisation-owned',
        '--evidence',
        EVIDENCE,
        '--rights-holder',
        'Minhaj-ul-Quran International',
        '--confirm-count',
        '3',
        '--confirm-fingerprint',
        FINGERPRINT,
      ).toolArguments,
    ).toContain(EVIDENCE);
    expect(parse('manifest', '--run', RUN, '--operator', OPERATOR).act).toBe('manifest');
    expect(parse('editorial', '--kind', 'news-article', '--approver', APPROVER).act).toBe(
      'editorial',
    );
  });

  it('finds the publisher’s session only for a confirmed publication that names none', () => {
    expect(
      parse('publish', '--manifest', MANIFEST, '--operator', OPERATOR)
        .publisherSessionFor,
    ).toBeNull();
    expect(
      parse(
        'publish',
        '--manifest',
        MANIFEST,
        '--operator',
        OPERATOR,
        '--confirm-version',
        '2',
      ).publisherSessionFor,
    ).toBe(OPERATOR);
    const named = parse(
      'publish',
      '--manifest',
      MANIFEST,
      '--operator',
      OPERATOR,
      '--confirm-version',
      '2',
      '--session',
      'session-0000000001',
    );
    expect(named.publisherSessionFor).toBeNull();
    expect(named.toolArguments).toEqual([
      'publish',
      '--manifest',
      MANIFEST,
      '--operator',
      OPERATOR,
      '--confirm-version',
      '2',
      '--session',
      'session-0000000001',
    ]);
  });

  it('refuses an unknown act, an unknown or repeated flag and a missing one', () => {
    expect(refused()).toThrow(/usage/u);
    expect(refused('publish-all', '--operator', OPERATOR)).toThrow(/usage/u);
    expect(
      refused(
        'approve-run',
        '--run',
        RUN,
        '--operator',
        OPERATOR,
        '--licence',
        'licensed',
      ),
    ).toThrow(/does not take --licence/u);
    expect(
      refused('approve-run', '--run', RUN, '--run', RUN, '--operator', OPERATOR),
    ).toThrow(/does not take --run/u);
    expect(refused('approve-run', '--run', RUN)).toThrow(/needs --operator/u);
    expect(refused('approve-run', '--run', RUN, '--operator')).toThrow(/needs a value/u);
    expect(refused('approve-run', '--run', '--operator', OPERATOR)).toThrow(
      /needs a value/u,
    );
    expect(refused('approve-run', '--run', RUN, '--operator', OPERATOR, 'stray')).toThrow(
      /does not take that argument/u,
    );
  });

  it('refuses a value of the wrong shape without echoing it', () => {
    const cases: string[][] = [
      ['approve-run', '--run', RUN, '--operator', 'admin@example.invalid'],
      ['approve-run', '--run', 'not-a-run', '--operator', OPERATOR],
      ['rights', '--run', RUN, '--host', 'WWW.MINHAJ.ORG', '--operator', OPERATOR],
      [
        'rights',
        '--run',
        RUN,
        '--host',
        'https://www.minhaj.org/',
        '--operator',
        OPERATOR,
      ],
      [
        'approve-run',
        '--run',
        RUN,
        '--operator',
        OPERATOR,
        '--confirm-count',
        '0',
        '--confirm-fingerprint',
        FINGERPRINT,
      ],
      [
        'approve-run',
        '--run',
        RUN,
        '--operator',
        OPERATOR,
        '--confirm-count',
        '1',
        '--confirm-fingerprint',
        'ABC',
      ],
      ['approve-run', '--run', RUN, '--operator', OPERATOR, '--note', 'line\nbreak'],
      ['approve-run', '--run', RUN, '--operator', OPERATOR, '--note', ' padded'],
      [
        'rights',
        '--run',
        RUN,
        '--host',
        'www.minhaj.org',
        '--operator',
        OPERATOR,
        '--licence',
        'public-domain',
        '--evidence',
        EVIDENCE,
        '--rights-holder',
        'MQI',
      ],
      [
        'rights',
        '--run',
        RUN,
        '--host',
        'www.minhaj.org',
        '--operator',
        OPERATOR,
        '--licence',
        'licensed',
        '--evidence',
        'short',
        '--rights-holder',
        'MQI',
      ],
      [
        'publish',
        '--manifest',
        MANIFEST,
        '--operator',
        OPERATOR,
        '--confirm-version',
        '-1',
      ],
      ['editorial', '--kind', 'Article', '--approver', APPROVER],
    ];
    for (const argv of cases) {
      const attempt = refused(...argv);
      expect(attempt, argv.join(' ')).toThrow(/expected shape|needs a value/u);
      try {
        attempt();
      } catch (error) {
        expect((error as Error).message).not.toContain('admin@example.invalid');
        expect((error as Error).name).toBe('MigrationReviewCommandRefusal');
      }
    }
  });

  it('refuses a half confirmation and every combination one act cannot mean', () => {
    expect(
      refused('manifest', '--run', RUN, '--operator', OPERATOR, '--confirm-count', '3'),
    ).toThrow(/go together/u);
    expect(
      refused(
        'editorial',
        '--kind',
        'article',
        '--approver',
        APPROVER,
        '--confirm-fingerprint',
        FINGERPRINT,
      ),
    ).toThrow(/go together/u);
    expect(refused('status', '--operator', OPERATOR)).toThrow(/exactly one/u);
    expect(
      refused(
        'status',
        '--operator',
        OPERATOR,
        '--run',
        RUN,
        '--source',
        'minhaj-org-news-en',
      ),
    ).toThrow(/exactly one/u);
    expect(
      refused(
        'publish',
        '--manifest',
        MANIFEST,
        '--operator',
        OPERATOR,
        '--session',
        'session-0000000001',
      ),
    ).toThrow(/--session goes with --confirm-version/u);
  });

  it('never decides pictures without an explicit licence, evidence and rights holder', () => {
    const base = [
      'rights',
      '--run',
      RUN,
      '--host',
      'www.minhaj.net',
      '--operator',
      OPERATOR,
    ];
    // A preview needs none of them.
    expect(parse(...base).act).toBe('rights');
    // A confirmation without all three is refused: nothing defaults.
    expect(
      refused(...base, '--confirm-count', '3', '--confirm-fingerprint', FINGERPRINT),
    ).toThrow(/states --licence, --evidence and --rights-holder explicitly/u);
    expect(
      refused(...base, '--licence', 'organisation-owned', '--evidence', EVIDENCE),
    ).toThrow(/go together/u);
    expect(refused(...base, '--decide-non-first-party-host', 'www.minhaj.net')).toThrow(
      /goes with a decision/u,
    );
  });

  it('refuses outside a declared non-indexable staging deployment', () => {
    expect(() => assertMigrationReviewPosture({})).toThrow(/staging-only/u);
    expect(() =>
      assertMigrationReviewPosture({
        MINHAJ_DEPLOYMENT_ENVIRONMENT: 'production',
        PUBLIC_INDEXING_ENABLED: 'false',
      }),
    ).toThrow(/staging-only/u);
    expect(() =>
      assertMigrationReviewPosture({ MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging' }),
    ).toThrow(/non-indexable/u);
    expect(() =>
      assertMigrationReviewPosture({
        MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging',
        PUBLIC_INDEXING_ENABLED: 'true',
      }),
    ).toThrow(/non-indexable/u);
    expect(() =>
      assertMigrationReviewPosture({
        MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging',
        PUBLIC_INDEXING_ENABLED: 'false',
      }),
    ).not.toThrow();
  });
});

describe('the host review tool — the standing picture rule', () => {
  it('knows Minhaj-ul-Quran International’s own domains, and nothing that merely resembles them', () => {
    expect(FIRST_PARTY_MINHAJ_DOMAINS).toContain('minhaj.org');
    for (const host of [
      'www.minhaj.org',
      'minhaj.net',
      'www.minhaj.net',
      'minhaj.info',
      'www.minhaj.tv',
      'www.minhajbooks.com',
      'minhajoverseas.com',
      'www.irfan-ul-quran.com',
      'thefatwa.com',
    ])
      expect(isFirstPartyMinhajHost(host), host).toBe(true);
    for (const host of [
      'evilminhaj.org',
      'minhaj.org.example.com',
      'minhaj-org.example',
      'i.ytimg.com',
      'media.fixture.invalid',
      'WWW.MINHAJ.ORG',
      '',
    ])
      expect(isFirstPartyMinhajHost(host), host).toBe(false);
  });

  const decision = (
    host: string,
    overrides: Partial<Parameters<typeof assertRightsPolicy>[0]> = {},
  ) => ({
    host,
    licence: 'organisation-owned',
    licenceEvidence: EVIDENCE,
    rightsHolder: 'Minhaj-ul-Quran International',
    nonFirstPartyHost: null,
    ...overrides,
  });

  it('decides a first-party host only with evidence naming the R2 attestation', () => {
    expect(assertRightsPolicy(decision('www.minhaj.net'))).toEqual({ firstParty: true });
    expect(() =>
      assertRightsPolicy(
        decision('www.minhaj.net', {
          licenceEvidence: 'The page states its own copyright.',
        }),
      ),
    ).toThrow(new RegExp(R2_ATTESTATION, 'u'));
    expect(() =>
      assertRightsPolicy(
        decision('www.minhaj.net', { nonFirstPartyHost: 'www.minhaj.net' }),
      ),
    ).toThrow(/does not apply/u);
  });

  it('keeps any other host restricted unless the operator repeats that exact host', () => {
    expect(() => assertRightsPolicy(decision('media.fixture.invalid'))).toThrow(
      /stay restricted/u,
    );
    expect(() =>
      assertRightsPolicy(
        decision('media.fixture.invalid', { nonFirstPartyHost: 'other.fixture.invalid' }),
      ),
    ).toThrow(/repeat --host exactly/u);
    expect(
      assertRightsPolicy(
        decision('media.fixture.invalid', { nonFirstPartyHost: 'media.fixture.invalid' }),
      ),
    ).toEqual({ firstParty: false });
  });
});

describe('the host review tool — the queue page confirmation', () => {
  it('is the SHA-256 of every id:version, in order — the shape Migration’s confirmations use', () => {
    const keys = [
      { id: 'b', version: 2 },
      { id: 'a', version: 7 },
    ];
    const expected = createHash('sha256').update('b:2\na:7', 'utf8').digest('hex');
    expect(selectionConfirmation(keys)).toEqual({ count: 2, fingerprint: expected });
    // Reordered or moved, it is another set.
    expect(selectionConfirmation([...keys].reverse()).fingerprint).not.toBe(expected);
    expect(
      selectionConfirmation([
        { id: 'b', version: 3 },
        { id: 'a', version: 7 },
      ]).fingerprint,
    ).not.toBe(expected);
    expect(selectionConfirmation([])).toEqual({
      count: 0,
      fingerprint: createHash('sha256').update('', 'utf8').digest('hex'),
    });
  });
});
