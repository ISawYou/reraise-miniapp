-- Incremental fix on top of sql/mystery_bounty.sql: the shared free-tournament
-- "Re-buy" field (typed by the admin or pulled from Google Sheets) records
-- each player's TOTAL entries (initial buy-in + rebuys), not a rebuy count
-- on its own — Google Sheets never stores the two separately. The snapshot
-- now persists that raw Total Entries figure alongside the derived Rebuys
-- (total_entries_count - players_count) so both are visible for
-- diagnostics, and the pool formula uses Total Entries directly.

alter table public.tournament_mystery_bounty
  add column if not exists total_entries_count integer;

-- Backfill for rows created before this fix: the pre-fix code summed the raw
-- "Re-buy" field straight into rebuys_count, which is actually Total Entries
-- (Initial Entries + Rebuys), not a rebuy count on its own. So for any
-- existing row, rebuys_count already IS the historical total_entries_count
-- value — copy it across, then re-derive rebuys_count as
-- max(0, total_entries_count - players_count) so it reflects true rebuys
-- going forward. mystery_pool and any already-awarded results.* points are
-- left untouched — they are historical fact for whatever was actually paid
-- out at the event, not something this script should rewrite.
update public.tournament_mystery_bounty
  set total_entries_count = rebuys_count
  where total_entries_count is null;

update public.tournament_mystery_bounty
  set rebuys_count = greatest(0, rebuys_count - players_count)
  where total_entries_count is not null;

alter table public.tournament_mystery_bounty
  alter column total_entries_count set not null;

alter table public.tournament_mystery_bounty
  drop constraint if exists tournament_mystery_bounty_total_entries_check;

alter table public.tournament_mystery_bounty
  add constraint tournament_mystery_bounty_total_entries_check
  check (total_entries_count >= players_count);

comment on column public.tournament_mystery_bounty.total_entries_count is
  'Сумма поля "Re-buy" (Total Entries = Initial Entries + Rebuys) по пришедшим игрокам — сырое агрегированное значение из Google Sheets/ручного ввода. rebuys_count — производное (total_entries_count - players_count, не ниже 0).';
