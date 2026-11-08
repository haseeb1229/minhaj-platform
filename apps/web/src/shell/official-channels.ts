/**
 * THE ORGANISATION'S OFFICIAL CHANNELS, as the footer lists them (R2).
 *
 * EVIDENCE, NOT GUESSWORK. Each address is exactly the one minhaj.org's own
 * footer links (English, Urdu and Arabic home pages, captured 2026-11-06 for
 * the R2 ecosystem study): the organisation's YouTube, Facebook and X
 * accounts, and its publisher pages on the two app stores ("Minhaj
 * Publications"). No other account is listed, and an address is changed only
 * on the same evidence.
 *
 * OUTBOUND LINKS ONLY. Nothing here is fetched, embedded or tracked: a browser
 * leaves for one of these only when the visitor follows the link. Labelled by
 * platform name, which is the same in every interface language.
 */
export const OFFICIAL_CHANNELS = Object.freeze([
  { id: 'youtube', name: 'YouTube', href: 'https://www.youtube.com/DrQadri' },
  { id: 'facebook', name: 'Facebook', href: 'https://www.facebook.com/MinhajulQuran' },
  { id: 'x', name: 'X', href: 'https://twitter.com/TahirulQadri' },
  {
    id: 'app-store',
    name: 'App Store',
    href: 'https://apps.apple.com/us/developer/minhaj-publications/id998868018',
  },
  {
    id: 'google-play',
    name: 'Google Play',
    href: 'https://play.google.com/store/apps/dev?id=6490820456874948658',
  },
] as const);
