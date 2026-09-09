// FIXTURE — MUST FAIL. Declared owner: quran. Reading Messaging's persistence
// adapter is using another context's adapter as a shortcut (ARCHITECTURE.md
// §4.1), and sharing a platform package grants nothing.
export { createMessageStore } from '../messaging';
