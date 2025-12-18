import axios from 'axios';
import express from 'express';
import db from './db';
import { startFetchTask } from './fetchTask';
import type { Request, Response, NextFunction } from 'express';

const app = express();
const PORT = process.env.PORT || 4000;
const SHIPXY_KEY = process.env.SHIPXY_KEY || '';
const DEFAULT_PORT_CODE = process.env.PORT_CODE || 'CNNJG';
const SHIPXY_ENDPOINT = 'https://api.shipxy.com/apicall/v3/GetETAShips';
const DEFAULT_EVENT_WINDOW_HOURS = Number(process.env.EVENT_WINDOW_HOURS || 24);
const DEFAULT_EVENT_WINDOW_MS = DEFAULT_EVENT_WINDOW_HOURS * 3600 * 1000;
const EVENTS_MAX_LIMIT = Number(process.env.EVENTS_MAX_LIMIT || 1000);

// 简单 CORS，便于本地前端（不同端口）访问
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

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

const respondWithSnapshot = (res: express.Response, port: string) => {
  const snapshot = db
    .prepare('SELECT * FROM ships_snapshot WHERE port_code = ? ORDER BY id DESC LIMIT 1')
    .get(port);
  if (snapshot) {
    const data = JSON.parse(snapshot.data_json || '[]');
    res.json({ status: 0, msg: 'Local Cache', total: data.length, data });
  } else {
    res.status(502).json({ status: -1, msg: 'Shipxy 查询失败且本地无缓存', total: 0, data: [] });
  }
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
        res.json(data);
        return;
      }
      console.warn('Shipxy 返回异常，使用本地缓存：', data?.msg ?? 'Unknown error');
    } catch (err) {
      console.error('请求 Shipxy 失败，使用本地缓存', err);
    }
  } else if (!SHIPXY_KEY) {
    console.warn('未配置 SHIPXY_KEY，/ships 将仅返回本地缓存数据');
  }

  respondWithSnapshot(res, port);
});

app.get('/ship-events', (req, res) => {
  const sinceParam = getQueryNumber(req.query.since);
  const limitParam = getQueryNumber(req.query.limit);
  const since = Number.isFinite(sinceParam) ? (sinceParam as number) : Date.now() - DEFAULT_EVENT_WINDOW_MS;
  const limitRaw = Number.isFinite(limitParam) ? (limitParam as number) : 500;
  const limit = Math.max(1, Math.min(EVENTS_MAX_LIMIT, limitRaw));
  const rows = db
    .prepare('SELECT * FROM ship_events WHERE detected_at >= ? ORDER BY detected_at DESC LIMIT ?')
    .all(since, limit);
  const normalized = rows.map((row) => ({
    ...row,
    mmsi: String(row.mmsi ?? '').replace(/\.0+$/, ''),
  }));
  res.json(normalized);
});

app.get('/followed-ships', (_req, res) => {
  const rows = db
    .prepare(
      'SELECT mmsi, berth, agent, agent_contact_name, agent_contact_phone, remark, is_target, crew_income_level, disembark_intent, email_status, crew_count, expected_disembark_count, actual_disembark_count, disembark_date, updated_at FROM followed_ships ORDER BY updated_at DESC'
    )
    .all();
  res.json(rows);
});

app.post('/followed-ships', (req, res) => {
  const {
    mmsi,
    berth,
    agent,
    agent_contact_name,
    agent_contact_phone,
    remark,
    is_target,
    crew_income_level,
    disembark_intent,
    email_status,
    crew_count,
    expected_disembark_count,
    actual_disembark_count,
    disembark_date,
  } = req.body || {};
  if (!mmsi || (typeof mmsi !== 'string' && typeof mmsi !== 'number')) {
    return res.status(400).json({ status: -1, msg: 'mmsi required' });
  }
  const mmsiStr = String(mmsi).trim();
  if (!mmsiStr) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  const remarkStr = remark === null || remark === undefined ? null : String(remark);
  const berthStr = berth === null || berth === undefined ? null : String(berth);
  const agentStr = agent === null || agent === undefined ? null : String(agent);
  const agentNameStr =
    agent_contact_name === null || agent_contact_name === undefined ? null : String(agent_contact_name);
  const agentPhoneStr =
    agent_contact_phone === null || agent_contact_phone === undefined ? null : String(agent_contact_phone);
  const targetFlag = is_target ? 1 : 0;
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
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO followed_ships (
      mmsi, berth, agent, agent_contact_name, agent_contact_phone, remark, is_target, crew_income_level, disembark_intent, email_status, crew_count, expected_disembark_count, actual_disembark_count, disembark_date, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mmsi) DO UPDATE SET
      berth=excluded.berth,
      agent=excluded.agent,
      agent_contact_name=excluded.agent_contact_name,
      agent_contact_phone=excluded.agent_contact_phone,
      remark=excluded.remark,
      is_target=excluded.is_target,
      crew_income_level=excluded.crew_income_level,
      disembark_intent=excluded.disembark_intent,
      email_status=excluded.email_status,
      crew_count=excluded.crew_count,
      expected_disembark_count=excluded.expected_disembark_count,
      actual_disembark_count=excluded.actual_disembark_count,
      disembark_date=excluded.disembark_date,
      updated_at=excluded.updated_at`
  );
  stmt.run(
    mmsiStr,
    berthStr,
    agentStr,
    agentNameStr,
    agentPhoneStr,
    remarkStr,
    targetFlag,
    income,
    intent,
    email,
    crewCount,
    expectedCount,
    actualCount,
    disembarkDateStr,
    now
  );
  res.json({ status: 0, msg: 'ok', mmsi: mmsiStr });
});

app.delete('/followed-ships/:mmsi', (req, res) => {
  const { mmsi } = req.params;
  if (!mmsi) return res.status(400).json({ status: -1, msg: 'mmsi required' });
  db.prepare('DELETE FROM followed_ships WHERE mmsi = ?').run(mmsi);
  res.json({ status: 0, msg: 'ok' });
});

app.post('/share-links/start', (req, res) => {
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
  const now = Date.now();
  db.prepare(
    `INSERT INTO share_links (token, target, password_hash, active, created_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(token) DO UPDATE SET
       target=excluded.target,
       password_hash=excluded.password_hash,
       active=1,
       created_at=excluded.created_at`
  ).run(token.trim(), target, password_hash.trim(), now);
  res.json({ status: 0, msg: 'ok', token });
});

app.post('/share-links/stop', (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ status: -1, msg: 'token required' });
  }
  const info = db.prepare('UPDATE share_links SET active = 0 WHERE token = ?').run(token.trim());
  res.json({ status: 0, msg: 'ok', updated: info.changes || 0 });
});

app.get('/share-links/:token', (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(404).json({ status: -1, msg: 'token missing' });
  const row = db
    .prepare('SELECT token, target, password_hash, active, created_at FROM share_links WHERE token = ?')
    .get(token.trim());
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
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  startFetchTask();
});
