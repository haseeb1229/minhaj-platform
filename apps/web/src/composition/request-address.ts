import 'server-only';
import { headers } from 'next/headers';
import { serverEnv } from '@/config/server-env';
export function clientAddressFrom(source: Headers, trustProxyHeaders: boolean): string {
  if (!trustProxyHeaders) return 'direct';

  const forwarded = source.get('x-forwarded-for');
  if (forwarded !== null) {
    // The FIRST entry is the originating client; later ones are the proxies it
    // passed through.
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }

  return source.get('x-real-ip') ?? 'unknown';
}

export async function publicClientAddress(): Promise<string> {
  return clientAddressFrom(await headers(), serverEnv().TRUST_PROXY_HEADERS);
}
