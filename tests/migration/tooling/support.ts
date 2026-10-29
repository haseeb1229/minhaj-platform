import type { SourcePolicy, SourceRecord } from '@minhaj/contracts/migration';

/**
 * Shared, synthetic test inputs for the migration tooling suites. Nothing here
 * names a real host: every scope is `*.fixture.invalid` or `*.example.invalid`.
 */

export const TEST_POLICY: SourcePolicy = Object.freeze({
  minIntervalMs: 0,
  maxConcurrency: 1,
  maxAttempts: 3,
  timeoutMs: 1000,
  maxBodyBytes: 64 * 1024,
  maxRedirects: 3,
});

export function fixtureSource(overrides: Partial<SourceRecord> = {}): SourceRecord {
  const now = new Date('2026-10-23T00:00:00Z');
  return {
    id: '00000000-0000-4000-8000-000000000001',
    key: 'fixture-videos',
    name: 'FIXTURE videos',
    authorityKind: 'fixture',
    accessMethod: 'http',
    contentKind: 'media.video',
    baseUrl: 'http://videos.fixture.invalid/',
    hosts: ['videos.fixture.invalid'],
    assetHosts: [],
    authorisationReference: null,
    authorisedOn: null,
    licensingEvidence: null,
    policyNotes: null,
    defaultLanguageCode: 'ur',
    policy: TEST_POLICY,
    state: 'active',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
