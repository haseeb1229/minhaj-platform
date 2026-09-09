// FIXTURE — MUST FAIL. Layer 4 holding raw database capability through one
// neutral hop (ARCHITECTURE.md §3.2: "Raw database capability | never held").
import { getDatabaseClient } from '../shared/raw-wrapper';
export const database = getDatabaseClient;
