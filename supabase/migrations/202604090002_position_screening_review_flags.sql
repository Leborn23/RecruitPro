alter table public.active_positions
  add column if not exists screening_recalc_needed boolean not null default false,
  add column if not exists screening_recalc_reason text,
  add column if not exists screening_recalc_fields text[] not null default '{}'::text[],
  add column if not exists screening_recalc_requested_at timestamptz,
  add column if not exists screening_last_reviewed_at timestamptz;

create index if not exists idx_active_positions_screening_recalc_needed
  on public.active_positions (screening_recalc_needed, updated_at desc);
