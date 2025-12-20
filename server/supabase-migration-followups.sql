alter table followed_ships add column if not exists status text;
alter table followed_ships add column if not exists owner text;
alter table followed_ships add column if not exists cargo_type text;
alter table followed_ships add column if not exists crew_nationality text;
alter table followed_ships add column if not exists last_followed_at bigint;
alter table followed_ships add column if not exists next_followup_at bigint;

create table if not exists followed_ship_followups (
  id bigserial primary key,
  mmsi text,
  status text,
  note text,
  next_action text,
  next_action_at bigint,
  operator text,
  created_at bigint
);

create table if not exists ship_daily_aggregates (
  day text primary key,
  arrival_event_count integer,
  arrival_ship_count integer,
  risk_change_count integer,
  risk_change_ship_count integer,
  updated_at bigint
);

create table if not exists ship_weekly_aggregates (
  week_start text primary key,
  arrival_event_count integer,
  arrival_ship_count integer,
  risk_change_count integer,
  risk_change_ship_count integer,
  updated_at bigint
);
