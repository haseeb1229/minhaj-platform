import qrcode from 'qrcode-generator';

/**
 * What a person needs to add the factor to an authenticator app, derived from
 * the one-time `otpauth://` URI the enrolment returned.
 *
 * Pure and local: the URI never leaves the page that received it, and nothing
 * here stores, logs or sends it anywhere.
 */
export interface TotpSetup {
  /** The full provisioning URI: the QR payload and the "open in app" target. */
  readonly uri: string;
  /** The Base32 secret, upper-cased, for manual entry. */
  readonly secret: string;
  /** The same secret in groups of four, which is how people copy it reliably. */
  readonly groupedSecret: string;
}

const BASE32 = /^[A-Z2-7]+=*$/u;

/**
 * Reads the setup key out of a TOTP provisioning URI.
 *
 * Returns `null` for anything that is not a well-formed `otpauth://totp/` URI
 * with a Base32 secret, so a caller can fall back to showing the URI as it is
 * rather than presenting a key that might be wrong.
 */
export function parseTotpSetup(uri: string): TotpSetup | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'otpauth:' || url.host.toLowerCase() !== 'totp') return null;

  const secret = (url.searchParams.get('secret') ?? '')
    .replace(/\s+/gu, '')
    .toUpperCase();
  if (secret.length < 16 || !BASE32.test(secret)) return null;

  const unpadded = secret.replace(/=+$/u, '');
  const groupedSecret = unpadded.match(/.{1,4}/gu)?.join(' ') ?? unpadded;
  return { uri, secret: unpadded, groupedSecret };
}

/** The dark modules of a QR code for `text`, row by row. */
export function qrModules(text: string): boolean[][] {
  // Type 0 picks the smallest version that fits; level M tolerates ~15% damage,
  // the usual choice for a code read off a screen.
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => code.isDark(row, column)),
  );
}

/**
 * One SVG path drawing every dark module as a unit square, offset by the
 * quiet zone. A single path keeps the markup small and avoids raw HTML.
 */
export function qrPath(
  modules: readonly (readonly boolean[])[],
  quietZone: number,
): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`);
    });
  });
  return parts.join('');
}
