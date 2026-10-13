'use client';

import { useEffect, useRef } from 'react';

import { recordFatwaRead } from './read-actions';

/**
 * Counts one read of a published ruling — the only input to
 * `/fatwa?sort=popular`.
 *
 * A POST, AFTER RENDER, ONCE. Viewing a page changes nothing on the server: the
 * count is a Server Action this component calls once the page has mounted in a
 * browser, so a crawler following links, a prefetch and a GET increment
 * nothing. The ref keeps a development double-mount from sending twice.
 *
 * IT CARRIES THE SLUG AND NOTHING ELSE — no cookie it sets, no storage, no
 * fingerprint, no identifier of the reader. It renders nothing and a failure
 * is invisible: a count is never worth a broken page.
 */
export function ReadBeacon({ slug }: { readonly slug: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    recordFatwaRead(slug).catch(() => undefined);
  }, [slug]);

  return null;
}
