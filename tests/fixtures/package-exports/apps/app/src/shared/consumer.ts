// CONTROL — MUST PASS.
// Exact root export, exact subpath export, and a wildcard subpath pattern, all
// resolving to real files with no cycle and no prohibited target. Proving the
// negatives is only half the job: a resolver that rejected these would be
// broken, not strict.
import { exact } from '@fixture/exact';
import { helper } from '@fixture/exact/helper';
import { leaf } from '@fixture/exact/deep/leaf';

export const all = [exact, helper, leaf];
