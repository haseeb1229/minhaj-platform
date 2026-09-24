import { MEDIA_LIMITS } from '@minhaj/contracts/media';

/**
 * How many repeated rows the Video and audio track forms offer, shared by the
 * forms that render them and the actions that read them — a FIXED ceiling, never a count the
 * browser supplies. Speakers are offered up to the domain's own bound; topics
 * up to twelve, as every other administration form offers.
 */
export const MEDIA_FORM_ROWS = Object.freeze({
  speakers: MEDIA_LIMITS.speakers,
  topics: 12,
});
