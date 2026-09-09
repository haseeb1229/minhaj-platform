// An ORDINARY barrel that re-exports a valid Server Action alongside
// server-only code. The barrel carries no directive, so it is not a boundary
// and does not inherit one from what it re-exports.
export { sendMessage } from '@/actions/send-message';
export { createLogger } from '@minhaj/server-core';
