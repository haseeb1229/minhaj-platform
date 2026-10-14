import 'server-only';

import { createNewsletter } from '@minhaj/database';

import {
  createNewsletterLinkReader,
  type NewsletterLinkReader,
} from '@/contexts/personalisation-notifications';

/**
 * The newsletter's PUBLIC read root — what `/newsletter/confirm` and
 * `/newsletter/unsubscribe` render from when an emailed link is opened.
 *
 * It answers one question, whether a link is still usable, by hashing the
 * presented token and comparing. It reads no session, no secret and no server
 * environment, so an anonymous page importing it acquires none of them
 * (ARCHITECTURE.md §8.1, §8.3.1). Opening the link changes nothing: the
 * confirming and unsubscribing mutations are POSTs (SECURITY_BASELINE.md §7.4).
 */
let reader: NewsletterLinkReader | null = null;

export function newsletterReadRuntime(): NewsletterLinkReader {
  return (reader ??= createNewsletterLinkReader(createNewsletter()));
}
