create table if not exists ship_confirmed_fields (
  id bigserial primary key,
  user_id uuid,
  mmsi text,
  field_key text,
  field_value text,
  source text,
  note text,
  created_at bigint,
  updated_at bigint
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ship_confirmed_fields_user_mmsi_key'
  ) then
    alter table ship_confirmed_fields add constraint ship_confirmed_fields_user_mmsi_key unique (user_id, mmsi, field_key);
  end if;
end $$;

create index if not exists idx_ship_confirmed_fields_user_id on ship_confirmed_fields (user_id);
create index if not exists idx_ship_confirmed_fields_mmsi on ship_confirmed_fields (mmsi);

alter table ship_confirmed_fields enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_confirmed_fields' and policyname = 'ship_confirmed_fields_select_own'
  ) then
    create policy "ship_confirmed_fields_select_own" on ship_confirmed_fields for select using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_confirmed_fields' and policyname = 'ship_confirmed_fields_write_own'
  ) then
    create policy "ship_confirmed_fields_write_own" on ship_confirmed_fields for insert with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_confirmed_fields' and policyname = 'ship_confirmed_fields_update_own'
  ) then
    create policy "ship_confirmed_fields_update_own" on ship_confirmed_fields for update using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_confirmed_fields' and policyname = 'ship_confirmed_fields_delete_own'
  ) then
    create policy "ship_confirmed_fields_delete_own" on ship_confirmed_fields for delete using (auth.uid() = user_id);
  end if;
end $$;

create table if not exists ship_ai_feedback (
  id bigserial primary key,
  user_id uuid,
  mmsi text,
  field_key text,
  ai_value text,
  corrected_value text,
  confidence_pct integer,
  created_at bigint
);

create index if not exists idx_ship_ai_feedback_user_id on ship_ai_feedback (user_id);
create index if not exists idx_ship_ai_feedback_mmsi on ship_ai_feedback (mmsi);

alter table ship_ai_feedback enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_ai_feedback' and policyname = 'ship_ai_feedback_select_own'
  ) then
    create policy "ship_ai_feedback_select_own" on ship_ai_feedback for select using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_ai_feedback' and policyname = 'ship_ai_feedback_write_own'
  ) then
    create policy "ship_ai_feedback_write_own" on ship_ai_feedback for insert with check (auth.uid() = user_id);
  end if;
end $$;
