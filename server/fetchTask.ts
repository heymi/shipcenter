import './env';
import axios from 'axios';
import cron from 'node-cron';
import {
  getLatestSnapshot,
  getLastEventTimestamp,
  getShipEventsInRange,
  saveEvents,
  saveSnapshot,
  upsertArrivedShips,
  upsertDailyAggregate,
  upsertWeeklyAggregate,
} from './db';
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
const ARRIVED_WINDOW_HOURS = Number(process.env.ARRIVED_WINDOW_HOURS || 72);
const ARRIVED_WINDOW_MS = ARRIVED_WINDOW_HOURS * HOUR_MS;
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
const fetchShips = async (): Promise<Ship[]> => {
  const now = Math.floor(Date.now() / 1000);
  const start = Math.max(0, now - HISTORY_WINDOW_SECONDS);
  const end = now + FUTURE_WINDOW_SECONDS;
  const url = `https://api.shipxy.com/apicall/v3/GetETAShips?key=${SHIPXY_KEY}&port_code=${PORT_CODE}&start_time=${start}&end_time=${end}`;
  const res = await axios.get(url);
  const data = res.data?.data || [];
  return data.filter((ship: Ship) => !isMainlandFlag(ship.ship_flag));
};

const loadLatestSnapshot = async () => getLatestSnapshot(PORT_CODE);

const storeSnapshot = async (data: Ship[]) =>
  saveSnapshot({
    port_code: PORT_CODE,
    time_range: FUTURE_WINDOW_SECONDS,
    fetched_at: Date.now(),
    data_json: JSON.stringify(data),
  });

type TrackedEvent = {
  mmsi: number | string;
  type: string;
  detail: string;
  flag?: string;
};

const storeEvents = async (events: TrackedEvent[]) => {
  if (!events.length) return;
  await saveEvents(
    events.map((event) => ({
      port_code: PORT_CODE,
      mmsi: String(event.mmsi ?? '').replace(/\.0+$/, ''),
      ship_flag: event.flag || null,
      event_type: event.type,
      detail: event.detail,
      detected_at: Date.now(),
    }))
  );
};

const storeArrivedShips = async (ships: Ship[]) => {
  if (!ships.length) return;
  const now = Date.now();
  const rows = ships.map((ship) => {
    const etaTimestamp = getEtaTimestamp(ship);
    if (etaTimestamp === null) return null;
    const etaUtc = Number.isFinite(ship.eta_utc)
      ? Number(ship.eta_utc)
      : Math.floor(etaTimestamp / 1000);
    return {
      port_code: PORT_CODE,
      mmsi: String(ship.mmsi ?? '').replace(/\.0+$/, ''),
      ship_name: ship.ship_name || null,
      ship_cnname: ship.ship_cnname || null,
      ship_flag: ship.ship_flag || null,
      eta: ship.eta || null,
      eta_utc: etaUtc,
      arrived_at: etaTimestamp,
      detected_at: now,
      last_port: ship.preport_cnname || ship.last_port || null,
      dest: ship.dest || null,
      source: 'shipxy',
      data_json: JSON.stringify(ship),
    };
  });
  const payload = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (payload.length) {
    await upsertArrivedShips(payload);
  }
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

const pad2 = (value: number) => String(value).padStart(2, '0');

const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const getDayRange = (base: Date) => {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const getWeekRange = (base: Date) => {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const offset = (day + 6) % 7; // Monday as week start
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
};

const buildAggregate = (
  events: { event_type?: string | null; mmsi?: string | null; ship_flag?: string | null }[]
) => {
  const arrivalTypes = new Set(['ARRIVAL_SOON', 'ARRIVAL_IMMINENT', 'ARRIVAL_URGENT']);
  let arrivalEventCount = 0;
  let riskChangeCount = 0;
  const arrivalShipSet = new Set<string>();
  const riskShipSet = new Set<string>();
  events.forEach((event) => {
    if (isMainlandFlag(event.ship_flag || '')) return;
    const type = event.event_type || '';
    const mmsi = event.mmsi || '';
    if (arrivalTypes.has(type)) {
      arrivalEventCount += 1;
      if (mmsi) arrivalShipSet.add(mmsi);
    }
    if (type === 'RISK_LEVEL_CHANGE') {
      riskChangeCount += 1;
      if (mmsi) riskShipSet.add(mmsi);
    }
  });
  return {
    arrival_event_count: arrivalEventCount,
    arrival_ship_count: arrivalShipSet.size,
    risk_change_count: riskChangeCount,
    risk_change_ship_count: riskShipSet.size,
    updated_at: Date.now(),
  };
};

const updateAggregates = async () => {
  const now = new Date();
  const dayRange = getDayRange(now);
  const weekRange = getWeekRange(now);
  const [dayEvents, weekEvents] = await Promise.all([
    getShipEventsInRange(dayRange.start.getTime(), dayRange.end.getTime()),
    getShipEventsInRange(weekRange.start.getTime(), weekRange.end.getTime()),
  ]);
  await upsertDailyAggregate(formatDateKey(dayRange.start), buildAggregate(dayEvents));
  await upsertWeeklyAggregate(formatDateKey(weekRange.start), buildAggregate(weekEvents));
};

const diffShips = async (prev?: Ship[], next?: Ship[], prevFetchedAt?: number): Promise<TrackedEvent[]> => {
  if (!prev || !next) return [];
  const prevMap = new Map(prev.map((s) => [s.mmsi, s]));
  const events: TrackedEvent[] = [];
  for (const ship of next) {
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
      for (const threshold of ARRIVAL_THRESHOLDS) {
        if (diffMs <= threshold.window) {
          const crossed = previousDiffMs === null || previousDiffMs > threshold.window;
          const lastArrivalTs = await getLastEventTimestamp(
            String(ship.mmsi ?? '').replace(/\.0+$/, ''),
            threshold.type
          );
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
      }
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
            detail: `${ship.ship_name} 出发港由 ${safePrev} 改为 ${safeCurrent}`,
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
  }
  return events;
};

const runFetchJob = async () => {
  try {
    const ships = await fetchShips();
    const prev = await loadLatestSnapshot();
    await storeSnapshot(ships);
    const now = Date.now();
    const arrivedShips = ships.filter((ship) => {
      const etaTimestamp = getEtaTimestamp(ship);
      if (etaTimestamp === null) return false;
      return etaTimestamp <= now && etaTimestamp >= now - ARRIVED_WINDOW_MS;
    });
    await storeArrivedShips(arrivedShips);
    if (prev) {
      const previousShips: Ship[] = JSON.parse(prev.data_json);
      const events = await diffShips(previousShips, ships, prev.fetched_at);
      await storeEvents(events);
    }
    await updateAggregates();
    console.log('Shipxy snapshot updated');
  } catch (err) {
    console.error('Fetch Shipxy failed', err);
  }
};

export const startFetchTask = () => {
  runFetchJob();
  cron.schedule('*/30 * * * *', runFetchJob);
};
