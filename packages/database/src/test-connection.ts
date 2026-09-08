import 'server-only';

import { getDatabaseClient } from './client.ts';

interface ServerIdentity {
  productVersion: string;
  edition: string;
}

const database = getDatabaseClient();

try {
  const rows = await database.$queryRaw<ServerIdentity[]>`
    SELECT
      CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS productVersion,
      CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition
  `;

  const identity = rows[0];
  if (identity === undefined) throw new Error('SQL Server returned no identity row');

  const majorVersion = Number.parseInt(identity.productVersion.split('.')[0] ?? '', 10);
  if (majorVersion !== 16) {
    throw new Error(`Expected SQL Server major version 16; received ${majorVersion}`);
  }
  if (!identity.edition.includes('Developer Edition')) {
    throw new Error(
      `Expected SQL Server Developer Edition; received ${identity.edition}`,
    );
  }

  process.stdout.write(
    `Database connection verified: SQL Server ${identity.productVersion}, ${identity.edition}.\n`,
  );
} finally {
  await database.$disconnect();
}
