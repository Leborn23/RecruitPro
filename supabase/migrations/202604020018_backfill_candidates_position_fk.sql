alter table public.candidates
  add column if not exists p_id uuid references public.active_positions(id) on delete set null;

create index if not exists idx_candidates_position
  on public.candidates (p_id);

alter table public.candidates
  add column if not exists created_by uuid references auth.users(id);

alter table public.candidates
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

drop trigger if exists trg_candidates_updated_at on public.candidates;
create trigger trg_candidates_updated_at
before update on public.candidates
for each row
execute function public.set_updated_at();
