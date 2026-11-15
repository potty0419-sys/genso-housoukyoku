-- 本番化を検討するためのDDLのみ。未適用・未接続。
-- Supabaseの既存ロール anon / authenticated / service_role を前提とする。
-- 書き込み用関数・Edge Function・秘密鍵は含めない。

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('party', 'shout')),
  purpose text,
  jobs text[] not null default '{}',
  level_min integer,
  level_max integer,
  starts_at timestamptz,
  duration_minutes integer not null default 60 check (duration_minutes between 1 and 1440),
  current_count integer,
  capacity integer,
  place text check (char_length(place) <= 60),
  character_name text check (char_length(character_name) <= 30),
  comment text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed boolean not null default false,
  report_count integer not null default 0 check (report_count >= 0),
  interest_count integer not null default 0 check (interest_count >= 0),
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'hidden', 'review')),
  sample boolean not null default false,
  actor_id uuid not null,
  delete_key_hash text not null,
  fingerprint text not null,
  deleted_at timestamptz,
  constraint content_length check (
    (type = 'party' and char_length(comment) <= 140) or
    (type = 'shout' and char_length(btrim(comment)) between 1 and 40)
  ),
  constraint party_fields check (type <> 'party' or (
    purpose is not null and cardinality(jobs) > 0 and
    starts_at is not null and level_min is not null and level_max is not null and
    level_min between 1 and 999 and level_max between level_min and 999 and
    current_count is not null and capacity is not null and
    capacity between 1 and 100 and current_count between 1 and capacity and
    place is not null and char_length(btrim(place)) > 0 and
    character_name is not null and char_length(btrim(character_name)) > 0
  ))
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null,
  reason text not null default 'other' check (reason in ('spam', 'personal_data', 'abuse', 'other')),
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);

create table public.interests (
  post_id uuid not null references public.posts(id) on delete cascade,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (post_id, actor_id)
);

create table public.post_attempts (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  fingerprint text not null,
  created_at timestamptz not null default now()
);

create index posts_public_start_idx on public.posts (type, starts_at)
  where deleted_at is null and moderation_status = 'visible' and report_count < 3;
create index posts_expiry_idx on public.posts (expires_at);
create index posts_created_idx on public.posts (type, created_at desc);
create index reports_created_idx on public.reports (created_at);
create index post_attempts_actor_time_idx on public.post_attempts (actor_id, created_at desc);
create index post_attempts_fingerprint_idx on public.post_attempts (actor_id, fingerprint, created_at desc);

alter table public.posts enable row level security;
alter table public.reports enable row level security;
alter table public.interests enable row level security;
alter table public.post_attempts enable row level security;

-- 公開一覧は終了済み募集も読める。失効したひとことはDB側でも公開しない。
create policy posts_public_read on public.posts for select to anon, authenticated
  using (
    deleted_at is null and moderation_status = 'visible' and report_count < 3
    and (type = 'party' or (expires_at > now() and closed = false))
  );

-- RLSは列を秘匿しないため、テーブル全体へのSELECTを取り消す。
revoke all on public.posts, public.reports, public.interests, public.post_attempts from public, anon, authenticated;
grant select (
  id, type, purpose, jobs, level_min, level_max, starts_at, duration_minutes,
  current_count, capacity, place, character_name, comment, created_at,
  expires_at, closed, interest_count, sample
) on public.posts to anon, authenticated;

-- 直接書き込みのRLSポリシーは作らない。service_roleはRLSを迂回する。
-- service_roleの利用は検証済みEdge Function/サーバーだけに限定する。
grant all on public.posts, public.reports, public.interests, public.post_attempts to service_role;
grant usage, select on sequence public.post_attempts_id_seq to service_role;
