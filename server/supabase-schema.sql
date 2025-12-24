create table if not exists ships_snapshot (
  id bigserial primary key,
  port_code text,
  time_range integer,
  fetched_at bigint,
  data_json text
);

create table if not exists ship_events (
  id bigserial primary key,
  port_code text,
  mmsi text,
  ship_flag text,
  event_type text,
  detail text,
  detected_at bigint
);

create table if not exists arrived_ships (
  id bigserial primary key,
  port_code text,
  mmsi text,
  ship_name text,
  ship_cnname text,
  ship_flag text,
  eta text,
  eta_utc bigint,
  arrived_at bigint,
  detected_at bigint,
  last_port text,
  dest text,
  source text,
  data_json text,
  constraint arrived_ships_unique unique (port_code, mmsi, eta_utc)
);

create table if not exists share_links (
  token text primary key,
  user_id uuid,
  target text,
  password_hash text,
  active boolean default true,
  created_at bigint
);

create table if not exists followed_ships (
  id bigserial primary key,
  user_id uuid,
  mmsi text,
  berth text,
  agent text,
  material_status text,
  arrival_remark text,
  expected_berth text,
  arrival_window text,
  risk_note text,
  cargo_type text,
  crew_nationality text,
  crew_nationality_distribution text,
  agent_contact_name text,
  agent_contact_phone text,
  remark text,
  is_target integer default 0,
  status text,
  owner text,
  crew_income_level text,
  disembark_intent text,
  email_status text,
  crew_count integer,
  expected_disembark_count integer,
  actual_disembark_count integer,
  disembark_date text,
  last_followed_at bigint,
  next_followup_at bigint,
  updated_at bigint,
  constraint followed_ships_user_mmsi_key unique (user_id, mmsi)
);

create table if not exists followed_ship_followups (
  id bigserial primary key,
  user_id uuid,
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

create table if not exists ship_ai_analyses (
  id bigserial primary key,
  user_id uuid,
  mmsi text,
  analysis_json text,
  created_at bigint,
  updated_at bigint,
  constraint ship_ai_analyses_user_mmsi_key unique (user_id, mmsi)
);
