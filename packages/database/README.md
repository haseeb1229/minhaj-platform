# `@minhaj/database`

Server-only Prisma and Microsoft SQL Server platform adapter. Layer 0
infrastructure, not a bounded business context (ARCHITECTURE.md §5).

## Layout

```
prisma/
  schema.prisma                     Provider, generator, and the audit foundation
  migrations/<id>_<name>/           Forward migrations, applied by `prisma migrate deploy`
    migration.sql
sql/
  rollback/<id>_<name>.rollback.sql Reviewed rollback, paired to one forward migration
  permissions/                      Least-privilege grants for the runtime principal
src/
  client.ts                         The application Prisma client
  config.ts                         Zod-validated, server-only configuration
  lifecycle/                        Migration, rollback, seed and provisioning mechanics
scripts/                            The executables behind the `db:*` commands
```

## Migration convention

Forward schema change is `prisma migrate deploy` — reviewed and applied
deliberately, never automatically on deploy (SECURITY_BASELINE.md §18.2).

**Prisma has no down migration.** Rollback is therefore an explicit reviewed
artifact, paired to its forward migration by a shared identifier:

| Direction | Path                                          |
| --------- | --------------------------------------------- |
| Forward   | `prisma/migrations/<id>_<name>/migration.sql` |
| Rollback  | `sql/rollback/<id>_<name>.rollback.sql`       |

The pairing is enforced mechanically: `loadMigrations()` throws when a forward
migration has no rollback of the same identifier, so `npm run db:migrate:test`
fails rather than letting the two drift apart — the failure that would
otherwise surface only during an incident.

A rollback artifact also deletes its own row from `_prisma_migrations`. Leaving
that row behind would tell `migrate deploy` the objects still exist, making the
next re-apply a silent no-op.

## Adding a migration

1. Edit `prisma/schema.prisma`.
2. Generate the forward SQL:
   `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`
3. Save it as `prisma/migrations/<id>_<name>/migration.sql`.
4. Write the matching `sql/rollback/<id>_<name>.rollback.sql` that reverses it
   and deletes its history row.
5. Run `npm run db:migrate:test` — it runs the REAL `prisma migrate deploy`
   and `prisma migrate status` against a disposable database, verifies the
   resulting schema and history, seeds twice, applies the reviewed rollback,
   and deploys again.

`db:migrate:test` never replays `migration.sql` itself and never writes a
`_prisma_migrations` row: the history is Prisma's, so a failure in the real CLI
path — a TLS error such as P1011, for instance — fails the gate instead of
being masked by a direct-SQL substitute. Direct SQL is used only for database
creation, state inspection, and the reviewed rollback artifact.

### Local configuration precedence

For the local `db:*` lifecycle commands, **`docker/.env` is authoritative**. It
is read by `src/lifecycle/local-environment.ts` and applied OVER the calling
shell, and the resolved URL is handed explicitly to the Prisma CLI child.

This is deliberate. Node's `--env-file-if-exists` only fills variables that are
not already set, so a `DATABASE_MIGRATION_URL` left over in one terminal
silently outranked `docker/.env` — two shells ran the same command against
different TLS settings, and one saw the Prisma CLI fail with P1011 while
another saw it pass. When the file displaces a conflicting shell value the
command says so, printing safe metadata only (host, port, database, user,
`encrypt`, `trustServerCertificate`) and never a password or a whole URL.

This precedence applies only to local Docker/Phase 1 tooling. Deployed
environments have no `docker/.env`; their configuration continues to arrive as
externally supplied environment variables.

### Local TLS

The migration URL is encrypted (`encrypt=true`). The container serves a
self-signed certificate, so the local URL also sets
`trustServerCertificate=true`; without it the Prisma CLI fails with **P1011**
(`A certificate chain processed, but terminated in a root certificate which is
not trusted`). Transport encryption stays on — the accommodation is to the
certificate's provenance, not to encryption itself. A deployed environment
presents a trusted certificate and drops the flag.

## Principals

Two distinct principals, and the separation is the point:

| Variable                 | Principal    | Authority                                     |
| ------------------------ | ------------ | --------------------------------------------- |
| `DATABASE_MIGRATION_URL` | privileged   | schema changes, provisioning, seed            |
| `DATABASE_URL`           | `minhaj_app` | `INSERT`/`SELECT` on `AuditLog`; nothing else |

The runtime principal is not `sa`, owns no database, holds no broad role, and
is explicitly denied `UPDATE`, `DELETE` and every form of DDL — the append-only
audit discipline of SECURITY_BASELINE.md §13.1 enforced by the database rather
than by application convention. Grants are made per object, never per schema: a
schema-level grant would silently extend to every table a later phase adds.

## Commands

| Command                       | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `npm run db:generate`         | Generate the Prisma client                    |
| `npm run db:validate`         | Validate the schema                           |
| `npm run db:test:connection`  | Verify connectivity, version and edition      |
| `npm run db:provision`        | Apply the least-privilege grants (idempotent) |
| `npm run db:migrate:test`     | Full lifecycle on a disposable database       |
| `npm run db:test:permissions` | Prove the permission boundary live            |
| `npm run db:seed`             | Run the Phase 1 seed                          |

## Disposable test databases

Lifecycle tests create and drop `MinhajPhase1Test_<32 hex>` databases. Every
destructive path first re-validates the name against that exact pattern, so a
system database, the development database, or the unrelated host SQLEXPRESS
instance can never be the target. The guard identifies positively; anything it
does not recognise fails closed.

## Seed

Phase 1 has no data to seed — business tables do not exist, and inventing rows
for them is what DELIVERY_PLAN.md forbids. The seed is a deterministic
verification pass that writes nothing, so it is idempotent structurally rather
than by careful upserts. Its purpose is to establish and prove the mechanism
that later phases extend.
