import { describe, expect, it } from 'vitest';

import {
  classifyProtectedMutationError,
  ProtectedMutationUnavailableError,
} from '../../packages/database/src/adapters/identity-access/final-administrator.ts';

/**
 * The protected-invariant refusal classifier, at the layer that makes the
 * claim.
 *
 * This is pure mapping from an error VALUE onto a meaning, so it is proved
 * here rather than through a database: the SQL behaviour that produces those
 * values is proved separately, live, in `authorization.integration.test.ts`.
 *
 * The shapes below are the ones measured on this stack — a Prisma model write,
 * a Prisma raw write and a direct driver error — not shapes invented for the
 * test.
 */

/** What a model write through Prisma 7.10 over `@prisma/adapter-mssql` looks like. */
function prismaModelError(number: number, message: string): unknown {
  return Object.assign(
    new Error(`\nInvalid \`tx.roleAssignment.updateMany()\` invocation`),
    {
      name: 'PrismaClientKnownRequestError',
      code: 'P2039',
      clientVersion: '7.10.0',
      meta: {
        modelName: 'RoleAssignment',
        driverAdapterError: Object.assign(new Error(message), {
          name: 'DriverAdapterError',
          cause: {
            originalCode: 'EREQUEST',
            originalMessage: message,
            kind: 'mssql',
            code: number,
            message,
          },
        }),
      },
    },
  );
}

/** What a raw write through the same adapter looks like. */
function prismaRawError(number: number, message: string): unknown {
  return Object.assign(new Error(`Raw query failed. Code: \`EREQUEST\`.`), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2010',
    meta: {
      driverAdapterError: Object.assign(new Error(message), {
        name: 'DriverAdapterError',
        cause: { originalCode: 'EREQUEST', kind: 'mssql', code: number, message },
      }),
    },
  });
}

/** What the MSSQL driver raises directly, for the tooling paths that use it. */
function driverError(number: number, message: string): unknown {
  return Object.assign(new Error(message), {
    code: 'EREQUEST',
    number,
    info: { number, state: 1, class: 16, message },
  });
}

describe('protected-invariant refusal classification', () => {
  it('reads 51020 as the SEMANTIC final-administrator refusal', () => {
    for (const error of [
      prismaModelError(
        51020,
        'The final usable Platform Administrator cannot be removed.',
      ),
      prismaRawError(51020, 'The final usable Platform Administrator cannot be removed.'),
      driverError(
        51020,
        'A completed bootstrap requires a usable Platform Administrator.',
      ),
    ]) {
      expect(classifyProtectedMutationError(error)).toBe('final-administrator');
    }
  });

  it('reads 51021 as TRANSIENT — a lock is not a statement about administrators', () => {
    const error = prismaModelError(
      51021,
      'The Platform Administrator invariant lock could not be acquired.',
    );
    expect(classifyProtectedMutationError(error)).toBe('transient');
  });

  it('reads 1205 as TRANSIENT', () => {
    const error = driverError(
      1205,
      'Transaction (Process ID 80) was deadlocked on lock resources with another process and has been chosen as the deadlock victim. Rerun the transaction.',
    );
    expect(classifyProtectedMutationError(error)).toBe('transient');
  });

  it('leaves an unrelated database failure alone', () => {
    expect(
      classifyProtectedMutationError(
        driverError(8134, 'Divide by zero error encountered.'),
      ),
    ).toBe('other');
    expect(
      classifyProtectedMutationError(driverError(207, "Invalid column name 'userId'.")),
    ).toBe('other');
    expect(classifyProtectedMutationError(new Error('connection lost'))).toBe('other');
    expect(classifyProtectedMutationError(null)).toBe('other');
    expect(classifyProtectedMutationError(undefined)).toBe('other');
    expect(classifyProtectedMutationError('51020')).toBe('other');
  });

  /**
   * THE REASON THIS CLASSIFIER IS STRUCTURAL.
   *
   * Every string below reaches an error message through an ordinary, entirely
   * user-controlled value — a revocation reason, a role name, an account's
   * display name. Under a text-matching classifier any one of them could
   * impersonate the authoritative invariant and turn a failure that the
   * database never refused into "the final administrator cannot be removed".
   */
  it('cannot be impersonated by message text', () => {
    for (const text of [
      'Error 51020 occurred',
      'THROW 51020',
      'The final usable Platform Administrator cannot be removed.',
      'The Platform Administrator invariant lock could not be acquired.',
      '51021',
    ]) {
      expect(classifyProtectedMutationError(new Error(text))).toBe('other');
      expect(
        classifyProtectedMutationError(
          Object.assign(new Error('write failed'), {
            code: 'P2002',
            meta: { target: text },
          }),
        ),
      ).toBe('other');
    }
  });

  it('reads the number even when it is nested behind unrelated wrapping', () => {
    const wrapped = Object.assign(new Error('outer'), {
      cause: Object.assign(new Error('middle'), {
        originalError: prismaRawError(51020, 'refused'),
      }),
    });
    expect(classifyProtectedMutationError(wrapped)).toBe('final-administrator');
  });

  it('terminates on a CYCLIC wrapped error', () => {
    const inner: Record<string, unknown> = { code: 51021 };
    const outer: Record<string, unknown> = { cause: inner };
    inner['cause'] = outer;
    inner['meta'] = inner;

    expect(classifyProtectedMutationError(outer)).toBe('transient');
  });

  it('does not execute accessors or trust inherited numeric evidence', () => {
    let getterCalls = 0;
    const accessors = Object.defineProperties(
      {},
      {
        code: {
          enumerable: true,
          get() {
            getterCalls += 1;
            return 51020;
          },
        },
        cause: {
          enumerable: true,
          get() {
            getterCalls += 1;
            return { code: 51020 };
          },
        },
      },
    );
    const inherited = Object.create({ code: 51020, cause: { code: 51020 } }) as object;

    expect(classifyProtectedMutationError(accessors)).toBe('other');
    expect(classifyProtectedMutationError(inherited)).toBe('other');
    expect(getterCalls).toBe(0);
  });

  it('treats a hostile proxy as no structured evidence', () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('descriptor denied');
        },
      },
    );

    expect(classifyProtectedMutationError(hostile)).toBe('other');
  });

  it('prefers the SEMANTIC refusal when both numbers are present', () => {
    const both = Object.assign(new Error('outer'), {
      number: 51021,
      cause: { code: 51020 },
    });
    expect(classifyProtectedMutationError(both)).toBe('final-administrator');
  });
});

describe('the exhausted-serialisation error', () => {
  it('carries a safe category and attempt count, and no database detail', () => {
    const error = new ProtectedMutationUnavailableError(3);

    expect(error.reason).toBe('invariant-serialisation');
    expect(error.attempts).toBe(3);

    // NOT `final-administrator`: the application layer must not read this as
    // an invariant refusal the database never made.
    expect(classifyProtectedMutationError(error)).toBe('other');

    // No SQL number, no driver text, no query, no lock resource.
    expect(error.message).not.toMatch(
      /5102[01]|1205|sp_getapplock|minhaj:|EREQUEST|SELECT|UPDATE/,
    );
  });
});
