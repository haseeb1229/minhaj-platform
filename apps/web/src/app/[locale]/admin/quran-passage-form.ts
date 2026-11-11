import { SURAH_AYAH_COUNTS, readStartSeconds } from '@minhaj/contracts/passage';

/*
 * Quran Part 8 — reading the Quran passages field set's submissions, shared by
 * the Library and Media administrative actions (`./quran-passages.tsx`).
 */

/**
 * The named change a passage form submitted, read field by field (no mass
 * assignment). An empty "to" is the "from" Ayah alone; an empty "from" is the
 * whole Surah. What is read here is only the shape: the domain schema decides.
 */
export function passageChangeOf(form: FormData, timed: boolean): Record<string, unknown> {
  const op = form.get('op');
  const integer = (field: string): number | null => {
    const raw = form.get(field);
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const parsed = Number(raw.trim());
    return Number.isInteger(parsed) ? parsed : Number.NaN;
  };
  if (op === 'add') {
    const surah = integer('surah');
    const from = integer('ayahFrom');
    const to = integer('ayahTo');
    const count = surah === null ? null : (SURAH_AYAH_COUNTS[surah - 1] ?? null);
    const passage = {
      surah,
      ayahFrom: from ?? 1,
      ayahTo: to ?? (from === null ? count : from),
    };
    if (!timed) return { op, passage };
    const raw = form.get('start');
    return {
      op,
      passage: {
        ...passage,
        startSeconds: readStartSeconds(typeof raw === 'string' ? raw : null),
      },
    };
  }
  if (op === 'move')
    return { op, position: integer('position'), direction: form.get('direction') };
  return { op, position: integer('position') };
}
