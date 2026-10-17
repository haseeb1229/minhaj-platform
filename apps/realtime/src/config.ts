import 'server-only';

/**
 * Where the realtime process listens (Phase 25).
 *
 * FAIL FAST, NAME ONLY. A bad value is a process that refuses to start, with
 * the variable's NAME in the error and never its value (SECURITY_BASELINE.md
 * §18.1, §19.2) — the same contract `parseServerEnv` keeps for the web
 * environment, which the realtime process also parses.
 *
 * An empty string is treated as unset, as everywhere else in the platform's
 * environment handling: copying a valueless `.env.example` yields
 * `REALTIME_PORT=` and must mean "use the default".
 *
 * Validated by hand rather than with a Zod schema: this workspace may import
 * only Node built-ins, `socket.io` and the platform's own packages, and two
 * scalar variables do not justify widening that list.
 */

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3200;

/**
 * A host name or literal address to bind: DNS labels, IPv4, or IPv6 (bare or
 * bracketed). Deliberately narrow — no scheme, path, credentials or space.
 */
const HOST_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[?[0-9A-Fa-f:.]+\]?)$/;
const PORT_PATTERN = /^[0-9]{1,5}$/;

function invalid(name: string, rule: string): Error {
  return new Error(
    [
      'Invalid realtime environment configuration.',
      `  - ${name}: ${rule}`,
      '',
      'Values are never printed, only variable names.',
    ].join('\n'),
  );
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

export function realtimeAddressFrom(source: Record<string, string | undefined>): {
  host: string;
  port: number;
} {
  const rawHost = present(source['REALTIME_HOST']);
  const rawPort = present(source['REALTIME_PORT']);

  let host = DEFAULT_HOST;
  if (rawHost !== undefined) {
    if (rawHost.length > 253 || !HOST_PATTERN.test(rawHost)) {
      throw invalid('REALTIME_HOST', 'must be a host name or an IP address.');
    }
    host =
      rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  }

  let port = DEFAULT_PORT;
  if (rawPort !== undefined) {
    const parsed = PORT_PATTERN.test(rawPort) ? Number(rawPort) : Number.NaN;
    // Port 0 (ephemeral) is a test affordance of `startRealtimeServer`, never a
    // deployment value: the proxy must know where to find the process.
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      throw invalid('REALTIME_PORT', 'must be an integer from 1 to 65535.');
    }
    port = parsed;
  }

  return { host, port };
}
