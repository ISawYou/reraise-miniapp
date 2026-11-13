# Desktop console: PostgreSQL operations stages

Stage 1 adds nullable canonical operation fields, a PostgreSQL repository and authenticated GET/PATCH API. Null means unknown; no historical values are fabricated or backfilled. `freeReentries` records tournament usage only: it does not grant or debit `players.free_reentries_balance`. Payment state is an operational marker, not a finance posting.

Writes require a current unblocked admin/operator, active tournament, registered/attended player and exact `expectedVersion` (0 for an absent row). Tournament row locking serializes writes with completion. Updates patch only supplied fields and atomically append before/after audit. Sheet-linked tournaments reject all operation writes until an explicit ownership switch is implemented. Legacy live entries/results are not rewritten. Late-registration cutoff and snapshots do not restrict staff operation fields.

The additive 0039 migration is local and pending deployment. No production migrations or data writes are performed by this PR.

## Remaining review stages

2. Read model and desktop columns: load saved fields, allow staff edits with version conflict handling. Reuse existing attendance/entries/eliminations rather than duplicate their storage. Show existing completed results as frozen, read-only facts.
3. Ownership transfer: persist a per-tournament owner/version, compare Sheet and PostgreSQL including missing values, present conflicts and require explicit resolution/confirmation. Import through the canonical model only after confirming the exact comparison version. Gate every background sync/write-through/completion Sheet path on the same owner inside the existing tournament lock; stale work must fail closed after ownership changes. Keep existing linked tournaments Sheet-owned by default. Do not equate clearing the Sheet link with ownership transfer.
4. PostgreSQL completion: load authoritative roster/operations/live-state under canonical consistency checks; require known KO/place fields for applicable formats, validate unique contiguous places and existing Mystery rules, use existing frozen rating places and calculation engine, then commit through the current completion transaction. Client-submitted rating values must never become authoritative. Keep existing Sheet-owned completion intact.

Stage 1 intentionally does not activate ownership switching or route completion through the new fields. It can be reviewed independently on top of draft PR #20.
