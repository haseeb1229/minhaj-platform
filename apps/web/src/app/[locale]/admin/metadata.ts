import type { Metadata } from 'next';
import type {
  MessageKeys,
  Messages,
  NamespaceKeys,
  NestedKeyOf,
  NestedValueOf,
} from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';

/**
 * EVERY ADMINISTRATIVE PAGE NAMES ITSELF (R2, audit F15). The admin layout's
 * title template turns the page's own name into "Accounts · Administration ·
 * One Minhaj", so an operator with several tabs open, and a screen reader
 * announcing a new page, hears which page this is — not the bare area name on
 * every one.
 *
 * The name is the page's own heading wherever the heading is a fixed message;
 * a record's page is named for its kind ("Video", "Fatwa category"), never by
 * reading the record — a title is not worth a database read, and the record's
 * own name is the page's heading.
 *
 * Never indexed, on the page as on the layout: the administrative surface is
 * the platform's privileged shape.
 */
type Namespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;
type KeyIn<N extends Namespace> = MessageKeys<
  NestedValueOf<Messages, N>,
  NestedKeyOf<NestedValueOf<Messages, N>>
>;

export function adminPageMetadata<N extends Namespace>(namespace: N, key: KeyIn<N>) {
  return async function generateMetadata({
    params,
  }: {
    readonly params: Promise<{ readonly locale: string }>;
  }): Promise<Metadata> {
    const locale = await requireLocale(params);
    // The signature has already proved `key` is a message of `namespace`, and
    // tests/shell/admin-metadata.test.ts that every page's is a plain one. The
    // translator cannot re-derive its own key and argument types for a
    // namespace that is still generic here, so it is read as that lookup.
    const t = (await getTranslations({ locale, namespace })) as unknown as (
      key: string,
    ) => string;
    return { title: t(key), robots: { index: false, follow: false } };
  };
}
