import { createContext } from 'react';

/**
 * What the composer may ask of the realtime island, when there is one
 * (DELIVERY_PLAN.md Phase 25).
 *
 * A SEPARATE MODULE ON PURPOSE. The composer also serves the support desk's
 * audited conversation page, which never opens a socket. Reading this context
 * costs that page nothing: the transport client lives in `live.client.tsx`,
 * which only the person-facing conversation screen renders, so the socket
 * library reaches no bundle but theirs. Without a provider the value is
 * `null` and the composer is exactly the Phase-24 form.
 *
 * `unsent` IS NOT A FAILURE THE PERSON SEES. It means the transport could not
 * say whether the message was stored — not connected, timed out, an outage —
 * and the composer then submits the SAME operation through the Server Action.
 * The operation identifier makes that retry the same message, never a second
 * one. `refused` is the service's own answer, worded like the web path's.
 */

export type LiveSendOutcome =
  | { readonly state: 'sent' }
  | { readonly state: 'refused'; readonly failure: string }
  | { readonly state: 'unsent' };

export interface LiveSendInput {
  readonly operationId: string;
  readonly body: string;
  readonly attachmentIds: readonly string[];
}

export interface LiveComposer {
  /** Sending through the transport is possible right now. */
  readonly ready: boolean;
  send(input: LiveSendInput): Promise<LiveSendOutcome>;
  /** The person is (or stopped) writing. Throttled and cleared by the island. */
  typing(active: boolean): void;
}

export const LiveComposerContext = createContext<LiveComposer | null>(null);
