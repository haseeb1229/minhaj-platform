import { MEDIA_LIMITS } from '@minhaj/contracts/media';

/**
 * How many repeated rows the Video form offers, shared by the form that renders
 * them and the action that reads them — a FIXED ceiling, never a count the
 * browser supplies. Speakers are offered up to the domain's own bound; topics
 * up to twelve, as every other administration form offers.
 */
export const VIDEO_FORM_ROWS = Object.freeze({
  speakers: MEDIA_LIMITS.speakers,
  topics: 12,
});
