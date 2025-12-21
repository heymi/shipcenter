import './env';
import axios from 'axios';
import express from 'express';
import {
  deleteFollowedShip,
  createFollowup,
  getLatestSnapshot,
  getShipEvents,
  getShipEventsByMmsi,
  getFollowedShipMetaByMmsi,
  getShipAiAnalysis,
  getShareLink,
  listFollowedShips,
  listDailyAggregates,
  listWeeklyAggregates,
  listFollowups,
  stopShareLink,
  upsertShipAiAnalysis,
  upsertFollowedShip,
  upsertShareLink,
  updateFollowedShipStatus,
} from './db';
import { listAiModels, runShipInference } from './ai';
import { fetchPublicSources } from './publicSources';
import { startFetchTask } from './fetchTask';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from './auth';
import { isMainlandFlag } from '../utils/ship';

const app = express();
const PORT = process.env.PORT || 4000;
const SHIPXY_KEY = process.env.SHIPXY_KEY || '';
const DEFAULT_PORT_CODE = process.env.PORT_CODE || 'CNNJG';
const SHIPXY_ENDPOINT = 'https://api.shipxy.com/apicall/v3/GetETAShips';
const DEFAULT_EVENT_WINDOW_HOURS = Number(process.env.EVENT_WINDOW_HOURS || 24);
const DEFAULT_EVENT_WINDOW_MS = DEFAULT_EVENT_WINDOW_HOURS * 3600 * 1000;
const EVENTS_MAX_LIMIT = Number(process.env.EVENTS_MAX_LIMIT || 1000);
const PORT_LOCAL_NOTES = (process.env.PORT_LOCAL_NOTES || '').trim();

// 简单 CORS，便于本地前端（不同端口）访问
const resolveCorsOrigin = (origin?: string) => {
  const raw = process.env.CORS_ORIGIN || '*';
  if (raw === '*' || !origin) return raw;
  const allowlist = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return '*';
  return allowlist.includes(origin) ? origin : allowlist[0];
};

app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', resolveCorsOrigin(req.headers.origin));
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

type AuthedRequest = Request & { userId?: string };

const getQueryString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length && typeof value[0] === 'string') return value[0];
  return undefined;
};

const getQueryNumber = (value: unknown): number | undefined => {
  const raw = getQueryString(value);
  if (!raw) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
};

const filterForeignShips = (ships: any[]) =>
  Array.isArray(ships) ? ships.filter((ship) => !isMainlandFlag(ship?.ship_flag || ship?.flag || '')) : [];

const normalizeMmsi = (value: any) => String(value ?? '').replace(/\.0+$/, '').trim();

app.get('/health', (_req, res) => {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const optional = ['SHIPXY_KEY', 'GEMINI_API_KEY', 'PORT_CODE', 'CORS_ORIGIN'];
  const missingRequired = required.filter((key) => !process.env[key]);
  const missingOptional = optional.filter((key) => !process.env[key]);
  res.json({
    status: missingRequired.length === 0 ? 0 : -1,
    ok: missingRequired.length === 0,
    missing_required: missingRequired,
    missing_optional: missingOptional,
    time: new Date().toISOString(),
  });
});

const respondWithSnapshot = async (res: express.Response, port: string) => {
  const snapshot = await getLatestSnapshot(port);
  if (snapshot) {
    const data = JSON.parse(snapshot.data_json || '[]');
    const filtered = filterForeignShips(data);
    res.json({ status: 0, msg: 'Local Cache', total: filtered.length, data: filtered });
    return;
  }
  res.status(502).json({ status: -1, msg: 'Shipxy 查询失败且本地无缓存', total: 0, data: [] });
};

app.get('/ships', async (req, res) => {
  const port = (getQueryString(req.query.port) || DEFAULT_PORT_CODE).toUpperCase();
  const startTime = getQueryNumber(req.query.start_time);
  const endTime = getQueryNumber(req.query.end_time);
  const shipType = getQueryNumber(req.query.ship_type);

  const canHitRemote = Boolean(SHIPXY_KEY && startTime !== undefined && endTime !== undefined);

  if (canHitRemote) {
    try {
      const params: Record<string, string | number> = {
        key: SHIPXY_KEY,
        port_code: port,
        start_time: startTime as number,
        end_time: endTime as number,
      };
      if (shipType !== undefined) {
        params.ship_type = shipType;
      }
      const { data } = await axios.get(SHIPXY_ENDPOINT, { params, timeout: 5000 });
      if (data?.status === 0 && Array.isArray(data.data)) {
        const filtered = filterForeignShips(data.data);
        res.json({ ...data, total: filtered.length, data: filtered });
        return;
      }
      console.warn('Shipxy 返回异常，使用本地缓存：', data?.msg ?? 'Unknown error');
    } catch (err) {
      console.error('请求 Shipxy 失败，使用本地缓存', err);
    }
  } else if (!SHIPXY_KEY) {
    console.warn('未配置 SHIPXY_KEY，/ships 将仅返回本地缓存数据');
  }

  try {
    await respondWithSnapshot(res, port);
  } catch (err) {
    console.error('读取缓存失败', err);
    res.status(500).json({ status: -1, msg: '读取缓存失败', total: 0, data: [] });
  }
});

app.get('/ship-events', async (req, res) => {
  try {
    const sinceParam = getQueryNumber(req.query.since);
    const limitParam = getQueryNumber(req.query.limit);
    const since = Number.isFinite(sinceParam) ? (sinceParam as number) : Date.now() - DEFAULT_EVENT_WINDOW_MS;
    const limitRaw = Number.isFinite(limitParam) ? (limitParam as number) : 500;
    const limit = Math.max(1, Math.min(EVENTS_MAX_LIMIT, limitRaw));
    const rows = await getShipEvents(since, limit);
    const normalized = rows
      .filter((row) => !isMainlandFlag(row.ship_flag || ''))
      .map((row) => ({
        ...row,
        mmsi: String(row.mmsi ?? '').replace(/\.0+$/, ''),
      }));
    res.json(normalized);
  } catch (err) {
    console.error('读取动态失败', err);
    res.status(500).json({ status: -1, msg: '读取动态失败' });
  }
});

app.get('/followed-ships', requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).userId;
    if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
    const rows = await listFollowedShips(userId);
    res.json(rows);
  } catch (err) {
    console.error('读取关注船舶失败', err);
    res.status(500).json({ status: -1, msg: '读取关注船舶失败' });
  }
});

app.post('/followed-ships', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  const {
    mmsi,
    berth,
    agent,
    material_status,
    arrival_remark,
    expected_berth,
    arrival_window,
    risk_note,
    cargo_type,
    crew_nationality,
    crew_nationality_distribution,
    agent_contact_name,
    agent_contact_phone,
    remark,
    is_target,
    status,
    owner,
    crew_income_level,
    disembark_intent,
    email_status,
    crew_count,
    expected_disembark_count,
    actual_disembark_count,
    disembark_date,
    last_followed_at,
    next_followup_at,
  } = req.body || {};
  if (!mmsi || (typeof mmsi !== 'string' && typeof mmsi !== 'number')) {
    return res.status(400).json({ status: -1, msg: 'mmsi required' });
  }
  const mmsiStr = String(mmsi).trim();
  if (!mmsiStr) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  const remarkStr = remark === null || remark === undefined ? null : String(remark);
  const berthStr = berth === null || berth === undefined ? null : String(berth);
  const agentStr = agent === null || agent === undefined ? null : String(agent);
  const materialStatusStr =
    material_status === null || material_status === undefined ? null : String(material_status);
  const arrivalRemarkStr =
    arrival_remark === null || arrival_remark === undefined ? null : String(arrival_remark);
  const expectedBerthStr =
    expected_berth === null || expected_berth === undefined ? null : String(expected_berth);
  const arrivalWindowStr =
    arrival_window === null || arrival_window === undefined ? null : String(arrival_window);
  const riskNoteStr = risk_note === null || risk_note === undefined ? null : String(risk_note);
  const cargoTypeStr = cargo_type === null || cargo_type === undefined ? null : String(cargo_type);
  const crewNationalityStr =
    crew_nationality === null || crew_nationality === undefined ? null : String(crew_nationality);
  const crewNationalityDistributionStr =
    crew_nationality_distribution === null || crew_nationality_distribution === undefined
      ? null
      : String(crew_nationality_distribution);
  const agentNameStr =
    agent_contact_name === null || agent_contact_name === undefined ? null : String(agent_contact_name);
  const agentPhoneStr =
    agent_contact_phone === null || agent_contact_phone === undefined ? null : String(agent_contact_phone);
  const targetFlag = is_target ? 1 : 0;
  const statusStr = status === null || status === undefined ? null : String(status);
  const ownerStr = owner === null || owner === undefined ? null : String(owner);
  const income = crew_income_level === null || crew_income_level === undefined ? null : String(crew_income_level);
  const intent = disembark_intent === null || disembark_intent === undefined ? null : String(disembark_intent);
  const email = email_status === null || email_status === undefined ? null : String(email_status);
  const crewCount = Number.isFinite(Number(crew_count)) ? Number(crew_count) : null;
  const expectedCount = Number.isFinite(Number(expected_disembark_count))
    ? Number(expected_disembark_count)
    : null;
  const actualCount = Number.isFinite(Number(actual_disembark_count)) ? Number(actual_disembark_count) : null;
  const disembarkDateStr =
    disembark_date === null || disembark_date === undefined ? null : String(disembark_date);
  const lastFollowedAt = Number.isFinite(Number(last_followed_at)) ? Number(last_followed_at) : null;
  const nextFollowupAt = Number.isFinite(Number(next_followup_at)) ? Number(next_followup_at) : null;
  const now = Date.now();
  try {
    await upsertFollowedShip({
      user_id: userId,
      mmsi: mmsiStr,
      berth: berthStr,
      agent: agentStr,
      material_status: materialStatusStr,
      arrival_remark: arrivalRemarkStr,
      expected_berth: expectedBerthStr,
      arrival_window: arrivalWindowStr,
      risk_note: riskNoteStr,
      cargo_type: cargoTypeStr,
      crew_nationality: crewNationalityStr,
      crew_nationality_distribution: crewNationalityDistributionStr,
      agent_contact_name: agentNameStr,
      agent_contact_phone: agentPhoneStr,
      remark: remarkStr,
      is_target: targetFlag,
      status: statusStr,
      owner: ownerStr,
      crew_income_level: income,
      disembark_intent: intent,
      email_status: email,
      crew_count: crewCount,
      expected_disembark_count: expectedCount,
      actual_disembark_count: actualCount,
      disembark_date: disembarkDateStr,
      last_followed_at: lastFollowedAt,
      next_followup_at: nextFollowupAt,
      updated_at: now,
    });
    res.json({ status: 0, msg: 'ok', mmsi: mmsiStr });
  } catch (err) {
    console.error('保存关注船舶失败', err);
    res.status(500).json({ status: -1, msg: '保存关注船舶失败' });
  }
});

app.delete('/followed-ships/:mmsi', requireAuth, async (req, res) => {
  const { mmsi } = req.params;
  if (!mmsi) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  try {
    await deleteFollowedShip(mmsi, userId);
    res.json({ status: 0, msg: 'ok' });
  } catch (err) {
    console.error('删除关注船舶失败', err);
    res.status(500).json({ status: -1, msg: '删除关注船舶失败' });
  }
});

app.get('/followed-ships/:mmsi/followups', requireAuth, async (req, res) => {
  const { mmsi } = req.params;
  if (!mmsi) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  const limitParam = getQueryNumber(req.query.limit);
  const limitRaw = Number.isFinite(limitParam) ? (limitParam as number) : 50;
  const limit = Math.max(1, Math.min(200, limitRaw));
  try {
    const rows = await listFollowups(mmsi, userId, limit);
    res.json(rows);
  } catch (err) {
    console.error('读取跟进记录失败', err);
    res.status(500).json({ status: -1, msg: '读取跟进记录失败' });
  }
});

app.post('/followed-ships/:mmsi/followups', requireAuth, async (req, res) => {
  const { mmsi } = req.params;
  if (!mmsi) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  const { status, note, next_action, next_action_at, operator } = req.body || {};
  const statusStr = status === null || status === undefined ? null : String(status);
  const noteStr = note === null || note === undefined ? null : String(note);
  const nextActionStr = next_action === null || next_action === undefined ? null : String(next_action);
  const operatorStr = operator === null || operator === undefined ? null : String(operator);
  const nextActionAt = Number.isFinite(Number(next_action_at)) ? Number(next_action_at) : null;
  const now = Date.now();
  try {
    const created = await createFollowup({
      user_id: userId,
      mmsi,
      status: statusStr,
      note: noteStr,
      next_action: nextActionStr,
      next_action_at: nextActionAt,
      operator: operatorStr,
      created_at: now,
    });
    await updateFollowedShipStatus(mmsi, userId, {
      status: statusStr,
      last_followed_at: now,
      next_followup_at: nextActionAt,
    });
    res.json({ status: 0, msg: 'ok', data: created });
  } catch (err) {
    console.error('新增跟进记录失败', err);
    res.status(500).json({ status: -1, msg: '新增跟进记录失败' });
  }
});

app.patch('/followed-ships/:mmsi/status', requireAuth, async (req, res) => {
  const { mmsi } = req.params;
  if (!mmsi) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  const { status, owner, next_followup_at } = req.body || {};
  const statusStr = status === null || status === undefined ? null : String(status);
  const ownerStr = owner === null || owner === undefined ? null : String(owner);
  const nextFollowupAt = Number.isFinite(Number(next_followup_at)) ? Number(next_followup_at) : null;
  try {
    await updateFollowedShipStatus(mmsi, userId, {
      status: statusStr,
      owner: ownerStr,
      next_followup_at: nextFollowupAt,
    });
    res.json({ status: 0, msg: 'ok' });
  } catch (err) {
    console.error('更新跟进状态失败', err);
    res.status(500).json({ status: -1, msg: '更新跟进状态失败' });
  }
});

app.post('/ai/ship-analysis', requireAuth, async (req, res) => {
  const { ship, events, source_notes, source_links, history_notes } = req.body || {};
  if (!ship || typeof ship !== 'object') {
    return res.status(400).json({ status: -1, msg: 'ship required' });
  }
  try {
    const userId = (req as AuthedRequest).userId;
    let historyNotes = typeof history_notes === 'string' ? history_notes : '';
    const mmsiValue = ship?.mmsi ? String(ship.mmsi).replace(/\.0+$/, '') : '';
    if (!historyNotes && mmsiValue) {
      try {
        const since = Date.now() - 90 * 24 * 3600 * 1000;
        const historyEvents = await getShipEventsByMmsi(mmsiValue, since, 60);
        const followedMeta = userId ? await getFollowedShipMetaByMmsi(mmsiValue, userId) : null;
        if (historyEvents.length) {
          const portCode = process.env.PORT_CODE || '';
          const eventTypeCounts = historyEvents.reduce<Record<string, number>>((acc, item) => {
            const key = item.event_type || 'UNKNOWN';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {});
          const eventSummary = Object.entries(eventTypeCounts)
            .map(([key, count]) => `${key}:${count}`)
            .join('，');
          let portSummary = '';
          if (portCode) {
            const portEvents = historyEvents.filter((item: any) => item.port_code === portCode);
            if (portEvents.length) {
              const portCounts = portEvents.reduce<Record<string, number>>((acc, item) => {
                const key = item.event_type || 'UNKNOWN';
                acc[key] = (acc[key] || 0) + 1;
                return acc;
              }, {});
              const portEventSummary = Object.entries(portCounts)
                .map(([key, count]) => `${key}:${count}`)
                .join('，');
              portSummary = `\n南京港(${portCode})事件统计：${portEventSummary || '无'}`;
            }
          }
          const lastRiskEvent = historyEvents.find((item) => item.event_type === 'RISK_CHANGE');
          const recentLines = historyEvents
            .slice(0, 8)
            .map((item) => {
              const ts = item.detected_at ? new Date(item.detected_at).toLocaleString('zh-CN', { hour12: false }) : '时间未知';
              const portTag = item.port_code ? `[${item.port_code}]` : '';
              return `${ts} ${portTag} ${item.event_type || 'UNKNOWN'} ${item.detail || ''}`.trim();
            })
            .join('\n');
          historyNotes = `近90天事件统计：${eventSummary || '无'}${portSummary}${lastRiskEvent?.detail ? `\n最近风险变化：${lastRiskEvent.detail}` : ''}\n最近事件：\n${recentLines}`;
        }
        if (followedMeta) {
          const crewParts = [
            followedMeta.crew_nationality ? `国籍 ${followedMeta.crew_nationality}` : '',
            Number.isFinite(Number(followedMeta.crew_count)) ? `船员数 ${followedMeta.crew_count}` : '',
            Number.isFinite(Number(followedMeta.expected_disembark_count))
              ? `预计下船 ${followedMeta.expected_disembark_count}`
              : '',
            Number.isFinite(Number(followedMeta.actual_disembark_count))
              ? `实际下船 ${followedMeta.actual_disembark_count}`
              : '',
            followedMeta.crew_income_level ? `收入 ${followedMeta.crew_income_level}` : '',
            followedMeta.disembark_intent ? `下船意愿 ${followedMeta.disembark_intent}` : '',
            followedMeta.email_status ? `邮件 ${followedMeta.email_status}` : '',
            followedMeta.disembark_date ? `下船日期 ${followedMeta.disembark_date}` : '',
          ].filter(Boolean);
          const metaLines = [
            followedMeta.berth ? `历史靠泊 ${followedMeta.berth}` : '',
            followedMeta.cargo_type ? `货物类型 ${followedMeta.cargo_type}` : '',
            crewParts.length ? `船员数据：${crewParts.join('，')}` : '',
          ].filter(Boolean);
          if (metaLines.length) {
            historyNotes = `${historyNotes ? `${historyNotes}\n` : ''}历史跟进摘要：${metaLines.join('；')}`;
          }
        }
      } catch (err) {
        console.warn('读取历史事件失败', err);
      }
    }
    const mergedSourceNotes = [typeof source_notes === 'string' ? source_notes : '', PORT_LOCAL_NOTES]
      .map((value) => value.trim())
      .filter(Boolean)
      .join('\n');
    const result = await runShipInference({
      ship,
      events: Array.isArray(events) ? events : [],
      source_notes: mergedSourceNotes,
      source_links: Array.isArray(source_links) ? source_links : [],
      history_notes: historyNotes,
    });
    if (userId && ship?.mmsi) {
      await upsertShipAiAnalysis({
        user_id: userId,
        mmsi: String(ship.mmsi),
        analysis_json: JSON.stringify(result || {}),
        updated_at: Date.now(),
      });
    }
    res.json({ status: 0, data: result });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('AI analysis failed', err);
    if (/Gemini API key missing/i.test(message)) {
      return res.status(400).json({ status: -1, msg: 'GEMINI_API_KEY missing' });
    }
    res.status(500).json({ status: -1, msg: 'AI analysis failed' });
  }
});

app.post('/ai/ship-analysis/auto', requireAuth, async (req, res) => {
  const { ship, events, max_sources, max_per_source } = req.body || {};
  if (!ship || typeof ship !== 'object') {
    return res.status(400).json({ status: -1, msg: 'ship required' });
  }
  try {
    const userId = (req as AuthedRequest).userId;
    let historyNotes = '';
    const mmsiValue = ship?.mmsi ? String(ship.mmsi).replace(/\.0+$/, '') : '';
    if (mmsiValue) {
      try {
        const since = Date.now() - 90 * 24 * 3600 * 1000;
        const historyEvents = await getShipEventsByMmsi(mmsiValue, since, 60);
        const followedMeta = userId ? await getFollowedShipMetaByMmsi(mmsiValue, userId) : null;
        if (historyEvents.length) {
          const portCode = process.env.PORT_CODE || '';
          const eventTypeCounts = historyEvents.reduce<Record<string, number>>((acc, item) => {
            const key = item.event_type || 'UNKNOWN';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {});
          const eventSummary = Object.entries(eventTypeCounts)
            .map(([key, count]) => `${key}:${count}`)
            .join('，');
          let portSummary = '';
          if (portCode) {
            const portEvents = historyEvents.filter((item: any) => item.port_code === portCode);
            if (portEvents.length) {
              const portCounts = portEvents.reduce<Record<string, number>>((acc, item) => {
                const key = item.event_type || 'UNKNOWN';
                acc[key] = (acc[key] || 0) + 1;
                return acc;
              }, {});
              const portEventSummary = Object.entries(portCounts)
                .map(([key, count]) => `${key}:${count}`)
                .join('，');
              portSummary = `\n南京港(${portCode})事件统计：${portEventSummary || '无'}`;
            }
          }
          const lastRiskEvent = historyEvents.find((item) => item.event_type === 'RISK_CHANGE');
          const recentLines = historyEvents
            .slice(0, 8)
            .map((item) => {
              const ts = item.detected_at ? new Date(item.detected_at).toLocaleString('zh-CN', { hour12: false }) : '时间未知';
              const portTag = item.port_code ? `[${item.port_code}]` : '';
              return `${ts} ${portTag} ${item.event_type || 'UNKNOWN'} ${item.detail || ''}`.trim();
            })
            .join('\n');
          historyNotes = `近90天事件统计：${eventSummary || '无'}${portSummary}${lastRiskEvent?.detail ? `\n最近风险变化：${lastRiskEvent.detail}` : ''}\n最近事件：\n${recentLines}`;
        }
        if (followedMeta) {
          const crewParts = [
            followedMeta.crew_nationality ? `国籍 ${followedMeta.crew_nationality}` : '',
            Number.isFinite(Number(followedMeta.crew_count)) ? `船员数 ${followedMeta.crew_count}` : '',
            Number.isFinite(Number(followedMeta.expected_disembark_count))
              ? `预计下船 ${followedMeta.expected_disembark_count}`
              : '',
            Number.isFinite(Number(followedMeta.actual_disembark_count))
              ? `实际下船 ${followedMeta.actual_disembark_count}`
              : '',
            followedMeta.crew_income_level ? `收入 ${followedMeta.crew_income_level}` : '',
            followedMeta.disembark_intent ? `下船意愿 ${followedMeta.disembark_intent}` : '',
            followedMeta.email_status ? `邮件 ${followedMeta.email_status}` : '',
            followedMeta.disembark_date ? `下船日期 ${followedMeta.disembark_date}` : '',
          ].filter(Boolean);
          const metaLines = [
            followedMeta.berth ? `历史靠泊 ${followedMeta.berth}` : '',
            followedMeta.cargo_type ? `货物类型 ${followedMeta.cargo_type}` : '',
            crewParts.length ? `船员数据：${crewParts.join('，')}` : '',
          ].filter(Boolean);
          if (metaLines.length) {
            historyNotes = `${historyNotes ? `${historyNotes}\n` : ''}历史跟进摘要：${metaLines.join('；')}`;
          }
        }
      } catch (err) {
        console.warn('读取历史事件失败', err);
      }
    }
    const snippets = await fetchPublicSources(ship, {
      maxSources: Number.isFinite(Number(max_sources)) ? Number(max_sources) : undefined,
      maxPerSource: Number.isFinite(Number(max_per_source)) ? Number(max_per_source) : undefined,
    });
    const baseSourceNotes = snippets
      .map((item) => `[${item.source}] ${item.title} - ${item.snippet}`)
      .join('\n');
    const sourceNotes = [baseSourceNotes, PORT_LOCAL_NOTES].filter(Boolean).join('\n');
    const sourceLinks = snippets.map((item) => item.url);
    const result = await runShipInference({
      ship,
      events: Array.isArray(events) ? events : [],
      source_notes: sourceNotes,
      source_links: sourceLinks,
      history_notes: historyNotes,
    });
    const merged = { ...result, citations: snippets };
    if (userId && ship?.mmsi) {
      await upsertShipAiAnalysis({
        user_id: userId,
        mmsi: String(ship.mmsi),
        analysis_json: JSON.stringify(merged || {}),
        updated_at: Date.now(),
      });
    }
    res.json({ status: 0, data: merged });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('AI auto analysis failed', err);
    if (/Gemini API key missing/i.test(message)) {
      return res.status(400).json({ status: -1, msg: 'GEMINI_API_KEY missing' });
    }
    res.status(500).json({ status: -1, msg: 'AI auto analysis failed' });
  }
});

app.post('/ai/ship-analysis/batch', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  const {
    scope = 'events',
    limit = 30,
    since_hours = 24,
    port,
    max_sources = 4,
    max_per_source = 1,
  } = req.body || {};
  const limitNumber = Math.max(1, Math.min(200, Number(limit) || 30));
  const sinceHours = Number.isFinite(Number(since_hours)) ? Number(since_hours) : 24;
  const portCode = (port || DEFAULT_PORT_CODE || '').toUpperCase();
  const results: Array<{ mmsi: string; status: string; reason?: string }> = [];
  let targets: any[] = [];
  let eventsMap = new Map<string, any[]>();

  try {
    if (scope === 'ships') {
      const snapshot = await getLatestSnapshot(portCode);
      if (!snapshot) {
        return res.status(400).json({ status: -1, msg: 'no snapshot cache found' });
      }
      const data = JSON.parse(snapshot.data_json || '[]');
      targets = filterForeignShips(data);
    } else {
      const since = Date.now() - sinceHours * 3600 * 1000;
      const rows = await getShipEvents(since, EVENTS_MAX_LIMIT);
      rows
        .filter((row) => !isMainlandFlag(row.ship_flag || ''))
        .forEach((row) => {
          const mmsi = normalizeMmsi(row.mmsi);
          if (!mmsi) return;
          const list = eventsMap.get(mmsi) || [];
          list.push(row);
          eventsMap.set(mmsi, list);
        });
      if (eventsMap.size === 0) {
        return res.json({ status: 0, scope, total: 0, analyzed: 0, skipped: 0, failed: 0, results: [] });
      }
      let snapshotShips = new Map<string, any>();
      const snapshot = await getLatestSnapshot(portCode);
      if (snapshot) {
        const data = JSON.parse(snapshot.data_json || '[]');
        filterForeignShips(data).forEach((ship: any) => {
          const mmsi = normalizeMmsi(ship.mmsi);
          if (mmsi) snapshotShips.set(mmsi, ship);
        });
      }
      targets = Array.from(eventsMap.keys()).map((mmsi) => {
        const fallback = eventsMap.get(mmsi)?.[0];
        return (
          snapshotShips.get(mmsi) || {
            mmsi,
            ship_flag: fallback?.ship_flag || '',
          }
        );
      });
    }

    const uniqueTargets: any[] = [];
    const seen = new Set<string>();
    for (const ship of targets) {
      const mmsi = normalizeMmsi(ship?.mmsi);
      if (!mmsi || seen.has(mmsi)) continue;
      seen.add(mmsi);
      uniqueTargets.push(ship);
      if (uniqueTargets.length >= limitNumber) break;
    }

    let analyzed = 0;
    let skipped = 0;
    let failed = 0;

    for (const ship of uniqueTargets) {
      const mmsiValue = normalizeMmsi(ship?.mmsi);
      if (!mmsiValue) continue;
      try {
        const existing = await getShipAiAnalysis(mmsiValue, userId);
        if (existing?.analysis_json) {
          skipped += 1;
          results.push({ mmsi: mmsiValue, status: 'skipped' });
          continue;
        }
        let historyNotes = '';
        let historyEvents: any[] = [];
        try {
          const since = Date.now() - 90 * 24 * 3600 * 1000;
          historyEvents = await getShipEventsByMmsi(mmsiValue, since, 60);
          const followedMeta = await getFollowedShipMetaByMmsi(mmsiValue, userId);
          if (historyEvents.length) {
            const eventTypeCounts = historyEvents.reduce<Record<string, number>>((acc, item) => {
              const key = item.event_type || 'UNKNOWN';
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {});
            const eventSummary = Object.entries(eventTypeCounts)
              .map(([key, count]) => `${key}:${count}`)
              .join('，');
            let portSummary = '';
            if (portCode) {
              const portEvents = historyEvents.filter((item: any) => item.port_code === portCode);
              if (portEvents.length) {
                const portCounts = portEvents.reduce<Record<string, number>>((acc, item) => {
                  const key = item.event_type || 'UNKNOWN';
                  acc[key] = (acc[key] || 0) + 1;
                  return acc;
                }, {});
                const portEventSummary = Object.entries(portCounts)
                  .map(([key, count]) => `${key}:${count}`)
                  .join('，');
                portSummary = `\n南京港(${portCode})事件统计：${portEventSummary || '无'}`;
              }
            }
            const lastRiskEvent = historyEvents.find((item) => item.event_type === 'RISK_CHANGE');
            const recentLines = historyEvents
              .slice(0, 8)
              .map((item) => {
                const ts = item.detected_at
                  ? new Date(item.detected_at).toLocaleString('zh-CN', { hour12: false })
                  : '时间未知';
                const portTag = item.port_code ? `[${item.port_code}]` : '';
                return `${ts} ${portTag} ${item.event_type || 'UNKNOWN'} ${item.detail || ''}`.trim();
              })
              .join('\n');
            historyNotes = `近90天事件统计：${eventSummary || '无'}${portSummary}${lastRiskEvent?.detail ? `\n最近风险变化：${lastRiskEvent.detail}` : ''}\n最近事件：\n${recentLines}`;
          }
          if (followedMeta) {
            const crewParts = [
              followedMeta.crew_nationality ? `国籍 ${followedMeta.crew_nationality}` : '',
              Number.isFinite(Number(followedMeta.crew_count)) ? `船员数 ${followedMeta.crew_count}` : '',
              Number.isFinite(Number(followedMeta.expected_disembark_count))
                ? `预计下船 ${followedMeta.expected_disembark_count}`
                : '',
              Number.isFinite(Number(followedMeta.actual_disembark_count))
                ? `实际下船 ${followedMeta.actual_disembark_count}`
                : '',
              followedMeta.crew_income_level ? `收入 ${followedMeta.crew_income_level}` : '',
              followedMeta.disembark_intent ? `下船意愿 ${followedMeta.disembark_intent}` : '',
              followedMeta.email_status ? `邮件 ${followedMeta.email_status}` : '',
              followedMeta.disembark_date ? `下船日期 ${followedMeta.disembark_date}` : '',
            ].filter(Boolean);
            const metaLines = [
              followedMeta.berth ? `历史靠泊 ${followedMeta.berth}` : '',
              followedMeta.cargo_type ? `货物类型 ${followedMeta.cargo_type}` : '',
              crewParts.length ? `船员数据：${crewParts.join('，')}` : '',
            ].filter(Boolean);
            if (metaLines.length) {
              historyNotes = `${historyNotes ? `${historyNotes}\n` : ''}历史跟进摘要：${metaLines.join('；')}`;
            }
          }
        } catch (err) {
          console.warn('读取历史事件失败', err);
        }

        const snippets = await fetchPublicSources(ship, {
          maxSources: Number.isFinite(Number(max_sources)) ? Number(max_sources) : undefined,
          maxPerSource: Number.isFinite(Number(max_per_source)) ? Number(max_per_source) : undefined,
        });
        const baseSourceNotes = snippets
          .map((item) => `[${item.source}] ${item.title} - ${item.snippet}`)
          .join('\n');
        const sourceNotes = [baseSourceNotes, PORT_LOCAL_NOTES].filter(Boolean).join('\n');
        const sourceLinks = snippets.map((item) => item.url);
        const recentEvents = historyEvents
          .slice(0, 6)
          .map((item) => ({
            event_type: item.event_type,
            detail: item.detail,
            detected_at: item.detected_at,
          }));
        const result = await runShipInference({
          ship,
          events: recentEvents,
          source_notes: sourceNotes,
          source_links: sourceLinks,
          history_notes: historyNotes,
        });
        const merged = { ...result, citations: snippets };
        await upsertShipAiAnalysis({
          user_id: userId,
          mmsi: mmsiValue,
          analysis_json: JSON.stringify(merged || {}),
          updated_at: Date.now(),
        });
        analyzed += 1;
        results.push({ mmsi: mmsiValue, status: 'analyzed' });
      } catch (err: any) {
        failed += 1;
        results.push({
          mmsi: mmsiValue,
          status: 'failed',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.json({
      status: 0,
      scope,
      total: uniqueTargets.length,
      analyzed,
      skipped,
      failed,
      results,
    });
  } catch (err: any) {
    console.error('AI batch analysis failed', err);
    res.status(500).json({ status: -1, msg: 'AI batch analysis failed' });
  }
});

app.get('/ai/ship-analysis/:mmsi', requireAuth, async (req, res) => {
  const { mmsi } = req.params;
  if (!mmsi) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  try {
    const row = await getShipAiAnalysis(mmsi, userId);
    if (!row?.analysis_json) {
      return res.json({ status: 0, data: null });
    }
    let parsed: any = null;
    try {
      parsed = JSON.parse(row.analysis_json);
    } catch (err) {
      console.warn('解析AI分析失败', err);
      parsed = null;
    }
    res.json({
      status: 0,
      data: parsed,
      updated_at: row.updated_at || null,
      created_at: row.created_at || null,
    });
  } catch (err) {
    console.error('读取AI分析失败', err);
    res.status(500).json({ status: -1, msg: '读取AI分析失败' });
  }
});

app.patch('/ai/ship-analysis/:mmsi', requireAuth, async (req, res) => {
  const { mmsi } = req.params;
  if (!mmsi) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  const analysis = req.body?.analysis ?? req.body?.analysis_json ?? null;
  if (!analysis) return res.status(400).json({ status: -1, msg: 'analysis required' });
  try {
    const payload = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
    await upsertShipAiAnalysis({
      user_id: userId,
      mmsi: String(mmsi),
      analysis_json: payload,
      updated_at: Date.now(),
    });
    res.json({ status: 0, msg: 'ok' });
  } catch (err) {
    console.error('保存AI分析失败', err);
    res.status(500).json({ status: -1, msg: '保存AI分析失败' });
  }
});

app.get('/ai/models', async (_req, res) => {
  try {
    const models = await listAiModels();
    res.json({
      status: 0,
      data: models.map((model) => ({
        name: model.name,
        displayName: model.displayName,
        description: model.description,
        version: model.version,
        inputTokenLimit: model.inputTokenLimit,
        outputTokenLimit: model.outputTokenLimit,
        supportedActions: model.supportedActions,
      })),
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('List AI models failed', err);
    res.status(500).json({ status: -1, msg: message || 'List AI models failed' });
  }
});

app.post('/share-links/start', requireAuth, async (req, res) => {
  const { token, target, password_hash } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ status: -1, msg: 'token required' });
  }
  if (target !== 'arrivals' && target !== 'workspace') {
    return res.status(400).json({ status: -1, msg: 'invalid target' });
  }
  if (!password_hash || typeof password_hash !== 'string') {
    return res.status(400).json({ status: -1, msg: 'password hash required' });
  }
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  const now = Date.now();
  try {
    await upsertShareLink({
      token: token.trim(),
      user_id: userId,
      target,
      password_hash: password_hash.trim(),
      active: 1,
      created_at: now,
    });
    res.json({ status: 0, msg: 'ok', token });
  } catch (err) {
    console.error('创建分享链接失败', err);
    res.status(500).json({ status: -1, msg: '创建分享链接失败' });
  }
});

app.post('/share-links/stop', requireAuth, async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ status: -1, msg: 'token required' });
  }
  const userId = (req as AuthedRequest).userId;
  if (!userId) return res.status(401).json({ status: -1, msg: 'unauthorized' });
  try {
    await stopShareLink(token.trim(), userId);
    res.json({ status: 0, msg: 'ok' });
  } catch (err) {
    console.error('停止分享链接失败', err);
    res.status(500).json({ status: -1, msg: '停止分享链接失败' });
  }
});

app.get('/share-links/:token', async (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(404).json({ status: -1, msg: 'token missing' });
  try {
    const row = await getShareLink(token.trim());
    if (!row) {
      return res.status(404).json({ status: -1, msg: 'share not found' });
    }
    if (!row.active) {
      return res.status(410).json({ status: -1, msg: 'share inactive' });
    }
    res.json({
      status: 0,
      token: row.token,
      target: row.target,
      password_hash: row.password_hash,
      active: Boolean(row.active),
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('读取分享链接失败', err);
    res.status(500).json({ status: -1, msg: '读取分享链接失败' });
  }
});

app.get('/share-links/:token/followed-ships', async (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(404).json({ status: -1, msg: 'token missing' });
  try {
    const row = await getShareLink(token.trim());
    if (!row) {
      return res.status(404).json({ status: -1, msg: 'share not found' });
    }
    if (!row.active) {
      return res.status(410).json({ status: -1, msg: 'share inactive' });
    }
    if (row.target !== 'workspace' && row.target !== 'arrivals') {
      return res.status(400).json({ status: -1, msg: 'share target mismatch' });
    }
    if (!row.user_id) {
      return res.status(404).json({ status: -1, msg: 'share owner missing' });
    }
    const rows = await listFollowedShips(row.user_id);
    res.json(rows);
  } catch (err) {
    console.error('读取分享关注列表失败', err);
    res.status(500).json({ status: -1, msg: '读取分享关注列表失败' });
  }
});

app.get('/share-links/:token/ai-analysis/:mmsi', async (req, res) => {
  const { token, mmsi } = req.params;
  if (!token) return res.status(404).json({ status: -1, msg: 'token missing' });
  if (!mmsi) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  try {
    const row = await getShareLink(token.trim());
    if (!row) {
      return res.status(404).json({ status: -1, msg: 'share not found' });
    }
    if (!row.active) {
      return res.status(410).json({ status: -1, msg: 'share inactive' });
    }
    if (row.target !== 'arrivals' && row.target !== 'workspace') {
      return res.status(400).json({ status: -1, msg: 'share target mismatch' });
    }
    if (!row.user_id) {
      return res.status(404).json({ status: -1, msg: 'share owner missing' });
    }
    const analysis = await getShipAiAnalysis(String(mmsi), row.user_id);
    if (!analysis?.analysis_json) {
      return res.json({ status: 0, data: null });
    }
    let parsed: any = null;
    try {
      parsed = JSON.parse(analysis.analysis_json);
    } catch (err) {
      console.warn('解析分享AI分析失败', err);
      parsed = null;
    }
    res.json({
      status: 0,
      data: parsed,
      updated_at: analysis.updated_at || null,
      created_at: analysis.created_at || null,
    });
  } catch (err) {
    console.error('读取分享AI分析失败', err);
    res.status(500).json({ status: -1, msg: '读取分享AI分析失败' });
  }
});

app.get('/stats/daily', async (req, res) => {
  const start = getQueryString(req.query.start);
  const end = getQueryString(req.query.end);
  try {
    const rows = await listDailyAggregates(start, end);
    res.json(rows);
  } catch (err) {
    console.error('读取日报统计失败', err);
    res.status(500).json({ status: -1, msg: '读取日报统计失败' });
  }
});

app.get('/stats/weekly', async (req, res) => {
  const start = getQueryString(req.query.start);
  const end = getQueryString(req.query.end);
  try {
    const rows = await listWeeklyAggregates(start, end);
    res.json(rows);
  } catch (err) {
    console.error('读取周报统计失败', err);
    res.status(500).json({ status: -1, msg: '读取周报统计失败' });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  startFetchTask();
});
