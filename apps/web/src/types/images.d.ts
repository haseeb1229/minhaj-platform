/**
 * Phase 30-R. A statically imported PNG — the official brand lockup — is the
 * metadata Next's bundler emits for it: its hashed address and its intrinsic
 * size. Declared here, beside the other committed declarations, because Next's
 * own `next-env.d.ts` is generated output that a fresh checkout does not have
 * until the first build — and the type check runs before the build.
 */
declare module '*.png' {
  import type { StaticImageData } from 'next/image';

  const image: StaticImageData;
  export default image;
}
