import type { NextConfig } from 'next';

/**
 * Fixture Next app. Its ONLY purpose is to prove that the server-only boundary
 * is enforced by a real Next build, not merely by a Vitest import assertion.
 */
const nextConfig: NextConfig = {
  transpilePackages: ['@minhaj/contracts', '@minhaj/server-core'],
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
