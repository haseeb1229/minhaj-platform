// FIXTURE — MUST FAIL. A context cannot obtain even its own physical adapter;
// Layer 4 wires the port, and a neutral wrapper changes no ownership rule.
export { createMessageStore } from '../../../../../packages/wrapper/src/adapter-wrapper';
