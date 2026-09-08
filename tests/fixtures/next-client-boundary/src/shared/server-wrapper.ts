// A neutral wrapper re-exporting server-core. Laundering the import through an
// intermediate module must not launder the boundary.
export { createLogger } from '@minhaj/server-core';
