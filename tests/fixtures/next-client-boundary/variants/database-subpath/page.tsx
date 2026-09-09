'use client';

import { parseDatabaseEnvironment } from '@minhaj/database/config';

export default function DatabaseSubpath() {
  return <main>{typeof parseDatabaseEnvironment}</main>;
}
