import 'server-only';

import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { MigrationActor, MigrationAuthorityPort } from '@minhaj/contracts/migration';

import { MigrationRefusal, asMigrationRefusal } from '../domain/refusal.ts';

/**
 * What every Migration service shares: the live permission check, the
 * re-verification of a privileged publisher, and the refusal mapping. Private
 * to the context.
 */

/** The ordinary keys, bundled to the platform administrator. */
export const READ = 'migration.read';
export const ADMINISTER = 'migration.administer';

const accountIdSchema = z.string().min(1).max(36);

export function sha256Hex(value: string | Uint8Array): string {
  const hash = createHash('sha256');
  if (typeof value === 'string') hash.update(value, 'utf8');
  else hash.update(value);
  return hash.digest('hex');
}

/** A port call whose data error is re-thrown as the refusal it names. */
export const guarded = <T>(work: Promise<T>): Promise<T> =>
  work.catch(asMigrationRefusal);

export interface Gate {
  /** Identity's live answer for one key; anything but `true` is `denied`. */
  holds(actor: MigrationActor, permission: string): Promise<string>;
  /** Permission first, parsing second: an unauthorised caller learns nothing of the rules. */
  authorised<S extends z.ZodType>(
    actor: MigrationActor,
    permission: string,
    schema: S,
    input: unknown,
  ): Promise<{ readonly actorId: string; readonly value: z.output<S> }>;
  /**
   * The account a privileged actor (minted by Identity's gate for
   * `migration.publish` + a live `migration-publication` step-up) stands for,
   * re-verified now — or `denied`.
   */
  publisher(privilegedActor: unknown): Promise<string>;
}

export function createGate(authority: MigrationAuthorityPort): Gate {
  async function holds(actor: MigrationActor, permission: string): Promise<string> {
    const parsed = accountIdSchema.safeParse((actor as MigrationActor | null)?.accountId);
    if (!parsed.success) throw new MigrationRefusal('denied');
    let permitted: boolean;
    try {
      permitted = await authority.permits(parsed.data, permission);
    } catch {
      throw new MigrationRefusal('unavailable');
    }
    if (permitted !== true) throw new MigrationRefusal('denied');
    return parsed.data;
  }

  return {
    holds,

    async authorised(actor, permission, schema, input) {
      const actorId = await holds(actor, permission);
      const parsed = schema.safeParse(input);
      if (!parsed.success) throw new MigrationRefusal('invalid');
      return { actorId, value: parsed.data };
    },

    async publisher(privilegedActor) {
      let verified: string | null;
      try {
        verified = await authority.verifyPublisher(privilegedActor);
      } catch {
        throw new MigrationRefusal('denied');
      }
      const parsed = accountIdSchema.safeParse(verified);
      if (!parsed.success) throw new MigrationRefusal('denied');
      return parsed.data;
    },
  };
}

/** Bounded, single-line operator text: never a body, never a header value. */
export function safeDetail(text: string | null, max = 500): string | null {
  if (text === null) return null;
  let flat = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    flat += code < 0x20 || code === 0x7f ? ' ' : char;
  }
  const clean = flat.replace(/ {2,}/g, ' ').trim();
  if (clean.length === 0) return null;
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** At most `max` UTF-16 units, never splitting a surrogate pair. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  let out = '';
  for (const char of value) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out;
}
