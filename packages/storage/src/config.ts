import 'server-only';

import { z } from 'zod';

/**
 * Storage configuration — server-only, validated, fail-safe.
 *
 * WHAT IS CONFIGURATION AND WHAT IS NOT. An environment owns where its disk is
 * and where its scanner listens. It does NOT own which media types a feature
 * accepts or how large one feature's uploads may be — that is a property of
 * the feature, supplied per upload, and putting it here would let an
 * environment edit quietly widen what the application accepts.
 *
 * No `NEXT_PUBLIC_` value appears here. None of this is a browser's business.
 */

/**
 * The absolute ceiling the foundation will write, in bytes.
 *
 * It is environment-owned because it is a property of the DISK, not of a
 * feature: it is the largest single object this deployment is willing to hold
 * at all. A caller's own limit narrows it and can never raise it.
 */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export const storageEnvSchema = z.object({
  /**
   * Absolute path to the storage root.
   *
   * Required and absolute: a relative root would resolve against whatever the
   * working directory happened to be, which is how a process ends up writing
   * uploads into the repository or into `.next`.
   */
  STORAGE_ROOT: z
    .string()
    .min(1)
    .refine(
      (value) => /^(?:[/\\]|[A-Za-z]:[/\\])/u.test(value),
      'STORAGE_ROOT must be an absolute path.',
    ),

  STORAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024)
    .default(DEFAULT_MAX_BYTES),

  CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(120_000),
});

export type StorageEnvironment = z.infer<typeof storageEnvSchema>;
