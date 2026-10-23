import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/**
 * THE SYNTHETIC EXECUTABLE LEGACY EXPORT, opened as a migration SOURCE
 * (MIGRATION_STRATEGY.md §1.3; Phase-29 decision 14).
 *
 * `synthetic-export.sql` is executed into an IN-MEMORY `node:sqlite` database —
 * a different engine and a different schema from the target — and then made
 * query-only before anything reads it. It holds no target credential, never
 * touches SQL Server, writes no file, and is gone when `close()` runs. Reads
 * are bounded, id-ordered cursor pages.
 */

/** One row of the legacy schema, exactly as the export stores it. */
export interface LegacyVideoRow {
  readonly id: number;
  readonly lang: string;
  readonly title_en: string;
  readonly title_ur: string | null;
  readonly provider: string | null;
  readonly ref: string | null;
  readonly cat_key: string | null;
  readonly cat_label: string | null;
  readonly body_html: string | null;
  readonly published: string | null;
  readonly duration_s: number | null;
}

export interface SyntheticExportSource {
  /** Rows with `id > afterId`, in id order, at most `limit` (1–100). */
  rows(afterId: number, limit: number): readonly LegacyVideoRow[];
  row(id: number): LegacyVideoRow | null;
  /** The export's own table names — evidence that it is not the target schema. */
  tables(): readonly string[];
  close(): void;
}

const COLUMNS =
  'id, lang, title_en, title_ur, provider, ref, cat_key, cat_label, body_html, published, duration_s';

const DUMP_URL = new URL('./synthetic-export.sql', import.meta.url);

/** Reads one row from an untyped record, refusing any shape the schema does not have. */
export function legacyVideoRowFrom(value: Record<string, unknown>): LegacyVideoRow {
  const text = (key: string): string | null => {
    const field = value[key];
    return typeof field === 'string' ? field : null;
  };
  const integer = (key: string): number | null => {
    const field = value[key];
    return typeof field === 'number' && Number.isInteger(field) ? field : null;
  };
  const id = integer('id');
  const lang = text('lang');
  const titleEn = text('title_en');
  if (id === null || lang === null || titleEn === null)
    throw new Error('legacy export row is malformed');
  return {
    id,
    lang,
    title_en: titleEn,
    title_ur: text('title_ur'),
    provider: text('provider'),
    ref: text('ref'),
    cat_key: text('cat_key'),
    cat_label: text('cat_label'),
    body_html: text('body_html'),
    published: text('published'),
    duration_s: integer('duration_s'),
  };
}

export function openSyntheticExport(): SyntheticExportSource {
  const database = new DatabaseSync(':memory:', { allowExtension: false });
  try {
    database.exec(readFileSync(DUMP_URL, 'utf8'));
    // From here on the export is evidence: nothing may change it.
    database.exec('PRAGMA query_only = ON;');
  } catch (error) {
    database.close();
    throw error;
  }
  const page = database.prepare(
    `SELECT ${COLUMNS} FROM legacy_video WHERE id > ? ORDER BY id LIMIT ?`,
  );
  const one = database.prepare(`SELECT ${COLUMNS} FROM legacy_video WHERE id = ?`);
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );

  return {
    rows(afterId, limit) {
      if (!Number.isInteger(afterId) || afterId < 0)
        throw new Error('invalid export cursor');
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error('invalid export page size');
      return page
        .all(afterId, limit)
        .map((row) => legacyVideoRowFrom(row as Record<string, unknown>));
    },
    row(id) {
      if (!Number.isInteger(id) || id < 1) return null;
      const found = one.get(id);
      return found === undefined
        ? null
        : legacyVideoRowFrom(found as Record<string, unknown>);
    },
    tables() {
      return tables.all().map((row) => String((row as Record<string, unknown>)['name']));
    },
    close() {
      if (database.isOpen) database.close();
    },
  };
}
