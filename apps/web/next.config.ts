import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Next.js configuration.
 *
 * The next-intl plugin resolves `src/i18n/request.ts` — one of its default
 * locations — and aliases it so the server can load per-request configuration.
 * It is the only wiring the library needs at build time; the routing rules
 * themselves live in `src/i18n/routing.ts`, not here.
 *
 * Deliberately minimal otherwise. Security headers, image domains and cache
 * directives belong to the phases that introduce them.
 */
const withNextIntl = createNextIntlPlugin();

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

export default withNextIntl(nextConfig);
