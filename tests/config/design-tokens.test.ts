import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * REBASELINE R1 — THE INTERIM IDENTITY'S CONTRAST, MEASURED.
 *
 * `globals.css` promises that every foreground/background pair meets WCAG 2.2
 * AA at its intended size. This test parses the `@theme` block itself and
 * computes the contrast ratio of every pair the components actually compose, so
 * a palette change that breaks a pair fails here rather than in a reader's eyes.
 * Text needs 4.5:1 (1.4.3); a control's boundary and the focus ring need 3:1
 * against what they sit on (1.4.11).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function tokens(): Promise<Record<string, string>> {
  const css = await readFile(
    path.join(repoRoot, 'apps/web/src/styles/globals.css'),
    'utf8',
  );
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const found: Record<string, string> = {};
  for (const match of theme.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/g)) {
    found[match[1]!] = match[2]!;
  }
  return found;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const LIGHT = ['surface', 'surface-raised', 'surface-sunken'] as const;

const TEXT: readonly (readonly [string, string])[] = [
  ...LIGHT.flatMap((ground) => [
    ['foreground', ground] as const,
    ['foreground-muted', ground] as const,
    ['action', ground] as const,
    ['accent', ground] as const,
  ]),
  ['action-foreground', 'action'],
  ['action-foreground', 'action-hover'],
  ['accent', 'accent-surface'],
  ['foreground', 'accent-surface'],
  ['foreground', 'highlight'],
  ['foreground-muted', 'highlight'],
  ['action', 'highlight'],
  ...(['ink', 'ink-raised'] as const).flatMap((ground) => [
    ['ink-foreground', ground] as const,
    ['ink-muted', ground] as const,
    ['ink-accent', ground] as const,
  ]),
  ['error', 'error-surface'],
  ['success', 'success-surface'],
  ['warning', 'warning-surface'],
  ['info', 'info-surface'],
];

const NON_TEXT: readonly (readonly [string, string])[] = [
  ...LIGHT.flatMap((ground) => [
    ['border-strong', ground] as const,
    ['focus', ground] as const,
  ]),
  ['ink-accent', 'ink'],
];

describe('the design tokens meet WCAG 2.2 AA', () => {
  it('declares every role the pairs below name, as a literal colour', async () => {
    const found = await tokens();
    for (const [foreground, background] of [...TEXT, ...NON_TEXT]) {
      expect(found[foreground], foreground).toMatch(/^#[0-9a-f]{6}$/);
      expect(found[background], background).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(TEXT)('%s text on %s is at least 4.5:1', async (foreground, background) => {
    const found = await tokens();
    expect(contrast(found[foreground]!, found[background]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)(
    '%s boundary on %s is at least 3:1',
    async (foreground, background) => {
      const found = await tokens();
      expect(contrast(found[foreground]!, found[background]!)).toBeGreaterThanOrEqual(3);
    },
  );
});
