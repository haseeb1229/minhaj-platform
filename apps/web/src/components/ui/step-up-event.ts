/**
 * The browser event a step-up prompt dispatches on `window` once a grant is
 * earned (R2, audit F35). A form refused with `step-up-required` listens for
 * it and sends its held submission again. It carries the purpose for anyone
 * who wants it, and no authority: every resubmission is re-checked in full on
 * the server.
 */
export const STEP_UP_GRANTED = 'minhaj:step-up-granted';

/**
 * The step-up prompt's own anchor for `purpose`: where a resumed page lands,
 * and how the prompt knows it was just confirmed. Pure and client-safe, so
 * the prompt island and the server's purpose-bound return-to share it.
 */
export function stepUpAnchor(purpose: string): string {
  return `step-up-${purpose}`;
}
