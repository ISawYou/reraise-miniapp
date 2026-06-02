create extension if not exists pgcrypto;

create table if not exists public.email_otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('login', 'link_email')),
  player_id uuid null references public.players(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  resend_after_at timestamptz not null,
  failed_attempts integer not null default 0,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_otp_codes_email_purpose_idx
  on public.email_otp_codes (email, purpose, created_at desc);

create index if not exists email_otp_codes_active_idx
  on public.email_otp_codes (email, purpose, consumed_at, expires_at);

create index if not exists email_otp_codes_expires_at_idx
  on public.email_otp_codes (expires_at);

comment on table public.email_otp_codes is 'Одноразовые email OTP-коды для входа и привязки email.';
