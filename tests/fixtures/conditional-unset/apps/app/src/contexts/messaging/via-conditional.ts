// The project below declares NO `customConditions`, and `@fixture/dual`
// publishes no `default` branch. Real `tsc -p` reports TS2307 here and
// resolves nothing. The analyser must agree — Review #5 (N1) found it
// resolving `server-branch.ts` under conditions the project never set.
import { branch } from '@fixture/dual';

export const used = branch;
