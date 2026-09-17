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

  /**
   * A driver type marker, as `mssql` exposes them.
   *
   * Opaque here on purpose: the lifecycle code binds one type, `NVarChar`, and
   * a declaration that described the driver's whole type table would be a
   * second copy of it to keep in step.
   */
  export interface SqlType {
    readonly __sqlType: unique symbol;
  }

  export const NVarChar: SqlType;

  export interface Request {
    /** Runs a single statement. */
    query: <Row>(command: string) => Promise<Result<Row>>;
    /** Runs a statement batch, as a `GO`-separated script section would be. */
    batch: <Row>(command: string) => Promise<Result<Row>>;
    /** Binds one named parameter, typed by the driver rather than spliced. */
    input: (name: string, type: SqlType, value: unknown) => Request;
    /** Calls a stored procedure with the bound parameters. */
    execute: <Row>(procedure: string) => Promise<Result<Row>>;
  }

  export class ConnectionPool {
    constructor(config: ConnectionPoolConfig);
    connect(): Promise<ConnectionPool>;
    request(): Request;
    close(): Promise<void>;
  }

  const mssql: {
    ConnectionPool: typeof ConnectionPool;
    NVarChar: SqlType;
  };

  export default mssql;
}
