// FIXTURE — MUST PASS. The EXPLICIT `/index` form of the same public entry.
// TypeScript resolves both spellings to the same file, so both are the public
// interface and both must be accepted.
export { isCurrentlyEnrolled } from '@/contexts/learning/index';
