'use server';

// FIXTURE — MUST NOT BE A BOUNDARY. The syntax-only checker cannot prove the
// runtime shape of a star re-export, so the direct-export convention fails closed.
export * from '../shared/ordinary-wrapper';
