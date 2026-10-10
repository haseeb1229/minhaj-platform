// FIXTURE — MUST FAIL. editorial -> global-network is allowed, but internals
// are not, and a relative path must not evade that.
import { centreTable } from '../global-network/internal/centre-table';
export const t = centreTable;
