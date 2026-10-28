import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_ID,
  parseOperatorArguments,
} from '../../packages/database/scripts/operator-arguments.ts';
import {
  isMigrationRunMode,
  toolArguments,
} from '../../packages/database/scripts/staging-migration-arguments.ts';

/**
 * The staging migration runner names its operator by the same internal
 * account identifier as every other operator command. The first real staging
 * administrator holds a Better Auth identifier, not a UUID, and the runner
 * refused it until both commands shared one shape.
 */

// Synthetic identifiers in the two shapes `User.id` holds.
const BETTER_AUTH_ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const UUID_ID = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

const REGISTER = [
  '--source',
  'minhaj-org-news-en',
  '--authorisation-reference',
  'OWNER-ATTESTATION-SYNTHETIC',
  '--authorised-on',
  '2026-10-27',
];
const RUN = ['--source', 'minhaj-org-news-en', '--pages', '2', '--limit', '20'];

describe('the operator account identifier', () => {
  it.each([BETTER_AUTH_ID, UUID_ID])('accepts %s for both modes', (operator) => {
    expect(
      toolArguments('register', [...REGISTER, '--operator', operator, '--activate']),
    ).toEqual([...REGISTER, '--operator', operator, '--activate']);
    expect(toolArguments('run', [...RUN, '--operator', operator])).toEqual([
      ...RUN,
      '--operator',
      operator,
    ]);
  });

  it.each([
    ['an email address', 'owner@example.invalid'],
    ['a too-short value', 'abc'],
    ['a too-long value', 'a'.repeat(37)],
    ['shell syntax', 'abcdefgh;id'],
    ['an empty value', ''],
  ])('refuses %s', (_name, operator) => {
    expect(() => toolArguments('run', [...RUN, '--operator', operator])).toThrow(
      /--operator has a malformed value/u,
    );
    expect(ACCOUNT_ID.test(operator)).toBe(false);
  });

  it('is the shape the identity operator commands take', () => {
    expect(
      parseOperatorArguments(['--user', BETTER_AUTH_ID, '--ticket', 'synthetic'], 'usage')
        .targetUserId,
    ).toBe(BETTER_AUTH_ID);
    expect(() =>
      parseOperatorArguments(
        ['--user', 'owner@example.invalid', '--ticket', 'x'],
        'usage',
      ),
    ).toThrow(/internal account identifier/u);
  });
});

describe('toolArguments', () => {
  it('requires every required argument', () => {
    expect(() => toolArguments('run', ['--source', 'minhaj-org-news-en'])).toThrow(
      /is required for run/u,
    );
  });

  it('refuses unknown, repeated and malformed arguments', () => {
    expect(() =>
      toolArguments('run', [...RUN, '--operator', BETTER_AUTH_ID, '--url', 'x']),
    ).toThrow(/not an argument of run/u);
    expect(() =>
      toolArguments('run', [...RUN, '--operator', BETTER_AUTH_ID, '--pages', '3']),
    ).toThrow(/given twice/u);
    expect(() =>
      toolArguments('run', [
        '--source',
        'Bad Key',
        '--operator',
        BETTER_AUTH_ID,
        '--pages',
        '1',
        '--limit',
        '1',
      ]),
    ).toThrow(/--source has a malformed value/u);
    expect(() =>
      toolArguments('run', [...RUN, '--operator', BETTER_AUTH_ID, '--items', 'a,b c']),
    ).toThrow(/--items has a malformed value/u);
  });

  it('knows only its two modes', () => {
    expect(isMigrationRunMode('register')).toBe(true);
    expect(isMigrationRunMode('run')).toBe(true);
    expect(isMigrationRunMode('publish')).toBe(false);
    expect(isMigrationRunMode(undefined)).toBe(false);
  });
});
