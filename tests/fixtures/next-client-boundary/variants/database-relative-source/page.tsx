'use client';

import { parseDatabaseEnvironment } from '../../../../../../packages/database/src/config.ts';

export default function DatabaseRelativeSource() {
  return <main>{typeof parseDatabaseEnvironment}</main>;
}
