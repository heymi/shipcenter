alter table followed_ships add column if not exists material_status text;
alter table followed_ships add column if not exists arrival_remark text;
alter table followed_ships add column if not exists expected_berth text;
alter table followed_ships add column if not exists arrival_window text;
alter table followed_ships add column if not exists risk_note text;
alter table followed_ships add column if not exists crew_nationality_distribution text;
