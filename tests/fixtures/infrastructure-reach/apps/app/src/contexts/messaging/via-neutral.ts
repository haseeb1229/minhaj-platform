// MUST FAIL — messaging -> local neutral -> contracts -> database.
// Chain length is not a defence.
import { connection } from '../../shared/neutral';

export const used = connection;
