import { HADITH_LIMITS, type HadithContributorRecord } from '@minhaj/contracts/hadith';

import { Field, Select } from '@/components/ui';
import type { Copy, PersonChoice } from './shared';

/**
 * Contributors — People credited on a translation or a commentary, each with
 * a role (Phase 19). Being credited grants nobody any permission: a person is
 * a typed reference to People, chosen by NAME and never typed in as text.
 */

/**
 * The contributor rows of a form. A fixed ceiling of rows — the domain's own
 * bound — offered two beyond those already named.
 */
export function ContributorFields({
  prefix,
  roles,
  current,
  people,
  copy,
}: {
  readonly prefix: string;
  readonly roles: readonly HadithContributorRecord['role'][];
  readonly current: readonly HadithContributorRecord[];
  readonly people: readonly PersonChoice[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const ordered = [...current].sort((a, b) => a.position - b.position);
  const rows = Math.min(HADITH_LIMITS.contributors, Math.max(2, ordered.length + 2));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold">{t('contributors.title')}</legend>
      <p className="text-xs text-[color:var(--color-foreground-muted)]">
        {t('contributors.help', { limit: HADITH_LIMITS.contributors })}
      </p>
      {Array.from({ length: rows }, (_, index) => {
        const row = ordered[index];
        return (
          <div key={index} className="grid gap-3 sm:grid-cols-2">
            <Field
              id={`${prefix}-contributor-${String(index)}`}
              label={t('contributors.person', { number: index + 1 })}
            >
              {(props) => (
                <Select
                  {...props}
                  name={`contributor-${String(index)}`}
                  defaultValue={row?.personId ?? ''}
                >
                  <option value="">{t('none')}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              id={`${prefix}-role-${String(index)}`}
              label={t('contributors.role', { number: index + 1 })}
            >
              {(props) => (
                <Select
                  {...props}
                  name={`role-${String(index)}`}
                  defaultValue={row?.role ?? roles[0]}
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {t(`contributors.roleName.${role}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        );
      })}
    </fieldset>
  );
}

/** The contributors as a reader sees them: names from People, and roles in words. */
export function ContributorList({
  contributors,
  names,
  copy,
}: {
  readonly contributors: readonly HadithContributorRecord[];
  readonly names: ReadonlyMap<string, string>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  if (contributors.length === 0) return <>{t('none')}</>;
  return (
    <ul>
      {[...contributors]
        .sort((a, b) => a.position - b.position)
        .map((entry) => (
          <li key={`${entry.personId}:${entry.role}`}>
            {names.get(entry.personId) ?? t('personUnavailable')} —{' '}
            {t(`contributors.roleName.${entry.role}`)}
          </li>
        ))}
    </ul>
  );
}
