import {
  tieTranslationNotes,
  translationNoteMarks,
  type TranslationNote,
} from '@minhaj/contracts/quran';

/**
 * WHERE A TRANSLATION'S NOTES ATTACH IN ITS TEXT (Quran Part 6) — PURE, so
 * what the reader draws is unit-tested.
 *
 * THE TEXT IS NEVER CHANGED. A mark a note answers (`tieTranslationNotes`) is
 * cut out of the text exactly as written — "٭", "*", "(1)" — so the page can
 * make THAT mark the way to its note; nothing is added, moved or removed, and
 * the pieces joined are the stored text, character for character. A mark no
 * note answers stays text. Notes the rule does not tie (which the service
 * refuses ever to save) are attached nowhere: they are still listed under the
 * Ayah, never placed by guesswork.
 */

export interface NoteSegment {
  readonly text: string;
  /** The index in the Ayah's notes of the note this mark opens, or null for text. */
  readonly note: number | null;
}

export function noteSegments(
  text: string,
  notes: readonly Pick<TranslationNote, 'marker'>[],
): readonly NoteSegment[] {
  const ties = notes.length === 0 ? null : tieTranslationNotes(text, notes);
  if (ties === null) return [{ text, note: null }];
  const marks = translationNoteMarks(text);
  const noteOf = new Map<number, number>();
  ties.forEach((mark, index) => {
    if (mark !== null) noteOf.set(mark, index);
  });

  const segments: NoteSegment[] = [];
  let at = 0;
  marks.forEach((mark, index) => {
    const note = noteOf.get(index);
    if (note === undefined) return;
    if (mark.start > at) segments.push({ text: text.slice(at, mark.start), note: null });
    segments.push({ text: text.slice(mark.start, mark.end), note });
    at = mark.end;
  });
  if (at < text.length) segments.push({ text: text.slice(at), note: null });
  return segments;
}

/** A note's paragraphs, as its source separated them by a blank line. */
export function noteParagraphs(text: string): readonly string[] {
  return text.split(/\n[\t ]*\n/).filter((paragraph) => paragraph.trim() !== '');
}
