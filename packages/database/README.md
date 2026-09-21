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
  adapters/                         Context-owned and Layer-0 persistence adapters
    identity-access/                Owned by the Identity & Access CONTEXT
    taxonomy/                       Owned by the Taxonomy CONTEXT
  lifecycle/                        Migration, rollback, seed and provisioning mechanics
    backup.ts                       SQL Server BACKUP/RESTORE mechanics and their guards
    recovery-proof.ts               The marker row written before backup, verified after
    recovery-cleanup.ts             Disposable-resource cleanup; failures fail the gate
    restored-state.ts               Inspection of a restored database's actual state
    phase2-fixture.ts               Populated Identity state, written before backup
    phase3b-fixture.ts              Populated Taxonomy state, written before backup
scripts/                            The executables behind the `db:*` commands
```

## Adapters — physical placement, semantic ownership

`src/adapters/` hosts persistence adapters that this package does **not** own.
Ownership is DECLARED in `package.json` under `minhaj.persistenceAdapters`, and
the architecture gate fails closed on an adapter no declaration owns:

```jsonc
"owners": {
  "identity-access": "identity-access",                  // a bounded context
  "taxonomy": "taxonomy",                                // a bounded context
  "email": { "kind": "layer0", "concern": "email" }      // a Layer-0 concern
}
```

Placing an adapter here changes **where it is implemented**, never **who owns
it** (ARCHITECTURE.md §4.1, §6.3 rule 14). Only the owning context may change
what its adapter means.

Two owner kinds exist because the architecture has two kinds of persistent
state. A bounded context owns domain state; a **Layer-0 platform concern** —
`email`, `rate-limiting`, `auditing` — owns infrastructure state such as
delivery metadata, rate-limit windows and audit rows. DOMAIN_MODEL.md §1.1 is
explicit that those are not bounded contexts, so without the second kind their
state could only have been filed under whichever context happened to need it
first. A Layer-0 adapter also buys LESS: it may reach no bounded context at all,
where a context-owned adapter may reach its own context's public interface.

### `taxonomy` — what its adapter does NOT offer

The Taxonomy adapter publishes a narrow reader and a narrow persistence port,
and deliberately no operation that assigns a topic to a content record.
DOMAIN_MODEL.md §6.2 requires a TYPED junction with a real foreign key to
`Topic` and a real foreign key to its single target, owned by the context that
owns that target — and no such context has shipped. A generic
`assignTopic(targetType, targetId)` here would be the polymorphic reference that
section prohibits, wearing a service's clothes.

`topicAssignmentStatus()` reads the database's own foreign-key catalogue
instead. It reports a semantic count of enforced and incomplete typed
relationships rather than exposing physical tables or columns, returns zero
while no owner has arrived, and needs no change when one does.

### `identity-access` — why Better Auth is constructed here

`prismaAdapter` takes a `PrismaClient`, and a bounded context may never hold one
(§3.1.2). Constructing the Better Auth instance beside the private client is the
only arrangement in which neither the client nor Better Auth's generic
`DBAdapter` crosses a boundary.

What crosses is a narrow, named operation port declared in
`@minhaj/contracts/identity`. `auth`, `auth.api`, `auth.$context` and the
internal adapter are module-private and are never exported.

This adapter performs **mechanics only**. It creates a credential, checks a
password, resolves a session, mints and consumes a token. It decides nothing:
who may sign in, whether a message should be sent and what it says, whether a
rate limit applies, whether an operation is authorised — all of that belongs to
the Identity context and stays there.

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

## What the rollback artifact is — and what it is not

The rollback artifact and `db:migrate:test` are a **migration-correctness
proof**. They run against a **disposable database that holds no accepted data**,
where dropping the objects and deleting the history row costs nothing.

> **A destructive reverse script is not automatically a safe production
> rollback**, and directly mutating `_prisma_migrations` is not a routine
> production recovery step.

Both are safe here **because the database is disposable**. Neither property
survives contact with a populated database: the same script that cleanly
reverses an empty migration will drop accepted user and content data from a
live one.

**Future migrations against populated business schema therefore require:**

- a **reviewed migration plan**;
- **forward compatibility** where the rollout needs it;
- **backward compatibility** where that is feasible and needed;
- an explicit **data-preservation strategy** — what happens to existing rows;
- a **populated, representative rehearsal** where the change is material;
- a **roll-forward plan**, which is usually the real answer for a populated
  database;
- a **restore and recovery plan** (ARCHITECTURE.md §10.4 — recovery covers the
  database **and** authoritative stored assets, not the database alone);
- **compatibility with the deployment rollout**, so that old and new
  application instances can both run against the schema during the change.

**Production rollback must never casually drop accepted user or content data,
and never reverse a destructive change without a data strategy.** Where a
reverse script cannot meet that standard, the correct answer is a forward fix,
not a rollback.

None of this changes the rule above: every forward migration still ships with
its paired reviewed rollback artifact, and the pairing is still enforced
mechanically. The artifact's **scope of validity** is what is stated here.

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

**One loader, one interpretation.** Every `db:*` command resolves configuration
through this loader and hands the URL to the Prisma child explicitly — none of
them reads `docker/.env` by another route. That matters because the file has
two plausible readers with different rules: this loader splits each line at the
first `=` and keeps the rest, while Node's `--env-file` follows dotenv rules,
where an unquoted `#` begins a comment. CI once invoked the Prisma CLI directly
under `--env-file`, and a generated password containing `#` truncated the
connection URL past the password, silently discarding
`encrypt=true;trustServerCertificate=true` and failing with **P1011** against
the container's self-signed certificate — while every loader-based command
passed in the same run. Applying migrations to a persistent database goes
through `npm run db:migrate:deploy` for that reason.

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

| Command                         | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `npm run db:generate`           | Generate the Prisma client                      |
| `npm run db:validate`           | Validate the schema                             |
| `npm run db:test:connection`    | Verify connectivity, version and edition        |
| `npm run db:provision`          | Apply the least-privilege grants (idempotent)   |
| `npm run db:migrate:deploy`     | Apply pending migrations to the configured DB   |
| `npm run db:migrate:test`       | Full lifecycle on a disposable database         |
| `npm run db:test:permissions`   | Prove the permission boundary live              |
| `npm run db:seed`               | Run the Phase 1 seed                            |
| `npm run db:backup`             | Take one real, verified backup and keep it      |
| `npm run db:restore:test`       | Prove the restore guards fail closed            |
| `npm run db:recovery:test`      | **End-to-end backup → restore → verify**        |
| `npm run db:recovery:populated` | **Populated Phase-2 backup → restore → verify** |

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

## Backup and recovery

**A backup that has never been restored is not a backup** (ARCHITECTURE.md
§10.4). `npm run db:recovery:test` is therefore the gate, not `npm run
db:backup`: it proves the artifact can actually be restored and that the
restored database is intact.

### The end-to-end rehearsal

`npm run db:recovery:test` runs the whole lifecycle and cleans up after itself:

```
migrated MinhajPlatform
  → write a unique synthetic audit marker row
  → BACKUP DATABASE ... WITH FORMAT, INIT, CHECKSUM
  → RESTORE VERIFYONLY / HEADERONLY / FILELISTONLY
  → RESTORE DATABASE into a NEW MinhajPhase1Restore_<32 hex>
  → verify restored schema, indexes and migration history
  → verify the marker row survived with unchanged values
  → verify the restored least-privilege posture, live
  → drop the restore database, delete the artifact, prove both are gone
```

Every step uses SQL Server's own backup engine. Nothing copies rows, replays a
migration, exports JSON or recreates schema — a rehearsal doing any of those
would pass while proving nothing about the artifact, which is the only thing an
incident depends on.

`MinhajPlatform` is **read from and appended to, never restored over**. The
restore target is always a fresh disposable database, and `WITH REPLACE` is
deliberately not used, so a restore fails rather than silently overwriting.

### The populated rehearsal

The rehearsal above proves the OPERATIONAL artifact: that the engineering
database's backup restores, and that the restored database is intact. What it
cannot prove is that populated business data survives, because it only ever
asserts an audit marker — a check a database holding one table would also pass.

`npm run db:recovery:populated` proves the CONTENT:

```
create a disposable MinhajPhase1Test_<32 hex> SOURCE
  → deploy EVERY migration with the real Prisma CLI
  → provision the least-privilege runtime principal
  → write synthetic rows into every Phase-2 table, related as real ones are
  → BACKUP DATABASE ... WITH FORMAT, INIT, CHECKSUM
  → RESTORE DATABASE into a NEW MinhajPhase1Restore_<32 hex>
  → verify every row VALUE BY VALUE, and the foreign keys between them
  → verify the COMPLETE migration history, not merely the first entry
  → verify the restored least-privilege posture as the runtime principal
  → drop both databases, delete the artifact, prove all three are gone
```

It builds its own source rather than writing accounts into `MinhajPlatform`: a
rehearsal should not leave synthetic people behind in a real database. Every
fixture value is non-secret and self-identifying — addresses under `.invalid`,
a placeholder where a password hash would be, and the literal word `synthetic`
where a token would be.

The two commands are complementary and both are gates. Neither is sufficient
alone: the first cannot speak for data it does not hold, and the second cannot
speak for the real database's artifact. `db:recovery:test` reports explicitly
when a repository migration is not yet deployed to `MinhajPlatform`, so the
gap is visible rather than silently uncovered.

The populated rehearsal also runs inside the existing remote
`Database foundation` job. Phase-2 reconciliation state is therefore restored
and permission-checked on the clean CI runner rather than relying only on local
evidence.

### Where backups are written

`BACKUP DATABASE ... TO DISK` is executed **by the server**, so the path
resolves inside the SQL Server container, never on the host. Artifacts are
written to `/var/opt/mssql/backup` on the container's existing volume.

This is why **a backup binary has no path into the working tree at all** — it
is not on the host to be committed. `*.bak`, `*.trn` and `*.bacpac` are also
git-ignored as a second line of defence, for anyone who copies one out by hand.

`npm run db:backup` takes one verified backup and **leaves it in place** — a
restore point before a risky local change. It prints the exact `docker exec`
command that removes it. `db:recovery:test` deletes its own artifact.

### Disposable restore safety

Restores and drops target `MinhajPhase1Restore_<32 hex>` and nothing else. The
guard identifies **positively** — the same discipline as the Chunk 2
`MinhajPhase1Test_` databases — so `master`, `tempdb`, `model`, `msdb`,
`MinhajPlatform`, an empty name, an injection-shaped name and a Chunk 2
disposable name all fail closed. The two namespaces deliberately do not
overlap, so neither chunk's cleanup can reach the other's databases.

Backup **sources** are guarded the same way, as an allowlist of two positive
shapes: `MinhajPlatform`, and a disposable `MinhajPhase1Test_<32 hex>` database
for the populated rehearsal. A restore target is deliberately **not** a valid
source — backing one up would prove a copy of a copy. Artifact **paths** are
guarded before any deletion, so no wildcard, traversal or data-file path can be
a target — there is no directory sweep anywhere in the cleanup.

`npm run db:restore:test` proves all of this without touching a database.

### Cleanup is part of the gate

Cleanup failures **fail the command**. `db:recovery:test` exits non-zero if a
restore database or a backup artifact survives, or if cleanup could not confirm
that it did not — a gate that reported a leak and then exited 0 would train
everyone to ignore the line, and in CI nobody reads a passing job's log.

Every cleanup step is still **attempted** even after an earlier one fails, so a
refused `DROP` does not also strand the artifact. Failures are collected and
reported together, and sessions are closed regardless. Residue is verified
_separately_ from the operation meant to remove it: a `DROP` that returns
without error is not evidence the database is gone.

If the rehearsal itself fails **and** cleanup fails, both are reported — the
primary failure leads, since it is the reason to investigate, and the cleanup
failures follow, since they are what is still on the server. Neither hides the
other.

CI verifies residue independently of what the rehearsal reported, checking both
leftover `MinhajPhase1Restore_*` databases and leftover Chunk 3 `.bak`
artifacts before teardown.

### What is and is not proven

**Proven:**

- a real, checksum-verified SQL Server full backup of the migrated database
- a real restore into a separate database, with logical files read from the
  artifact's own `FILELISTONLY` and moved to fresh physical paths
- restored `dbo.AuditLog`, its columns and its indexes
- restored `_prisma_migrations` listing the Phase 1 migration
- restored **data**: a marker row written before the backup, unchanged
- restored database-level security: `minhaj_app` owns nothing, holds no broad
  role, keeps `GRANT INSERT/SELECT` and `DENY UPDATE/DELETE` on the audit
  table, with the denials proven live against SQL Server error 229
- no business-domain schema anywhere in the restored database

**Not proven, and deliberately out of scope:**

- **Server-level login mapping.** Logins live in `master` and are _not_ inside
  a database backup. The rehearsal reports this as a distinct fact: on this
  instance the restored user maps back to the existing login by SID, so
  `DATABASE STATE RESTORED` and `SERVER-LEVEL LOGIN MAPPING INTACT` are both
  true. Restoring onto a _different_ instance would leave an orphaned user
  needing a re-provisioning step — the database state would still be restored.
  Nothing is granted to make a check pass.
- Point-in-time recovery, log backups and restore chains.
- Production backup storage, retention, offsite copies, scheduling, encryption
  key management and RPO/RTO targets. These are external decisions gating
  Phases 28 and 34 (OPEN_DECISIONS.md §4.4), not Phase 1 work.

### Local Developer-edition assumptions

This is the **local restore rehearsal** that OPEN_DECISIONS.md §4.1 places
under engineering control. It assumes the Compose SQL Server 2022 Developer
container, its `minhaj-platform-sqlserver-data` volume, and the container-side
paths above. It runs as the **migration** principal — `BACKUP DATABASE`
requires backup authority the least-privilege runtime principal does not hold
and must never be granted.

The unrelated host SQLEXPRESS instance on port 1433 is never a source, a target
or a path: the Minhaj container binds loopback `14330` only, and every guard
identifies its subject positively.

## Phase 6 authoritative editorial data

`20260920000000_phase6_editorial_core` adds separate Article/Page snapshots and typed
references, permanent slug reservations, durable publication schedules, and private
ContactInquiry/Feedback retention/triage. Use the normal migration deployment command;
accepted history is append-only. The paired rollback is a disposable rehearsal only;
populated deployments require a roll-forward or reviewed restore, never history edits.

The runtime can insert immutable revision/reference/history rows but cannot update/delete
or alter them. It can update workflow roots but cannot delete them; private correspondence
permits bounded retention deletion. The populated recovery rehearsal compares all 14 tables,
including multilingual documents/renderings, exact revision approvals, schedule provenance,
typed references, slug history, private bodies/notes and deadlines, before and after backup.
These fixture values are synthetic and are not logged as recovery output.

The persistent engineering database and volumes are preserved. Two pre-existing disposable
databases remain outside this phase's cleanup authority:
`MinhajPhase1Test_452d390f683e46b8a882ceab04f1fbb2` and
`MinhajPhase1Test_9d2356b6877143f18fafbcf7e39c2b33`.
