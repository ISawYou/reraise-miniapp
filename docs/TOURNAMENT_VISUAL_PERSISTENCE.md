# Tournament artwork persistence

Artwork remains in the existing `app_settings` / `tournament_visuals` JSONB row.
No schema migration, new RPC or database function is required.

## PostgreSQL mutation contract

`AppSettingsRepository.updateObject` runs at READ COMMITTED. It inserts an empty
object with `ON CONFLICT DO NOTHING` to handle the first-write race, locks the
latest row with `SELECT FOR UPDATE`, applies a synchronous mutation, updates the
row and returns its value only after the transaction commits. Failed validation,
read, write or commit rolls the transaction back, including first initialization.
The lock is in PostgreSQL and works across app processes/instances.

The feature validates stored JSON before mutating it. A missing key can resolve
to built-in defaults for reading; database failures and malformed stored data
cannot. Defaults for all eleven types are never written as a save side effect.
Unknown fields and future type keys are retained.

Each command affects one type and its explicit scope:

| Command | Modified fields |
| --- | --- |
| Main geometry | scale, offsetX, offsetY, opacity |
| List geometry | list geometry |
| Profile geometry | profile geometry |
| Reset List/Profile | remove only that override |
| Upload | original/card asset URLs |
| Main reset | built-in asset URLs/main geometry and removal of List override, preserving Profile and unknown extensions (existing Main-reset semantics) |

Main/List PUT requires `{ tournamentType, surface, geometry }`. Ambiguous legacy
full snapshots are rejected with 400. Extra stale fields in a scoped command
cannot modify another surface or asset. Independent types/surfaces survive
concurrent saves. For the **same type and surface**, the last mutation serialized
successfully by PostgreSQL wins; individual slider fields are not merged across
stale clients. Each response describes that operation's committed snapshot,
which a later authorized mutation can subsequently change.

## Failures and retries

Absent rows return null; read/write/authorization failures throw. Stored JSON null
is invalid settings data. API validation errors are 400; transaction conflicts
(40001/40P01) are 409; other read/write/commit/storage failures are 500. Responses
and logs omit SQL, parameters and raw database messages. Logs retain operation,
error category and sanitized database code.

The editor does not enable defaults after a failed settings read. It offers a
read retry, preserves newer draft revisions when a response is late, and shows
success only after a persisted result. All mutation requests disable automatic
transport retries, especially PNG upload. A connection failure after COMMIT is
ambiguous: reload current settings before deciding whether to retry manually.

File storage and PostgreSQL are not one distributed transaction. Uploads create
unique original/derivative files before publishing their URLs atomically. A failed
upload/publication can leave unreferenced files; existing artwork is not deleted
or overwritten. There is no automatic reupload or cleanup.

## Providers and other settings consumers

`DATABASE_PROVIDER=postgres` enables the transaction path. The existing Supabase
repository checks `{ error }` and requires a confirmed upsert result for CRUD.
It rejects atomic artwork mutations with 503: separate PostgREST requests cannot
provide the required transaction. No unsafe get/set fallback or privileged RPC
is installed. Environments using the default Supabase provider must explicitly
use PostgreSQL before enabling artwork editing; reads and ordinary feature-flag
CRUD remain available.

Other shared settings consumers: public feature-flag reads now return 500 on
outage, retaining false defaults only for genuine absence. Admin flag writes
already return 500 on error. Automatic-achievement guards propagate errors before
granting; tournament callers already catch those best-effort sync failures.
Activity logging already catches/logs failures without blocking its caller.
No achievement, rating, registration or finance logic changes are required.

## Local verification

The opt-in PostgreSQL suite uses only `RERAISE_SETTINGS_TEST_DATABASE_URL`, never
`DATABASE_URL`, and refuses non-local hosts and database names outside
`reraise_settings_test_*`. Provision a disposable PostgreSQL database first, then:

```sh
RERAISE_SETTINGS_TEST_DATABASE_URL=postgres://test_owner@127.0.0.1:55439/reraise_settings_test_r1 \
  npx vitest run lib/repositories/app-settings/__tests__/tournament-visuals.postgres.test.ts --maxWorkers=1
```

It creates test-only tables in that disposable database. Cases cover real
read-only write rejection, rollback and recovery, failed reads, malformed JSON,
first-write races, interleaved surface/type saves and same-surface ordering.
A test-only deferred constraint rejects COMMIT after UPDATE to verify commit
failure propagation. No production database or settings may be used for this suite.

References: [PostgreSQL 16 row locking](https://www.postgresql.org/docs/16/explicit-locking.html),
[Supabase maybeSingle response/error contract](https://supabase.com/docs/reference/javascript/maybesingle).
