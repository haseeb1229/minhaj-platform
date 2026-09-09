// A module that merely re-exports server-core. Laundering the import through a
// wrapper must not launder the boundary.
export { createLogger } from '@minhaj/server-core';
