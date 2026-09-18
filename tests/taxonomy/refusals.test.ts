import { describe, expect, it } from 'vitest';

import { taxonomyRefusalOf } from '../../packages/database/src/adapters/taxonomy/refusals.ts';

describe('Phase 3B — trusted Taxonomy database refusals', () => {
  it.each([
    [51030, 'hierarchy-cycle'],
    [51031, 'hierarchy-lock-unavailable'],
    [51032, 'hierarchy-too-deep'],
    [51033, 'fallback-translation-required'],
  ] as const)(
    'recognises SQL Server %s through a nested Prisma wrapper',
    (code, reason) => {
      const error = {
        code: 'P2039',
        meta: {
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: { kind: 'mssql', code, message: 'driver detail' },
          },
        },
      };

      expect(taxonomyRefusalOf(error)).toBe(reason);
    },
  );

  it('recognises the raw mssql RequestError shape', () => {
    expect(
      taxonomyRefusalOf({
        code: 'EREQUEST',
        number: 51030,
        message: 'A Topic cannot be moved beneath its own descendant.',
      }),
    ).toBe('hierarchy-cycle');
  });

  it('does not trust arbitrary message text or unqualified numbers', () => {
    expect(taxonomyRefusalOf(new Error('A submitted title contains 51030'))).toBeNull();
    expect(
      taxonomyRefusalOf({
        message: 'A Topic cannot be moved beneath its own descendant.',
        number: 51030,
      }),
    ).toBeNull();
    expect(taxonomyRefusalOf('51033 must keep its fallback translation')).toBeNull();
  });

  it('leaves unrelated SQL and connection failures unclassified', () => {
    expect(
      taxonomyRefusalOf({ code: 'EREQUEST', number: 547, message: 'foreign key' }),
    ).toBeNull();
    expect(
      taxonomyRefusalOf({
        code: 'P1001',
        meta: { cause: { kind: 'DatabaseNotReachable' } },
      }),
    ).toBeNull();
    expect(
      taxonomyRefusalOf({
        code: 'P2034',
        meta: { cause: { kind: 'mssql', code: 1205, message: 'deadlock victim' } },
      }),
    ).toBeNull();
  });

  it('terminates on a cyclic error graph', () => {
    const outer: Record<string, unknown> = { code: 'P2039' };
    const cause: Record<string, unknown> = { kind: 'wrapper', cause: outer };
    outer['meta'] = { driverAdapterError: cause };

    expect(taxonomyRefusalOf(outer)).toBeNull();
  });
});
