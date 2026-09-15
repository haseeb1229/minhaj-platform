import 'server-only';

import type {
  DeliveryOutcome,
  EmailProviderPort,
  OutboundMessage,
} from '@minhaj/contracts/platform';
import { Resend } from 'resend';

/**
 * The Resend `EmailProvider` adapter — the FIRST adapter behind the
 * abstraction, not a permanent platform dependency (ARCHITECTURE.md §4.6).
 *
 * Semantic owner: the Layer-0 `email` concern. It knows how to put bytes on
 * the wire and nothing else: not whether a message should be sent, not to
 * whom, not what it says. Every one of those belongs to the originating
 * context (§4.6.1), and an adapter that decided any of them would have become
 * the business layer.
 *
 * NO BUSINESS CONTEXT MAY IMPORT THIS, or `resend`, or reach `api.resend.com`.
 * That is enforced by an architecture test, not by convention.
 */

export interface ResendConfiguration {
  /**
   * The restricted sending credential.
   *
   * Absent in an environment where real sending is not enabled — local test
   * runs and CI — and its absence must not fail a build or a test. What it
   * must never do is silently degrade a REAL send into a pretend one, so an
   * adapter without a key reports itself unavailable and refuses to send
   * rather than returning success.
   */
  readonly apiKey: string | null;
  readonly senderAddress: string;
  readonly senderName: string;
  /** Hard ceiling on a single send, so a hung provider cannot hold a worker. */
  readonly timeoutMs: number;
}

/**
 * Classifies a provider failure into the only two classes the retry policy has.
 *
 * EXPORTED because it is a POLICY, not an implementation detail, and getting it
 * wrong is expensive in both directions: treating a permanent rejection as
 * transient retries a dead address until the budget is spent, and treating a
 * transient fault as permanent abandons a message that would have gone through
 * a second later. A decision with consequences like that is worth naming and
 * testing directly rather than only through the behaviour it produces.
 *
 * `429` is the one that has to be stated explicitly: it is a 4xx, and every
 * other 4xx is the provider saying "never", but this one means "not yet".
 */
export function classifyProviderStatus(status: number): 'transient' | 'permanent' {
  if (status === 429) return 'transient';
  return status >= 500 ? 'transient' : 'permanent';
}

/**
 * A short, normalised code. Never provider prose, which can echo the recipient
 * or the content that was rejected, and this value reaches an operator surface
 * (SECURITY_BASELINE.md §19.2).
 */
export function providerFailureCode(status: number | null, name: string): string {
  if (status !== null) return `http_${status}`;
  return name === 'AbortError' ? 'timeout' : 'network_error';
}

export function createResendProvider(
  configuration: ResendConfiguration,
): EmailProviderPort {
  const available = configuration.apiKey !== null && configuration.apiKey !== '';
  const client = available ? new Resend(configuration.apiKey ?? undefined) : null;
  const from = `${configuration.senderName} <${configuration.senderAddress}>`;

  return {
    providerName: 'resend',
    available,

    async send(message: OutboundMessage): Promise<DeliveryOutcome> {
      if (client === null) {
        // FAIL CLOSED, and say so honestly. A configured-but-keyless provider
        // returning "accepted" would mark a verification email sent that
        // nobody will ever receive.
        return {
          outcome: 'rejected',
          failureClass: 'permanent',
          failureCode: 'provider_not_configured',
        };
      }

      // The SDK's send options carry no `AbortSignal` in 6.27.0 — it builds its
      // own `fetch` call — so the ceiling is imposed by racing the call against
      // a timer. That bounds the DISPATCHER, which is what the ceiling is for:
      // one hung provider request must not hold a worker for as long as the
      // provider chooses to take.
      //
      // The in-flight request is not cancelled, and the outcome is reported as
      // TRANSIENT rather than as a failure, because "we stopped waiting" is not
      // "it did not arrive". The retry carries the same `Idempotency-Key`, so a
      // request that did land cannot produce a second message.
      let timer: ReturnType<typeof setTimeout> | undefined;

      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), configuration.timeoutMs);
      });

      try {
        const settled = await Promise.race([
          client.emails.send(
            {
              from,
              to: message.to,
              subject: message.subject,
              html: message.html,
              text: message.text,
            },
            {
              // Provider-side idempotency, on the SAME key the delivery row
              // carries. A retry after an ambiguous outcome — the request
              // succeeded but the response never arrived — cannot produce a
              // second message (ARCHITECTURE.md §4.6.1).
              idempotencyKey: message.idempotencyKey,
            },
          ),
          timeout,
        ]);

        if (settled === 'timeout') {
          return {
            outcome: 'rejected',
            failureClass: 'transient',
            failureCode: 'timeout',
          };
        }

        const response = settled;

        if (response.error) {
          const status =
            typeof (response.error as { statusCode?: number }).statusCode === 'number'
              ? (response.error as { statusCode: number }).statusCode
              : null;

          return {
            outcome: 'rejected',
            failureClass: status === null ? 'transient' : classifyProviderStatus(status),
            failureCode: providerFailureCode(
              status,
              response.error.name ?? 'provider_error',
            ),
          };
        }

        const id = response.data?.id;
        if (typeof id !== 'string' || id === '') {
          // Accepted without an identifier is not an outcome this adapter can
          // report honestly, so it is treated as transient rather than
          // fabricating a message id.
          return {
            outcome: 'rejected',
            failureClass: 'transient',
            failureCode: 'missing_message_id',
          };
        }

        return { outcome: 'accepted', providerMessageId: id };
      } catch (error) {
        const name = error instanceof Error ? error.name : 'unknown';
        return {
          outcome: 'rejected',
          failureClass: 'transient',
          failureCode: providerFailureCode(null, name),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
