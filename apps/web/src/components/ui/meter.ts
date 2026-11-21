/**
 * A METER'S FILL WITHOUT A STYLE ATTRIBUTE (shared since the Teacher area's R2
 * rebuild; first written for My Minhaj's `ProgressMeter`).
 *
 * The platform's Content Security Policy is `style-src 'self'`, which refuses
 * an inline `style` attribute in server-rendered markup — so a width written
 * as `style={{ inlineSize: '40%' }}` never applies, and the bar draws full.
 * Tailwind sees only classes written out in full, so the widths are a FIXED
 * table of twenty-one steps of five percent rather than an interpolation.
 *
 * PURE, and free of React, so a server component and a client island can
 * both read it. The words beside a meter carry its meaning; the bar repeats
 * them for a sighted reader.
 */
const METER_WIDTHS = [
  'w-0',
  'w-[5%]',
  'w-[10%]',
  'w-[15%]',
  'w-[20%]',
  'w-[25%]',
  'w-[30%]',
  'w-[35%]',
  'w-[40%]',
  'w-[45%]',
  'w-[50%]',
  'w-[55%]',
  'w-[60%]',
  'w-[65%]',
  'w-[70%]',
  'w-[75%]',
  'w-[80%]',
  'w-[85%]',
  'w-[90%]',
  'w-[95%]',
  'w-full',
] as const;

/** The fill class for a percentage, to the nearest five; out-of-range values are clamped. */
export function meterWidthClass(percent: number): string {
  const safe = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  return METER_WIDTHS[Math.round(safe / 5)] ?? 'w-0';
}

/** How far through something is, as a percentage of its whole; 0 for an empty whole. */
export function meterPercent(done: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return (Math.min(Math.max(done, 0), whole) / whole) * 100;
}
