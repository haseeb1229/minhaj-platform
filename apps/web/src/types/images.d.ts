/**
 * Phase 30-R. A statically imported PNG — the official brand lockup — is the
 * metadata the bundler emits for it: its hashed address and its intrinsic size.
 * Declared here, beside the other committed declarations, because Next's own
 * `next-env.d.ts` is generated output that a fresh checkout does not have until
 * the first build — and the type check runs before the build. Stated as its
 * plain shape: this platform names no image optimiser anywhere.
 */
declare module '*.png' {
  const image: {
    readonly src: string;
    readonly width: number;
    readonly height: number;
    readonly blurDataURL?: string;
    readonly blurWidth?: number;
    readonly blurHeight?: number;
  };
  export default image;
}
