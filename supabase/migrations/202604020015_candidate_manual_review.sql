alter table public.candidate_position_matches
  add column if not exists human_decision text,
  add column if not exists review_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id);

alter table public.candidate_position_matches
  drop constraint if exists candidate_position_matches_human_decision_check;

alter table public.candidate_position_matches
  add constraint candidate_position_matches_human_decision_check
  check (human_decision is null or human_decision in ('pass', 'pending', 'reject'));

create index if not exists idx_candidate_position_matches_human_decision
  on public.candidate_position_matches (human_decision, reviewed_at desc);
