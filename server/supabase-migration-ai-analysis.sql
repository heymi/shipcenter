create table if not exists ship_ai_analyses (
  id bigserial primary key,
  user_id uuid,
  mmsi text,
  analysis_json text,
  created_at bigint,
  updated_at bigint
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ship_ai_analyses_user_mmsi_key'
  ) then
    alter table ship_ai_analyses add constraint ship_ai_analyses_user_mmsi_key unique (user_id, mmsi);
  end if;
end $$;

create index if not exists idx_ship_ai_analyses_user_id on ship_ai_analyses (user_id);
create index if not exists idx_ship_ai_analyses_mmsi on ship_ai_analyses (mmsi);

alter table ship_ai_analyses enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_ai_analyses' and policyname = 'ship_ai_analyses_select_own'
  ) then
    create policy "ship_ai_analyses_select_own" on ship_ai_analyses for select using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_ai_analyses' and policyname = 'ship_ai_analyses_write_own'
  ) then
    create policy "ship_ai_analyses_write_own" on ship_ai_analyses for insert with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_ai_analyses' and policyname = 'ship_ai_analyses_update_own'
  ) then
    create policy "ship_ai_analyses_update_own" on ship_ai_analyses for update using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_ai_analyses' and policyname = 'ship_ai_analyses_delete_own'
  ) then
    create policy "ship_ai_analyses_delete_own" on ship_ai_analyses for delete using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ship_ai_analyses' and policyname = 'ship_ai_analyses_service_role'
  ) then
    create policy "ship_ai_analyses_service_role" on ship_ai_analyses
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;
