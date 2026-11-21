create table if not exists public.scores (
  id bigint generated always as identity primary key,
  player_name text not null check (char_length(player_name) between 1 and 16),
  score integer not null check (score >= 0),
  created_at timestamptz not null default now()
);

create index if not exists scores_leaderboard_idx
  on public.scores (score desc, created_at asc);

alter table public.scores enable row level security;

grant select, insert on table public.scores to service_role;
grant usage, select on sequence public.scores_id_seq to service_role;
