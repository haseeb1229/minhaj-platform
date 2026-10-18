import { browserEnvironment } from './support.ts';

/**
 * Driving the browser run's simulated payment provider from a spec (Phase 27).
 *
 * The simulator runs inside `scripts/browser-server.mjs`, beside the web
 * server that is configured with its origin; a spec reaches it only through
 * the loopback control surface that process started
 * (`scripts/shared/stripe-simulator-control.mjs`), with the run's own token.
 * Nothing here holds a provider secret: the spec needs to hold and release
 * webhooks, complete or fail a checkout the way the provider would, and read
 * the simulator's own records — never to sign anything itself.
 *
 * ONE SPEC AT A TIME. The webhook mode is the simulator's, shared by the run;
 * only `donations.spec.ts` changes it, serially, and puts it back.
 */

interface DonationsRecord {
  readonly simulatorOrigin: string;
  readonly controlOrigin: string;
  readonly controlToken: string;
  readonly accountKey: string;
}

/** What the browser server recorded about the simulated provider. */
export function donationsFixture(): DonationsRecord {
  const donations = (browserEnvironment() as unknown as { donations?: DonationsRecord })
    .donations;
  if (donations === undefined) {
    throw new Error('The browser environment records no payment simulator.');
  }
  return donations;
}

/** Performs one allowlisted simulator operation and returns its result. */
export async function simulator<T = unknown>(
  op: string,
  ...args: readonly unknown[]
): Promise<T> {
  const { controlOrigin, controlToken } = donationsFixture();
  const response = await fetch(`${controlOrigin}/control`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${controlToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ op, args }),
  });
  const body = (await response.json()) as { result?: T; error?: string };
  if (!response.ok) {
    throw new Error(`Simulator ${op} failed: ${body.error ?? String(response.status)}`);
  }
  return body.result as T;
}

export type WebhookMode = 'deliver' | 'hold' | 'drop';

/**
 * Runs `body` with the simulator's webhooks in `mode`, and ALWAYS restores
 * delivery afterwards — a failed proof must not leave the next one without
 * its webhooks.
 */
export async function withWebhooks<T>(
  mode: WebhookMode,
  body: () => Promise<T>,
): Promise<T> {
  await simulator('setWebhookMode', mode);
  try {
    return await body();
  } finally {
    await simulator('setWebhookMode', 'deliver');
  }
}

/** The checkout session id a hosted-page address names. */
export function sessionOf(url: string): string {
  const match = /\/c\/pay\/(cs_[A-Za-z0-9_]+)$/u.exec(new URL(url).pathname);
  if (match?.[1] === undefined) throw new Error(`Not a hosted checkout page: ${url}`);
  return match[1];
}
