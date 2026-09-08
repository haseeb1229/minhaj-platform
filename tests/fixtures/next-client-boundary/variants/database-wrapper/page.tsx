'use client';

import { getDatabaseClient } from '@/wrapper/database-reexport';

export default function DatabaseWrapper() {
  return <main>{typeof getDatabaseClient}</main>;
}
