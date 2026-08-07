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
      'win_the_button',
      'mystery_bounty'
    )
  );

alter table public.results
  add column if not exists mystery_bounty_points integer not null default 0;

comment on column public.results.mystery_bounty_points is
  'Сумма номиналов Mystery Bounty конвертов, вытянутых игроком (формат mystery_bounty).';

create table if not exists public.tournament_mystery_bounty (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  status text not null default 'pending_envelopes'
    check (status in ('pending_envelopes', 'active')),

  players_count integer not null check (players_count >= 0),
  rebuys_count integer not null,
  addons_count integer not null,
  active_players_count integer not null check (active_players_count >= 2),

  mystery_pool integer not null check (mystery_pool >= 0),
  envelope_count integer not null,
  small_count integer not null,
  small_value integer not null,
  medium_count integer not null,
  medium_value integer not null,
  jackpot_value integer not null,

  closed_at timestamptz not null default now(),
  activated_at timestamptz,
  recalculated_at timestamptz
);

comment on table public.tournament_mystery_bounty is
  'Замороженный снапшот Mystery Bounty pool/конвертов, создаётся при закрытии Late Registration (один раз на турнир). Отсутствие строки = Late Registration ещё открыта.';
