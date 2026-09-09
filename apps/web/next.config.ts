import type { NextConfig } from 'next';

/**
 * Next.js configuration — Phase 0B.
 *
 * Minimal by design. Locale routing (ROUTE_MAP.md §1), security headers,
 * image domains and cache directives belong to the phases that introduce them.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Workspace packages are TypeScript source, compiled by the app's build.
  transpilePackages: ['@minhaj/contracts', '@minhaj/server-core'],

  typescript: {
    // A type error must fail the build. Never relaxed to make a build pass.
    ignoreBuildErrors: false,
  },

  // Linting is its own pipeline step (`npm run lint`) running the workspace
  // flat config, which carries the architecture rules. Next 16 no longer runs
  // ESLint during `next build`, so there is nothing to disable here.
};

export default nextConfig;
