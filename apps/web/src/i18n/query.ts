import type { QueryParams } from 'next-intl/navigation';

/**
 * Converts the current search parameters into the query shape the locale
 * navigation helpers accept.
 *
 * Its own module, and deliberately free of React, for two reasons. It is the
 * part of locale switching that can be wrong in a way markup does not show —
 * `?x=1&x=2` silently becoming `?x=2` — and the component that uses it is a
 * Client Component, which a Node test runner cannot render. Here it is a pure
 * function over a `URLSearchParams`, so the behaviour is proven directly.
 *
 * `Object.fromEntries(searchParams)` is the obvious one-liner and is the bug:
 * it keeps only the LAST value of a repeated key. Repeated keys are real —
 * ROUTE_MAP.md §2.3 makes filters query parameters, and a multi-select filter
 * is exactly this shape — so a single value stays a string and a repeated one
 * becomes the list it always was.
 *
 * Nothing here encodes anything. The values are handed to the URL builder as
 * decoded strings and it performs the encoding, so a value containing `&`, `=`
 * or a space survives a locale switch instead of splitting into new parameters.
 */
export function toQueryParams(searchParams: URLSearchParams): QueryParams {
  const query: Record<string, string | string[]> = {};

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    query[key] = values.length === 1 ? (values[0] as string) : values;
  }

  return query;
}
