alter table followed_ships add column if not exists user_id uuid;
alter table followed_ship_followups add column if not exists user_id uuid;
alter table share_links add column if not exists user_id uuid;

alter table followed_ships drop constraint if exists followed_ships_mmsi_key;
alter table followed_ships add constraint followed_ships_user_mmsi_key unique (user_id, mmsi);

create index if not exists idx_followed_ships_user_id on followed_ships (user_id);
create index if not exists idx_followed_ship_followups_user_id on followed_ship_followups (user_id);
create index if not exists idx_share_links_user_id on share_links (user_id);

alter table followed_ships enable row level security;
alter table followed_ship_followups enable row level security;
alter table share_links enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'followed_ships' and policyname = 'followed_ships_select_own'
  ) then
    create policy "followed_ships_select_own" on followed_ships for select using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'followed_ships' and policyname = 'followed_ships_write_own'
  ) then
    create policy "followed_ships_write_own" on followed_ships for insert with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'followed_ships' and policyname = 'followed_ships_update_own'
  ) then
    create policy "followed_ships_update_own" on followed_ships for update using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'followed_ships' and policyname = 'followed_ships_delete_own'
  ) then
    create policy "followed_ships_delete_own" on followed_ships for delete using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'followed_ship_followups' and policyname = 'followups_select_own'
  ) then
    create policy "followups_select_own" on followed_ship_followups for select using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'followed_ship_followups' and policyname = 'followups_write_own'
  ) then
    create policy "followups_write_own" on followed_ship_followups for insert with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'followed_ship_followups' and policyname = 'followups_update_own'
  ) then
    create policy "followups_update_own" on followed_ship_followups for update using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'followed_ship_followups' and policyname = 'followups_delete_own'
  ) then
    create policy "followups_delete_own" on followed_ship_followups for delete using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'share_links' and policyname = 'share_links_select_own'
  ) then
    create policy "share_links_select_own" on share_links for select using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'share_links' and policyname = 'share_links_write_own'
  ) then
    create policy "share_links_write_own" on share_links for insert with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'share_links' and policyname = 'share_links_update_own'
  ) then
    create policy "share_links_update_own" on share_links for update using (auth.uid() = user_id);
  end if;
end $$;
