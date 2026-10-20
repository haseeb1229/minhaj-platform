import 'server-only';

/**
 * Which account a lifecycle connection is expected to be, POSITIVELY — shared
 * by the local target guard (`./local-target.ts`) and the staging target guard
 * (`./staging-target.ts`).
 *
 * Extracted rather than copied. The three-principal separation
 * (SECURITY_BASELINE.md §8.3, §18.2) is one rule, and two copies of it are two
 * places for it to drift: the one that weakens is always the one nobody reads.
 * Each guard wraps the refusal in its own error class, so the wording a reader
 * sees is identical wherever the rule is enforced.
 *
 * `operator` is the dedicated privileged-operations principal added in Phase 2
 * Chunk 2. It is a THIRD account, not a reuse of either other one: the
 * migration principal can change schema and must not perform routine bootstrap
 * or recovery, and the runtime principal must never be able to provision an
 * administrator.
 */
export type PrincipalPolicy = 'migration' | 'runtime' | 'operator';

/** The configured logins the distinctness proofs are made against. */
export interface PrincipalLogins {
  /** `DATABASE_APP_LOGIN` — the runtime account. */
  runtimeLogin: string | undefined;
  /** `DATABASE_OPERATOR_LOGIN` — the privileged-operations account. */
  operatorLogin: string | undefined;
}

/**
 * Why `user` is NOT the account `policy` expects, or `undefined` when it is.
 *
 * Returns a reason rather than throwing so each guard raises its own error
 * type. The reason names configuration keys and login names only — never a
 * password and never a URL.
 */
export function principalRefusal(
  user: string,
  policy: PrincipalPolicy,
  logins: PrincipalLogins,
): string | undefined {
  const { runtimeLogin, operatorLogin } = logins;

  if (user === '') return 'the configuration names no principal';
  if (!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(user)) {
    return `'${user}' is not a plain SQL Server identifier`;
  }

  if (policy === 'operator') {
    // Positively the configured operator, and positively NOT the runtime
    // account. A bootstrap performed by the web application's own login would
    // mean the application could perform it too, which is the entire property
    // the separate principal exists to deny.
    if (operatorLogin === undefined || operatorLogin === '') {
      return (
        'DATABASE_OPERATOR_LOGIN is not configured, so the privileged-operations ' +
        'principal cannot be positively identified'
      );
    }
    if (user !== operatorLogin) {
      return (
        `the operator connection is '${user}', not the configured ` +
        `privileged-operations principal '${operatorLogin}'`
      );
    }
    if (runtimeLogin !== undefined && user === runtimeLogin) {
      return (
        `the operator principal is the same account as the runtime principal ` +
        `('${user}'); a web request must never be able to run these procedures`
      );
    }
    return undefined;
  }

  if (policy === 'migration') {
    // SECURITY_BASELINE.md §18.2: the runtime account must not be able to
    // change schema, which is only true while the two accounts are distinct.
    if (runtimeLogin === undefined || runtimeLogin === '') {
      return (
        'DATABASE_APP_LOGIN is not configured, so separation between the ' +
        'migration and runtime principals cannot be proven'
      );
    }
    if (user === runtimeLogin) {
      return (
        `the migration principal is the same account as the runtime principal ` +
        `('${user}'); migration authority must be held separately`
      );
    }
    return undefined;
  }

  // The runtime path must be the least-privilege account, positively — not
  // merely "some account that is not sa".
  if (runtimeLogin === undefined || runtimeLogin === '') {
    return (
      'DATABASE_APP_LOGIN is not configured, so the runtime principal cannot be ' +
      'positively identified'
    );
  }
  if (user !== runtimeLogin) {
    return (
      `the runtime connection is '${user}', not the configured least-privilege ` +
      `principal '${runtimeLogin}'`
    );
  }
  return undefined;
}
