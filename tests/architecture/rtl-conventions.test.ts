import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findPhysicalCssDeclarations,
  findPhysicalDirectionUtilities,
  physicalStyleValues,
  physicalToLogicalAlignment,
  physicalToLogicalStyleProperties,
  physicalToLogicalUtilities,
} from '../../packages/config/eslint/rtl.js';
import { repoRoot, validateRtl } from './architecture-harness.ts';

/**
 * RTL-safe layout conventions (TECH_STACK.md §5, ARCHITECTURE.md §9).
 *
 * Urdu and Arabic are RTL from day one. Physical-direction layout breaks them
 * silently — the page renders, it is simply wrong — which is exactly the class
 * of defect a mechanical gate is for.
 *
 * Every case below is a bypass independent review demonstrated against the previous rule.
 */

async function rtlViolations(root: string) {
  const { violations } = await validateRtl([path.join(repoRoot, root)]);
  return violations;
}

/** Runs the RTL scanner over a fixture WORKSPACE tree, via discovery. */
async function rtlWorkspaceViolations(root: string) {
  const { violations } = await validateRtl(null, path.join(repoRoot, root));
  return violations;
}

describe('production source honours the convention', () => {
  it('reports no RTL violation anywhere in apps/web', async () => {
    const violations = await rtlViolations('apps/web/src');

    expect(violations).toEqual([]);
  });
});

describe('B5 — class-string bypasses are closed', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['a class string hoisted into a variable', 'bypass-variable.tsx'],
    ['a class string passed to a helper such as clsx()', 'bypass-helper.tsx'],
    ['important, arbitrary, state and negative variants', 'bypass-variants.tsx'],
    ['static text inside a template literal', 'bypass-template.tsx'],
  ];

  for (const [description, fixture] of cases) {
    it(`rejects a physical utility in ${description}`, async () => {
      const violations = await rtlViolations('tests/fixtures/rtl');
      const forFixture = violations.filter((violation) =>
        violation.file.endsWith(fixture),
      );

      expect(forFixture.length).toBeGreaterThan(0);
      expect(forFixture[0]?.rule).toBe('physical-direction-utility');
    });
  }

  it('rejects physical inline style properties', async () => {
    const violations = await rtlViolations('tests/fixtures/rtl');
    const forFixture = violations.filter((violation) =>
      violation.file.endsWith('bypass-inline-style.tsx'),
    );

    expect(forFixture.length).toBeGreaterThan(0);
    expect(forFixture.map((violation) => violation.rule)).toContain(
      'physical-inline-style',
    );
  });
});

describe('B5 — the class matcher against every variant form', () => {
  const mustReject = [
    'ml-4',
    '!ml-4', // important prefix
    'ml-4!', // important suffix
    'md:!ml-4', // variant + important
    '-mr-2', // negative
    'md:-mr-[3px]', // variant + negative + arbitrary value
    'hover:focus:pr-2', // stacked state variants
    '[&>*]:ml-2', // arbitrary variant
    'data-[open]:pl-4', // data attribute variant
    'group-hover:ml-1', // group variant
    'supports-[grid]:mr-2', // supports variant
    'text-left',
    'md:!text-left',
    'rounded-tl-lg',
    'left-0',
  ];

  for (const value of mustReject) {
    it(`rejects "${value}"`, () => {
      expect(findPhysicalDirectionUtilities(value)).not.toEqual([]);
    });
  }

  it('catches every physical utility in its plain form', () => {
    for (const [physical, logical] of Object.entries(physicalToLogicalUtilities)) {
      expect(findPhysicalDirectionUtilities(`${physical}-4`)).toContainEqual({
        physical,
        logical,
      });
    }
  });

  it('catches every physical alignment token', () => {
    for (const [physical, logical] of Object.entries(physicalToLogicalAlignment)) {
      expect(findPhysicalDirectionUtilities(physical)).toContainEqual({
        physical,
        logical,
      });
    }
  });
});

describe('B5 — legitimate styling still passes', () => {
  const mustAllow = [
    'ms-4',
    'me-2',
    'ps-6',
    'pe-6',
    'border-s-2',
    'text-start',
    'text-end',
    // Direction-neutral utilities. A rule flagging these would be abandoned.
    'mt-4 mb-2 my-8 mx-auto',
    'px-6 py-16 p-4',
    'w-full h-screen min-h-screen max-w-2xl',
    'flex flex-col gap-4 items-center justify-center',
    'text-sm text-2xl font-medium font-semibold',
    'rounded-lg border-2',
  ];

  for (const value of mustAllow) {
    it(`allows "${value}"`, () => {
      expect(findPhysicalDirectionUtilities(value)).toEqual([]);
    });
  }

  it('allows every logical replacement', () => {
    for (const logical of Object.values(physicalToLogicalUtilities)) {
      expect(findPhysicalDirectionUtilities(`${logical}-4`)).toEqual([]);
    }
    for (const logical of Object.values(physicalToLogicalAlignment)) {
      expect(findPhysicalDirectionUtilities(logical)).toEqual([]);
    }
  });
});

describe('B5 — stylesheet scanning survives formatting', () => {
  const mustReject: readonly (readonly [string, string])[] = [
    ['no whitespace', '.a{text-align:left}'],
    ['spaces around the colon', '.a{text-align : left ;}'],
    ['a newline before the value', '.a{text-align:\n  left;}'],
    ['a physical margin', '.a{margin-left:4px}'],
    ['!important', '.a{margin-left:4px!important}'],
    ['a physical corner radius', '.a{border-top-left-radius:4px}'],
    ['a physical float', '.a{float:right}'],
    ['a physical padding', '.a{padding-right:1rem}'],
  ];

  for (const [description, css] of mustReject) {
    it(`rejects ${description}`, () => {
      expect(findPhysicalCssDeclarations(css)).not.toEqual([]);
    });
  }

  const mustAllow: readonly (readonly [string, string])[] = [
    ['logical margin', '.a{margin-inline-start:4px}'],
    ['logical alignment', '.a{text-align:start}'],
    ['direction-neutral declarations', '.a{margin-block:0;padding:4px;width:100%}'],
    ['a comment naming a prohibited property', '/* margin-left */ .a{margin-block:0}'],
  ];

  for (const [description, css] of mustAllow) {
    it(`allows ${description}`, () => {
      expect(findPhysicalCssDeclarations(css)).toEqual([]);
    });
  }
});

describe('the inline-style map covers the prohibited properties', () => {
  it('names every physical direction property independent review reported', () => {
    for (const property of [
      'marginLeft',
      'marginRight',
      'paddingLeft',
      'paddingRight',
      'left',
      'right',
    ]) {
      expect(Object.keys(physicalToLogicalStyleProperties)).toContain(property);
    }
  });
});

describe('R1 — physical CSS properties the second review found missing', () => {
  // Each property is asserted INDIVIDUALLY, so a table entry cannot regress
  // unnoticed behind a passing sibling.
  const mustReject: readonly (readonly [string, string])[] = [
    ['left', '.a{left:0}'],
    ['right', '.a{right:0}'],
    ['border-left-width', '.a{border-left-width:1px}'],
    ['border-left-style', '.a{border-left-style:solid}'],
    ['border-left-color', '.a{border-left-color:red}'],
    ['border-right-width', '.a{border-right-width:1px}'],
    ['border-right-style', '.a{border-right-style:dashed}'],
    ['border-right-color', '.a{border-right-color:blue}'],
    ['overflow-x', '.a{overflow-x:auto}'],
  ];

  for (const [property, css] of mustReject) {
    it(`rejects '${property}'`, () => {
      const found = findPhysicalCssDeclarations(css);

      expect(found.length, `${property} must be rejected`).toBeGreaterThan(0);
      expect(found[0]?.declaration).toBe(property);
    });
  }

  it('rejects them with no whitespace at all', () => {
    expect(
      findPhysicalCssDeclarations('.a{left:0;right:0;border-left-width:1px}'),
    ).not.toEqual([]);
  });

  it('rejects them across newlines and extra spacing', () => {
    const css = ['.a {', '  border-right-color :  red ;', '}'].join('\n');

    expect(findPhysicalCssDeclarations(css)).not.toEqual([]);
  });

  it('ignores a prohibited property named only inside a comment', () => {
    expect(
      findPhysicalCssDeclarations('/* left: 0 is prohibited */ .a{inset-inline-start:0}'),
    ).toEqual([]);
  });

  it('allows the logical equivalents', () => {
    for (const css of [
      '.a{inset-inline-start:0}',
      '.a{inset-inline-end:0}',
      '.a{border-inline-start-width:1px}',
      '.a{border-inline-end-color:red}',
      '.a{overflow-inline:auto}',
    ]) {
      expect(findPhysicalCssDeclarations(css), css).toEqual([]);
    }
  });

  it('allows direction-neutral properties that merely look similar', () => {
    for (const css of [
      '.a{top:0;bottom:0}',
      '.a{border-top-width:1px}',
      '.a{overflow-y:scroll}',
      '.a{margin-block:0}',
    ]) {
      expect(findPhysicalCssDeclarations(css), css).toEqual([]);
    }
  });
});

describe('R2 — textAlign is judged by VALUE, not by existing', () => {
  it('no longer lists textAlign as a prohibited property', () => {
    // Listing the property outright rejected `textAlign: 'start'` — the very
    // thing the RTL policy asks for. That was the regression.
    expect(Object.keys(physicalToLogicalStyleProperties)).not.toContain('textAlign');
  });

  it('declares textAlign as a value-checked property', () => {
    expect(Object.keys(physicalStyleValues)).toContain('textAlign');
    expect(physicalStyleValues['textAlign']?.prohibited).toEqual({
      left: 'start',
      right: 'end',
    });
  });

  it('ALLOWS logical and neutral textAlign values', async () => {
    const violations = await rtlViolations('tests/fixtures/rtl-values/ok');

    expect(violations, 'start/end/center/justify must all be permitted').toEqual([]);
  });

  it('REJECTS physical textAlign values', async () => {
    const violations = await rtlViolations('tests/fixtures/rtl-values/bad');
    const values = violations.filter(
      (violation) => violation.rule === 'physical-inline-style-value',
    );

    expect(values.length).toBe(2);
    expect(values.map((violation) => violation.detail).sort()).toEqual([
      "textAlign: 'left'",
      "textAlign: 'right'",
    ]);
  });
});

describe('R1 — a future workspace is discovered and validated', () => {
  it('scans a workspace that did not exist when the scanner was written', async () => {
    // Nothing here invents `packages/ui`. The fixture simply proves that when
    // such a workspace appears, its CSS and TSX do not silently escape RTL
    // validation the way a hard-coded root list would have allowed.
    const violations = await rtlWorkspaceViolations('tests/fixtures/future-workspace');

    const rules = new Set(violations.map((violation) => violation.rule));

    expect(rules.has('physical-direction-utility')).toBe(true);
    expect(rules.has('physical-css-declaration')).toBe(true);

    const declarations = violations
      .filter((violation) => violation.rule === 'physical-css-declaration')
      .map((violation) => violation.detail)
      .sort();

    expect(declarations).toEqual([
      'border-left-width',
      'left',
      'margin-left',
      'text-align: left',
    ]);
  });
});
