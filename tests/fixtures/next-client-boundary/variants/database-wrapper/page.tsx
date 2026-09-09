'use client';

import { databaseModule } from '@/wrapper/database-reexport';

export default function DatabaseWrapper() {
  return <main>{typeof databaseModule}</main>;
}
