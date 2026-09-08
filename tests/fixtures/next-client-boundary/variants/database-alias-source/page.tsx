'use client';

import { parseDatabaseEnvironment } from '~database/config.ts';

export default function DatabaseAliasSource() {
  return <main>{typeof parseDatabaseEnvironment}</main>;
}
