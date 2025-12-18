import axios from 'axios';
import cron from 'node-cron';
import db from './db';
import { evaluateRiskRules, getRiskLabel, RISK_RULE_CONFIG } from '../utils/risk';
import { isMainlandFlag } from '../utils/ship';
import { ShipxyShip } from '../types';

const SHIPXY_KEY = process.env.SHIPXY_KEY || '你的 key';
const PORT_CODE = process.env.PORT_CODE || 'CNNJG';
const FUTURE_WINDOW_SECONDS = Number(
  process.env.FUTURE_WINDOW_SECONDS || process.env.RANGE_SECONDS || 7 * 24 * 3600
);
const HISTORY_WINDOW_SECONDS = Number(
  process.env.HISTORY_WINDOW_SECONDS || process.env.HISTORY_SECONDS || 30 * 24 * 3600
);
const DRAUGHT_SPIKE_THRESHOLD = Number(process.env.DRAUGHT_SPIKE_THRESHOLD || 1.5);
const HOUR_MS = 60 * 60 * 1000;
const ARRIVAL_SOON_WINDOW_MS = Number(process.env.ARRIVAL_WINDOW_HOURS || 6) * HOUR_MS;
const ARRIVAL_IMMINENT_WINDOW_MS = 2 * HOUR_MS;
const ARRIVAL_URGENT_WINDOW_MS = 30 * 60 * 1000;
const ARRIVAL_THRESHOLDS = [
  {
    type: 'ARRIVAL_SOON',
    window: ARRIVAL_SOON_WINDOW_MS,
    detail: (shipName: string) => `${shipName} ${Math.round(ARRIVAL_SOON_WINDOW_MS / HOUR_MS)} 小时内到港`,
  },
  {
    type: 'ARRIVAL_IMMINENT',
    window: ARRIVAL_IMMINENT_WINDOW_MS,
    detail: (shipName: string) => `${shipName} 2 小时内到港`,
  },
  {
    type: 'ARRIVAL_URGENT',
    window: ARRIVAL_URGENT_WINDOW_MS,
    detail: (shipName: string) => `${shipName} 30 分钟内到港`,
  },
] as const;

type Ship = ShipxyShip & Record<string, any>;
const getLastEventTimestamp = (() => {
  const stmt = db.prepare(
    'SELECT detected_at FROM ship_events WHERE mmsi = ? AND event_type = ? ORDER BY detected_at DESC LIMIT 1'
  );
  return (mmsi: string | number, eventType: string): number | null => {
    const row = stmt.get(String(mmsi), eventType) as { detected_at?: number } | undefined;
    return row?.detected_at ?? null;
  };
})();

const fetchShips = async (): Promise<Ship[]> => {
  const now = Math.floor(Date.now() / 1000);
  const start = Math.max(0, now - HISTORY_WINDOW_SECONDS);
  const end = now + FUTURE_WINDOW_SECONDS;
  const url = `https://api.shipxy.com/apicall/v3/GetETAShips?key=${SHIPXY_KEY}&port_code=${PORT_CODE}&start_time=${start}&end_time=${end}`;
  const res = await axios.get(url);
  return res.data?.data || [];
};

const getLatestSnapshot = () =>
  db.prepare('SELECT * FROM ships_snapshot WHERE port_code = ? ORDER BY id DESC LIMIT 1').get(PORT_CODE);

const saveSnapshot = (data: Ship[]) =>
  db
    .prepare(
      'INSERT INTO ships_snapshot (port_code, time_range, fetched_at, data_json) VALUES (?, ?, ?, ?)'
    )
    .run(PORT_CODE, FUTURE_WINDOW_SECONDS, Date.now(), JSON.stringify(data));

type TrackedEvent = {
  mmsi: number | string;
  type: string;
  detail: string;
  flag?: string;
};

const saveEvents = (events: TrackedEvent[]) => {
  const stmt = db.prepare(
    'INSERT INTO ship_events (port_code, mmsi, ship_flag, event_type, detail, detected_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  events.forEach((event) =>
    stmt.run(
      PORT_CODE,
      String(event.mmsi ?? '').replace(/\.0+$/, ''),
      event.flag || null,
      event.type,
      event.detail,
      Date.now()
    )
  );
};

const getLastUpdateTimestamp = (ship?: Partial<Ship>) => {
  if (!ship) return null;
  if (ship.last_time_utc) return ship.last_time_utc * 1000;
  if (ship.last_time) {
    const parsed = Date.parse(ship.last_time.replace(' ', 'T'));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

const parseDraughtValue = (value?: number | string) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
};

const getEtaTimestamp = (ship: Ship): number | null => {
  if (Number.isFinite(ship.eta_utc)) {
    return (ship.eta_utc as number) * 1000;
  }
  if (typeof ship.eta === 'string' && ship.eta.trim()) {
    const normalized = ship.eta.replace(' ', 'T');
    const candidates = [
      normalized.endsWith('Z') || normalized.includes('+') ? normalized : `${normalized}+08:00`,
      `${normalized}Z`,
      normalized,
    ];
    for (const candidate of candidates) {
      const parsed = Date.parse(candidate);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
};

const formatRelativeLabel = (timestampMs: number) => {
  const diff = Date.now() - timestampMs;
  if (diff <= 60 * 1000) return '刚刚';
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
};

const diffShips = (prev?: Ship[], next?: Ship[], prevFetchedAt?: number): TrackedEvent[] => {
  if (!prev || !next) return [];
  const prevMap = new Map(prev.map((s) => [s.mmsi, s]));
  const events: any[] = [];
  next.forEach((ship) => {
    const old = prevMap.get(ship.mmsi);
    if (old && old.eta !== ship.eta) {
      events.push({
        mmsi: ship.mmsi,
        type: 'ETA_UPDATE',
        detail: `${ship.ship_name} ETA 改为 ${ship.eta}`,
        flag: ship.ship_flag,
      });
    }
    const etaTime = getEtaTimestamp(ship);
    if (etaTime !== null) {
      const diffMs = etaTime - Date.now();
      const previousEtaTime = old ? getEtaTimestamp(old) : null;
      const previousDiffMs =
        previousEtaTime !== null && prevFetchedAt !== undefined ? previousEtaTime - prevFetchedAt : null;
      ARRIVAL_THRESHOLDS.forEach((threshold) => {
        if (diffMs <= threshold.window) {
          const crossed = previousDiffMs === null || previousDiffMs > threshold.window;
          const lastArrivalTs = getLastEventTimestamp(ship.mmsi, threshold.type);
          const recentlyAlerted = lastArrivalTs ? Date.now() - lastArrivalTs < threshold.window : false;
          if (crossed || !recentlyAlerted) {
            events.push({
              mmsi: ship.mmsi,
              type: threshold.type,
              detail: threshold.detail(ship.ship_name),
              flag: ship.ship_flag,
            });
          }
        }
      });
    }

    if (old) {
      const oldRisk = evaluateRiskRules(old).level;
      const newRisk = evaluateRiskRules(ship).level;
      if (oldRisk !== newRisk) {
        events.push({
          mmsi: ship.mmsi,
          type: 'RISK_LEVEL_CHANGE',
          detail: `${ship.ship_name} 风险级别由 ${getRiskLabel(oldRisk)} 调整为 ${getRiskLabel(newRisk)}`,
          flag: ship.ship_flag,
        });
      }

      const previousPort = (old.preport_cnname || old.last_port || '').trim();
      const currentPort = (ship.preport_cnname || ship.last_port || '').trim();
      if (previousPort || currentPort) {
        const safePrev = previousPort || '未知';
        const safeCurrent = currentPort || '未知';
        if (safePrev !== safeCurrent) {
          events.push({
            mmsi: ship.mmsi,
            type: 'LAST_PORT_CHANGE',
            detail: `${ship.ship_name} 上一港由 ${safePrev} 改为 ${safeCurrent}`,
            flag: ship.ship_flag,
          });
        }
      }

      const oldDraught = parseDraughtValue(old.draught);
      const newDraught = parseDraughtValue(ship.draught);
      if (oldDraught !== null && newDraught !== null) {
        const diff = newDraught - oldDraught;
        if (Math.abs(diff) >= DRAUGHT_SPIKE_THRESHOLD) {
          const trend = diff > 0 ? '上升' : '下降';
          events.push({
            mmsi: ship.mmsi,
            type: 'DRAUGHT_SPIKE',
            detail: `${ship.ship_name} 吃水${trend}${Math.abs(diff).toFixed(1)}m (当前 ${newDraught.toFixed(
              1
            )}m)`,
            flag: ship.ship_flag,
          });
        }
      }
    }

    const lastUpdateMs = getLastUpdateTimestamp(ship);
    if (lastUpdateMs) {
      const currentAgeHours = Math.max(0, (Date.now() - lastUpdateMs) / HOUR_MS);
      const previousAgeHours =
        prevFetchedAt !== undefined ? Math.max(0, (prevFetchedAt - lastUpdateMs) / HOUR_MS) : null;
      const { warnHours, criticalHours } = RISK_RULE_CONFIG.staleness;
      const crossedCritical =
        currentAgeHours >= criticalHours &&
        (previousAgeHours === null || previousAgeHours < criticalHours);
      const crossedWarn =
        currentAgeHours >= warnHours && (previousAgeHours === null || previousAgeHours < warnHours);
      if (crossedCritical || crossedWarn) {
        const severityLabel = crossedCritical ? '严重' : '提醒';
        events.push({
          mmsi: ship.mmsi,
          type: 'STALE_SIGNAL',
          detail: `${ship.ship_name} ${severityLabel}：数据${currentAgeHours.toFixed(1)}小时未更新`,
          flag: ship.ship_flag,
        });
      }
    }

    if (!isMainlandFlag(ship.ship_flag)) {
      const lastUpdateMs = getLastUpdateTimestamp(ship);
      const prevUpdateMs = getLastUpdateTimestamp(old);
      // 只在最新上报时间变新时才生成动态，避免沿用旧时间戳
      const hasFreshReport = lastUpdateMs && (!prevUpdateMs || lastUpdateMs > prevUpdateMs);
      if (hasFreshReport) {
        const suffix = `（${formatRelativeLabel(lastUpdateMs!)}）`;
        events.push({
          mmsi: ship.mmsi,
          type: 'FOREIGN_REPORT',
          detail: `${ship.ship_name} 更新了上报时间${suffix}`,
          flag: ship.ship_flag,
        });
      }
    }
  });
  return events;
};

const runFetchJob = async () => {
  try {
    const ships = await fetchShips();
    const prev = getLatestSnapshot();
    saveSnapshot(ships);
    if (prev) {
      const previousShips: Ship[] = JSON.parse(prev.data_json);
      saveEvents(diffShips(previousShips, ships, prev.fetched_at));
    }
    console.log('Shipxy snapshot updated');
  } catch (err) {
    console.error('Fetch Shipxy failed', err);
  }
};

export const startFetchTask = () => {
  runFetchJob();
  cron.schedule('*/30 * * * *', runFetchJob);
};
