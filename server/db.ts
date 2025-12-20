import { createClient } from '@supabase/supabase-js';

import './env';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const getClient = () => {
  if (!supabase) {
    throw new Error('Supabase env missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return supabase;
};

type ShipSnapshotRow = {
  id?: number;
  port_code: string;
  time_range: number;
  fetched_at: number;
  data_json: string;
};

type ShipEventRow = {
  id?: number;
  port_code: string;
  mmsi: string;
  ship_flag?: string | null;
  event_type: string;
  detail: string;
  detected_at: number;
};

type ShipAiAnalysisRow = {
  id?: number;
  user_id: string;
  mmsi: string;
  analysis_json: string;
  created_at?: number;
  updated_at: number;
};

type FollowedShipRow = {
  user_id: string;
  mmsi: string;
  berth: string | null;
  agent: string | null;
  material_status: string | null;
  arrival_remark: string | null;
  expected_berth: string | null;
  arrival_window: string | null;
  risk_note: string | null;
  cargo_type: string | null;
  crew_nationality: string | null;
  crew_nationality_distribution: string | null;
  agent_contact_name: string | null;
  agent_contact_phone: string | null;
  remark: string | null;
  is_target: number;
  status: string | null;
  owner: string | null;
  crew_income_level: string | null;
  disembark_intent: string | null;
  email_status: string | null;
  crew_count: number | null;
  expected_disembark_count: number | null;
  actual_disembark_count: number | null;
  disembark_date: string | null;
  last_followed_at: number | null;
  next_followup_at: number | null;
  updated_at: number;
};

export const getLatestSnapshot = async (portCode: string) => {
  const client = getClient();
  const { data, error } = await client
    .from('ships_snapshot')
    .select('*')
    .eq('port_code', portCode)
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
};

export const saveSnapshot = async (row: ShipSnapshotRow) => {
  const client = getClient();
  const { error } = await client.from('ships_snapshot').insert(row);
  if (error) throw error;
};

export const getShipEvents = async (since: number, limit: number) => {
  const client = getClient();
  const { data, error } = await client
    .from('ship_events')
    .select('*')
    .gte('detected_at', since)
    .order('detected_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
};

export const getShipEventsInRange = async (start: number, end: number) => {
  const client = getClient();
  const { data, error } = await client
    .from('ship_events')
    .select('event_type, mmsi, detected_at, ship_flag')
    .gte('detected_at', start)
    .lt('detected_at', end);
  if (error) throw error;
  return data ?? [];
};

export const getShipEventsByMmsi = async (
  mmsi: string,
  since: number,
  limit = 60
) => {
  const client = getClient();
  const { data, error } = await client
    .from('ship_events')
    .select('event_type, detail, detected_at, port_code')
    .eq('mmsi', mmsi)
    .gte('detected_at', since)
    .order('detected_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
};

export const getLastEventTimestamp = async (mmsi: string, eventType: string) => {
  const client = getClient();
  const { data, error } = await client
    .from('ship_events')
    .select('detected_at')
    .eq('mmsi', mmsi)
    .eq('event_type', eventType)
    .order('detected_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.detected_at ?? null;
};

export const getFollowedShipMetaByMmsi = async (mmsi: string, userId?: string) => {
  const client = getClient();
  let query = client
    .from('followed_ships')
    .select(
      'mmsi, berth, agent, material_status, arrival_remark, expected_berth, arrival_window, risk_note, cargo_type, crew_nationality, crew_nationality_distribution, crew_count, expected_disembark_count, actual_disembark_count, crew_income_level, disembark_intent, email_status, disembark_date, status, owner, remark, updated_at'
    )
    .eq('mmsi', mmsi)
    .limit(1);
  if (userId) {
    query = query.eq('user_id', userId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] ?? null;
};

export const saveEvents = async (events: ShipEventRow[]) => {
  if (!events.length) return;
  const client = getClient();
  const { error } = await client.from('ship_events').insert(events);
  if (error) throw error;
};

export const listFollowedShips = async (userId: string) => {
  const client = getClient();
  const { data, error } = await client
    .from('followed_ships')
    .select(
      'mmsi, berth, agent, material_status, arrival_remark, expected_berth, arrival_window, risk_note, cargo_type, crew_nationality, crew_nationality_distribution, agent_contact_name, agent_contact_phone, remark, is_target, status, owner, crew_income_level, disembark_intent, email_status, crew_count, expected_disembark_count, actual_disembark_count, disembark_date, last_followed_at, next_followup_at, updated_at'
    )
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const getShipAiAnalysis = async (mmsi: string, userId: string) => {
  const client = getClient();
  const { data, error } = await client
    .from('ship_ai_analyses')
    .select('analysis_json, updated_at, created_at')
    .eq('user_id', userId)
    .eq('mmsi', mmsi)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
};

export const upsertShipAiAnalysis = async (row: ShipAiAnalysisRow) => {
  const client = getClient();
  const { error } = await client
    .from('ship_ai_analyses')
    .upsert(row, { onConflict: 'user_id,mmsi' });
  if (error) throw error;
};

export const upsertFollowedShip = async (row: FollowedShipRow) => {
  const client = getClient();
  const { error } = await client
    .from('followed_ships')
    .upsert(row, { onConflict: 'user_id,mmsi' });
  if (error) throw error;
};

export const deleteFollowedShip = async (mmsi: string, userId: string) => {
  const client = getClient();
  const { error } = await client
    .from('followed_ships')
    .delete()
    .eq('mmsi', mmsi)
    .eq('user_id', userId);
  if (error) throw error;
};

type FollowupRow = {
  id?: number;
  user_id: string;
  mmsi: string;
  status: string | null;
  note: string | null;
  next_action: string | null;
  next_action_at: number | null;
  operator: string | null;
  created_at: number;
};

export const listFollowups = async (mmsi: string, userId: string, limit: number) => {
  const client = getClient();
  const { data, error } = await client
    .from('followed_ship_followups')
    .select('*')
    .eq('mmsi', mmsi)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
};

export const createFollowup = async (row: FollowupRow) => {
  const client = getClient();
  const { data, error } = await client.from('followed_ship_followups').insert(row).select('*').limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
};

export const updateFollowedShipStatus = async (
  mmsi: string,
  userId: string,
  patch: { status?: string | null; owner?: string | null; last_followed_at?: number | null; next_followup_at?: number | null }
) => {
  const client = getClient();
  const { error } = await client
    .from('followed_ships')
    .update(patch)
    .eq('mmsi', mmsi)
    .eq('user_id', userId);
  if (error) throw error;
};

export const upsertShareLink = async (row: {
  token: string;
  user_id: string;
  target: string;
  password_hash: string;
  active: number;
  created_at: number;
}) => {
  const client = getClient();
  const { error } = await client.from('share_links').upsert(row, { onConflict: 'token' });
  if (error) throw error;
};

export const stopShareLink = async (token: string, userId: string) => {
  const client = getClient();
  const { error } = await client
    .from('share_links')
    .update({ active: 0 })
    .eq('token', token)
    .eq('user_id', userId);
  if (error) throw error;
};

export const getShareLink = async (token: string) => {
  const client = getClient();
  const { data, error } = await client
    .from('share_links')
    .select('token, target, password_hash, active, created_at, user_id')
    .eq('token', token)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
};

type ShipAggregateRow = {
  arrival_event_count: number;
  arrival_ship_count: number;
  risk_change_count: number;
  risk_change_ship_count: number;
  updated_at: number;
};

export const upsertDailyAggregate = async (day: string, row: ShipAggregateRow) => {
  const client = getClient();
  const { error } = await client
    .from('ship_daily_aggregates')
    .upsert({ day, ...row }, { onConflict: 'day' });
  if (error) throw error;
};

export const upsertWeeklyAggregate = async (weekStart: string, row: ShipAggregateRow) => {
  const client = getClient();
  const { error } = await client
    .from('ship_weekly_aggregates')
    .upsert({ week_start: weekStart, ...row }, { onConflict: 'week_start' });
  if (error) throw error;
};

export const listDailyAggregates = async (startDay?: string, endDay?: string) => {
  const client = getClient();
  let query = client
    .from('ship_daily_aggregates')
    .select('*')
    .order('day', { ascending: false });
  if (startDay) query = query.gte('day', startDay);
  if (endDay) query = query.lte('day', endDay);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
};

export const listWeeklyAggregates = async (startWeek?: string, endWeek?: string) => {
  const client = getClient();
  let query = client
    .from('ship_weekly_aggregates')
    .select('*')
    .order('week_start', { ascending: false });
  if (startWeek) query = query.gte('week_start', startWeek);
  if (endWeek) query = query.lte('week_start', endWeek);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
};
