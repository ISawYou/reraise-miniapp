alter table public.tournaments
  drop constraint if exists tournaments_tournament_type_check;

alter table public.tournaments
  add constraint tournaments_tournament_type_check
  check (
    tournament_type in (
      'classic',
      'phoenix',
      'deep_stack',
      'bounty',
      'boss_bounty',
      'win_the_button'
    )
  );

alter table public.results
  add column if not exists boss_knockouts integer not null default 0;

alter table public.tournament_live_entries
  add column if not exists boss_knockouts integer not null default 0;

comment on column public.results.boss_knockouts is
  'Количество Boss-нокаутов для формата Boss Bounty.';

comment on column public.tournament_live_entries.boss_knockouts is
  'Текущее количество Boss-нокаутов в live-режиме турнира.';
