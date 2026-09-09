// Prohibited infrastructure whose public surface is declarations only. A type
// dependency on the database is still a dependency on the database.
export interface Connection {
  readonly dsn: string;
}
