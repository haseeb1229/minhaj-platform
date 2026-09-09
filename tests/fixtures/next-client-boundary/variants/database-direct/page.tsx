'use client';

import { getDatabaseClient } from '@minhaj/database';

export default function DatabaseDirect() {
  return <main>{typeof getDatabaseClient}</main>;
}
