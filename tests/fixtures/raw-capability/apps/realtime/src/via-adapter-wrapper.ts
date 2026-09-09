// FIXTURE — MUST FAIL. The adapter boundary stop cannot hide the database
// workspace from realtime when a neutral wrapper is placed before it.
export { createMessageStore } from '../../../packages/wrapper/src/adapter-wrapper';
