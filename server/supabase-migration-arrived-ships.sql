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
