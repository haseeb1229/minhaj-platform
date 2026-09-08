/**
 * Minimal type surface for `mssql`, covering exactly what the lifecycle code
 * uses.
 *
 * `mssql` ships no types of its own. `@types/mssql` is a DefinitelyTyped
 * package versioned independently of the driver, and adding it would put a
 * third-party declaration in the dependency tree to describe five members of
 * one class. Declaring that surface here keeps it accurate, reviewable and
 * versioned with the code that depends on it (SECURITY_BASELINE.md §18.3).
 *
 * `mssql` itself is not a new dependency: it is what `@prisma/adapter-mssql`
 * already builds on.
 */
declare module 'mssql' {
  export interface ConnectionPoolConfig {
    server: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    options?: {
      encrypt?: boolean;
      trustServerCertificate?: boolean;
    };
    pool?: {
      max?: number;
      min?: number;
      idleTimeoutMillis?: number;
    };
  }

  export interface Result<Row> {
    recordset: Row[];
    rowsAffected: number[];
  }

  export interface Request {
    /** Runs a single statement. */
    query: <Row>(command: string) => Promise<Result<Row>>;
    /** Runs a statement batch, as a `GO`-separated script section would be. */
    batch: <Row>(command: string) => Promise<Result<Row>>;
  }

  export class ConnectionPool {
    constructor(config: ConnectionPoolConfig);
    connect(): Promise<ConnectionPool>;
    request(): Request;
    close(): Promise<void>;
  }

  const mssql: {
    ConnectionPool: typeof ConnectionPool;
  };

  export default mssql;
}
