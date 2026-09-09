/**
 * RTL-safe layout enforcement.
 *
 * Urdu and Arabic are RTL and are architectural requirements from day one
 * (ARCHITECTURE.md §9, ROUTE_MAP.md §1.2). Tailwind's physical-direction
 * utilities silently break them; the logical equivalents do not.
 * TECH_STACK.md §5: "Physical direction utilities (ml-*, pl-*) are prohibited
 * in layout code."
 *
 * Enforced with ESLint core `no-restricted-syntax` — no third-party plugin.
 *
 * Scope note: only DIRECTIONAL utilities are restricted. `mt-*`, `mb-*`,
 * `px-*`, `w-*` and `text-sm` carry no direction and are untouched. A rule that
 * flagged those would be abandoned within a week.
 */

/** Physical utility prefix → the logical utility that replaces it. */
export const physicalToLogicalUtilities = Object.freeze({
  // Margin
  ml: 'ms',
  mr: 'me',
  // Padding
  pl: 'ps',
  pr: 'pe',
  // Inset / positioning
  left: 'start',
  right: 'end',
  // Border width
  'border-l': 'border-s',
  'border-r': 'border-e',
  // Border radius — corners
  'rounded-l': 'rounded-s',
  'rounded-r': 'rounded-e',
  'rounded-tl': 'rounded-ss',
  'rounded-tr': 'rounded-se',
  'rounded-bl': 'rounded-es',
  'rounded-br': 'rounded-ee',
  // Scroll margin / padding
  'scroll-ml': 'scroll-ms',
  'scroll-mr': 'scroll-me',
  'scroll-pl': 'scroll-ps',
  'scroll-pr': 'scroll-pe',
});

/** Physical text alignment, float and clear → logical equivalent. */
export const physicalToLogicalAlignment = Object.freeze({
  'text-left': 'text-start',
  'text-right': 'text-end',
  'float-left': 'float-start',
  'float-right': 'float-end',
  'clear-left': 'clear-start',
  'clear-right': 'clear-end',
});

/**
 * Physical inline-style properties (the React camelCase form) → logical
 * equivalent. A style object bypasses className entirely, so it needs its own
 * gate.
 */
export const physicalToLogicalStyleProperties = Object.freeze({
  marginLeft: 'marginInlineStart',
  marginRight: 'marginInlineEnd',
  paddingLeft: 'paddingInlineStart',
  paddingRight: 'paddingInlineEnd',
  borderLeft: 'borderInlineStart',
  borderRight: 'borderInlineEnd',
  borderLeftWidth: 'borderInlineStartWidth',
  borderRightWidth: 'borderInlineEndWidth',
  left: 'insetInlineStart',
  right: 'insetInlineEnd',
});

/**
 * Inline-style properties whose PROPERTY name is fine but whose physical
 * VALUES are not.
 *
 * `textAlign` was previously listed as a prohibited property outright, which
 * rejected `style={{ textAlign: 'start' }}` — the very thing the RTL policy
 * asks for. The property is direction-neutral; only `left` and `right` are
 * physical. `start`, `end`, `center`, `justify` and the rest are legitimate.
 */
export const physicalStyleValues = Object.freeze({
  textAlign: {
    prohibited: { left: 'start', right: 'end' },
  },
  float: {
    prohibited: { left: 'inline-start', right: 'inline-end' },
  },
  clear: {
    prohibited: { left: 'inline-start', right: 'inline-end' },
  },
});

/** Escape a literal string for use inside a regular expression. */
function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Variant / modifier prefix that may precede a utility.
 *
 * Covers the bypasses independent review demonstrated:
 *   - responsive and state variants: `md:`, `hover:`, `focus-visible:`
 *   - arbitrary variants: `[&>*]:`, `data-[open]:`, `supports-[grid]:`
 *   - group and peer variants: `group-hover:`, `peer-focus:`
 *   - the important prefix: `!ml-4`, and `md:!ml-4`
 * Repeated any number of times, since variants stack.
 */
const VARIANT_PREFIX = '(?:(?:\\[[^\\]]*\\]|[A-Za-z0-9@_-]+(?:-\\[[^\\]]*\\])?):)*';

/** Optional `!` important prefix and optional `-` negative sign, in either order. */
const IMPORTANT_AND_SIGN = '[!-]{0,2}';

/** A utility value: an arbitrary `[…]` value, or a scale token. */
const UTILITY_VALUE = '(?:\\[[^\\]]*\\]|[A-Za-z0-9%./_-]+)';

/** Token boundary: start/end of string, or whitespace. */
const BOUNDARY_START = '(?:^|\\s)';
/** Trailing boundary also allows a `!` important SUFFIX, e.g. `ml-4!`. */
const BOUNDARY_END = '!?(?:\\s|$)';

/** Matches a valued utility such as `ml-4`, `md:!-ml-[3px]`, `ml-4!`. */
function utilityPattern(prefix) {
  const escaped = escapeForRegExp(prefix);
  return `${BOUNDARY_START}${VARIANT_PREFIX}${IMPORTANT_AND_SIGN}${escaped}-${UTILITY_VALUE}${BOUNDARY_END}`;
}

/** Matches a whole-token utility such as `text-left`, `md:!text-left`. */
function exactPattern(token) {
  const escaped = escapeForRegExp(token);
  return `${BOUNDARY_START}${VARIANT_PREFIX}${IMPORTANT_AND_SIGN}${escaped}${BOUNDARY_END}`;
}

/** The full set of prohibited class-token regexes, as source strings. */
export function prohibitedClassPatterns() {
  return [
    ...Object.keys(physicalToLogicalUtilities).map(utilityPattern),
    ...Object.keys(physicalToLogicalAlignment).map(exactPattern),
  ];
}

/**
 * Does this class string contain a prohibited physical-direction utility?
 *
 * Exported so the ESLint rule, the source scanner and the tests all share ONE
 * implementation. Two implementations would drift, and the drift would be
 * silent.
 */
export function findPhysicalDirectionUtilities(classValue) {
  const found = [];

  for (const [prefix, logical] of Object.entries(physicalToLogicalUtilities)) {
    if (new RegExp(utilityPattern(prefix)).test(classValue)) {
      found.push({ physical: prefix, logical });
    }
  }
  for (const [token, logical] of Object.entries(physicalToLogicalAlignment)) {
    if (new RegExp(exactPattern(token)).test(classValue)) {
      found.push({ physical: token, logical });
    }
  }

  return found;
}

function suggestion() {
  const utilities = Object.entries(physicalToLogicalUtilities)
    .map(([p, l]) => `${p}-* → ${l}-*`)
    .join(', ');
  const alignment = Object.entries(physicalToLogicalAlignment)
    .map(([p, l]) => `${p} → ${l}`)
    .join(', ');
  return `${utilities}, ${alignment}`;
}

const MESSAGE =
  `RTL: physical-direction Tailwind utilities are prohibited in layout code — ` +
  `they silently break Urdu and Arabic (TECH_STACK.md §5, ARCHITECTURE.md §9). ` +
  `Use the logical equivalent: ${suggestion()}.`;

const STYLE_MESSAGE =
  `RTL: physical-direction inline style properties are prohibited — they ` +
  `silently break Urdu and Arabic (TECH_STACK.md §5). Use the logical ` +
  `equivalent: ` +
  Object.entries(physicalToLogicalStyleProperties)
    .map(([p, l]) => `${p} → ${l}`)
    .join(', ') +
  '.';

/**
 * `no-restricted-syntax` selectors for prohibited class strings.
 *
 * Independent review showed that matching only `JSXAttribute > Literal` misses the class
 * string once it is lifted into a variable or passed to a helper. The
 * selectors below therefore match a prohibited token in ANY statically
 * knowable string or template literal, wherever it appears:
 *
 *   className="ml-4"                     — direct attribute
 *   const c = 'ml-4'                     — hoisted into a variable
 *   clsx('ml-4', x)                      — passed to a class helper
 *   `ml-4 ${x}`                          — template literal static text
 *
 * This deliberately stops at statically knowable strings. A whole-program
 * data-flow engine is out of scope and would be the wrong tool; a literal
 * containing `ml-4` is a styling mistake regardless of where it sits.
 */
export function rtlRestrictedSyntax() {
  const selectors = prohibitedClassPatterns().flatMap((pattern) => [
    { selector: `Literal[value=/${pattern}/]`, message: MESSAGE },
    { selector: `TemplateElement[value.raw=/${pattern}/]`, message: MESSAGE },
  ]);

  // Physical inline style PROPERTIES, in both identifier and string-key form.
  for (const property of Object.keys(physicalToLogicalStyleProperties)) {
    selectors.push({
      selector: `JSXAttribute[name.name='style'] ObjectExpression > Property > Identifier.key[name='${property}']`,
      message: STYLE_MESSAGE,
    });
    selectors.push({
      selector: `JSXAttribute[name.name='style'] ObjectExpression > Property > Literal.key[value='${property}']`,
      message: STYLE_MESSAGE,
    });
  }

  // Direction-neutral properties carrying a PHYSICAL VALUE.
  //
  // The property is matched together with its value, so `textAlign: 'start'`
  // passes and only `textAlign: 'left'` fails. Matching the property alone
  // rejected the correct code along with the incorrect.
  for (const [property, { prohibited }] of Object.entries(physicalStyleValues)) {
    for (const [value, logical] of Object.entries(prohibited)) {
      const message =
        `RTL: '${property}: "${value}"' is a physical direction and breaks ` +
        `Urdu and Arabic (TECH_STACK.md §5). Use '${property}: "${logical}"'.`;

      for (const keyForm of [
        `Identifier.key[name='${property}']`,
        `Literal.key[value='${property}']`,
      ]) {
        selectors.push({
          selector:
            `JSXAttribute[name.name='style'] ObjectExpression > ` +
            `Property:has(> ${keyForm}):has(> Literal.value[value='${value}'])`,
          message,
        });
      }
    }
  }

  return selectors;
}

/** Flat-config block applying the RTL rules to application source. */
export function rtlConfig({ appRoot = 'apps/web/src' } = {}) {
  return {
    name: 'minhaj/rtl/logical-properties',
    files: [`${appRoot}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-syntax': ['error', ...rtlRestrictedSyntax()],
    },
  };
}

/**
 * Physical CSS declarations prohibited in stylesheets, mapped to their logical
 * equivalent. Enforced by a dedicated check rather than ESLint, which does not
 * parse CSS.
 */
export const prohibitedCssProperties = Object.freeze({
  // Box model
  'margin-left': 'margin-inline-start',
  'margin-right': 'margin-inline-end',
  'padding-left': 'padding-inline-start',
  'padding-right': 'padding-inline-end',

  // Positioning. `left`/`right` were previously missing entirely, which is the
  // most common way a physical offset reaches a stylesheet.
  left: 'inset-inline-start',
  right: 'inset-inline-end',

  // Border shorthands
  'border-left': 'border-inline-start',
  'border-right': 'border-inline-end',

  // Border LONGHANDS. Each is a separate declaration a stylesheet can use on
  // its own, so listing only the shorthand left every one of these open.
  'border-left-width': 'border-inline-start-width',
  'border-left-style': 'border-inline-start-style',
  'border-left-color': 'border-inline-start-color',
  'border-right-width': 'border-inline-end-width',
  'border-right-style': 'border-inline-end-style',
  'border-right-color': 'border-inline-end-color',

  // Border radius corners
  'border-top-left-radius': 'border-start-start-radius',
  'border-top-right-radius': 'border-start-end-radius',
  'border-bottom-left-radius': 'border-end-start-radius',
  'border-bottom-right-radius': 'border-end-end-radius',

  // Scroll box model
  'scroll-margin-left': 'scroll-margin-inline-start',
  'scroll-margin-right': 'scroll-margin-inline-end',
  'scroll-padding-left': 'scroll-padding-inline-start',
  'scroll-padding-right': 'scroll-padding-inline-end',

  // Overflow and overscroll
  'overflow-x': 'overflow-inline',
  'overscroll-behavior-x': 'overscroll-behavior-inline',
});

/**
 * Physical VALUES that are only wrong for certain properties — `text-align`
 * and `float` accept `left`/`right`, which break RTL, but the property name
 * itself is fine.
 */
export const prohibitedCssValuePairs = Object.freeze([
  { property: 'text-align', value: 'left', logical: 'text-align: start' },
  { property: 'text-align', value: 'right', logical: 'text-align: end' },
  { property: 'float', value: 'left', logical: 'float: inline-start' },
  { property: 'float', value: 'right', logical: 'float: inline-end' },
  { property: 'clear', value: 'left', logical: 'clear: inline-start' },
  { property: 'clear', value: 'right', logical: 'clear: inline-end' },
]);

/**
 * Finds prohibited physical declarations in a stylesheet.
 *
 * Independent review showed the previous `String.includes` check was defeated by whitespace
 * formatting. This strips comments and normalises whitespace first, so
 * `text-align:left`, `text-align : left` and `text-align:\n  left` are all one
 * thing. Matching is anchored on a declaration boundary so `margin-left` is not
 * reported for `-webkit-margin-left` or for `scroll-margin-left`, which has its
 * own entry.
 */
export function findPhysicalCssDeclarations(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const normalised = withoutComments.replace(/\s+/g, ' ');
  const found = [];

  for (const [property, logical] of Object.entries(prohibitedCssProperties)) {
    const escaped = escapeForRegExp(property);
    // A declaration starts at `{`, `;`, or the beginning of the text.
    const pattern = new RegExp(`(?:^|[{;])\\s*${escaped}\\s*:`, 'i');
    if (pattern.test(normalised)) {
      found.push({ declaration: property, logical });
    }
  }

  for (const { property, value, logical } of prohibitedCssValuePairs) {
    const pattern = new RegExp(
      `(?:^|[{;])\\s*${escapeForRegExp(property)}\\s*:\\s*${escapeForRegExp(value)}\\s*(?:!important\\s*)?[;}]?`,
      'i',
    );
    if (pattern.test(normalised)) {
      found.push({ declaration: `${property}: ${value}`, logical });
    }
  }

  return found;
}
