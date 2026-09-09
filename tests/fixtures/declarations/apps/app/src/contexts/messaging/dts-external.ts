// CONTROL — MUST PASS.
// An EXTERNAL package's declarations are not repository architecture. Node's
// own types are not a bounded context and must not be reported as one.
import type { Buffer } from 'node:buffer';

export type Used = Buffer;
