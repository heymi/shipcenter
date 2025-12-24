import React, { useState, useEffect } from 'react';
import {
  Search,
  Map as MapIcon,
  Anchor,
  Loader2,
  AlertCircle,
  Clock,
  Filter,
  X,
} from 'lucide-react';
import { API_CONFIG } from '../config';
import { fetchETAShips } from '../api';
import { RiskLevel, ShipxyShip } from '../types';
import { getShipTypeName, isMainlandFlag } from '../utils/ship';
import { formatPortWithCountry } from '../utils/port';
import { evaluateRiskRules, getRiskLabel, getRiskBadgeClass } from '../utils/risk';
import { formatSmartWeekdayLabel } from '../utils/date';

const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between border-b border-slate-700 pb-2">
    <span className="text-slate-400">{label}</span>
    <span className="text-white font-medium text-right">{value}</span>
  </div>
);

const formatUtcSeconds = (seconds?: number) => {
  if (!seconds || Number.isNaN(seconds)) return '-';
  const date = new Date(seconds * 1000);
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
};

const parseBeijingDate = (value?: string) => {
  if (!value) return null;
  const normalized = value.replace(' ', 'T');
  const date = new Date(`${normalized}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatWeekdayCN = (date: Date) =>
  date.toLocaleDateString('zh-CN', { weekday: 'long', timeZone: 'Asia/Shanghai' });

const formatBeijingWithWeek = (value?: string) => {
  if (!value) return '-';
  const date = parseBeijingDate(value);
  if (!date) return value;
  const weekday = formatWeekdayCN(date);
  return `${value} (${weekday})`;
};

const displayOrDash = (value?: number | string) => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number' && value === 0) return '-';
  if (value === '') return '-';
  return value;
};

const computeTodayDurationSeconds = () => {
  const now = new Date();
  const currentOffset = now.getTimezoneOffset(); // minutes
  const targetOffset = -480; // UTC+8
  const beijingNowMs = now.getTime() + (currentOffset - targetOffset) * 60000;
  const beijingNow = new Date(beijingNowMs);
  const endOfDay = new Date(beijingNow);
  endOfDay.setHours(23, 59, 59, 0);
  const diffMs = endOfDay.getTime() - beijingNow.getTime();
  const fallbackSeconds = 6 * 60 * 60; // ensure at least 6h
  return diffMs > 0 ? Math.floor(diffMs / 1000) : fallbackSeconds;
};

const labelClass = 'block text-xs font-medium text-slate-300 mb-1';
const inputBaseClass =
  'rounded-lg text-sm bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-400 outline-none';
const selectClass = `${inputBaseClass} pl-3 pr-8 py-2`;
const inputClass = `${inputBaseClass} pl-8 pr-3 py-2`;

const draughtStats = { min: 2, max: 20 };

const parseDraughtValue = (value?: number | string) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
};

const getDraughtRatio = (value?: number | string) => {
  const num = parseDraughtValue(value);
  if (num === null) return null;
  const clamped = Math.min(Math.max(num, draughtStats.min), draughtStats.max);
  const ratio = (clamped - draughtStats.min) / (draughtStats.max - draughtStats.min);
  return Math.min(1, Math.max(0, ratio));
};

const FLAG_EMOJI_MAP: Record<string, string> = {
  CHINA: '🇨🇳',
  PRCHINA: '🇨🇳',
  HONGKONG: '🇭🇰',
  MACAO: '🇲🇴',
  TAIWAN: '🇹🇼',
  PANAMA: '🇵🇦',
  LIBERIA: '🇱🇷',
  SINGAPORE: '🇸🇬',
  BELGIUM: '🇧🇪',
  CYPRUS: '🇨🇾',
  NORWAY: '🇳🇴',
  MARSHALLISLANDS: '🇲🇭',
  JAPAN: '🇯🇵',
  UNITEDSTATES: '🇺🇸',
  UNITEDKINGDOM: '🇬🇧',
  中国: '🇨🇳',
  香港: '🇭🇰',
  澳门: '🇲🇴',
  台湾: '🇹🇼',
  巴拿马: '🇵🇦',
  利比里亚: '🇱🇷',
};

const alpha2ToEmoji = (code: string) =>
  code
    .toUpperCase()
    .replace(/[A-Z]/g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));

const getFlagEmoji = (flag?: string) => {
  if (!flag) return '🚢';
  const trimmed = flag.trim();
  if (!trimmed) return '🚢';
  if (FLAG_EMOJI_MAP[trimmed]) return FLAG_EMOJI_MAP[trimmed];
  const normalized = trimmed.toUpperCase().replace(/[\s\.\-'\u2019]/g, '');
  if (!normalized) return '🚢';
  if (FLAG_EMOJI_MAP[normalized]) return FLAG_EMOJI_MAP[normalized];
  if (/^[A-Z]{2}$/.test(normalized)) return alpha2ToEmoji(normalized);
  if (/^[A-Z]{3}$/.test(normalized)) return alpha2ToEmoji(normalized.slice(0, 2));
  return '🚢';
};

const formatRelativeTime = (lastUpdated?: string | number) => {
  let timestamp = null;
  if (typeof lastUpdated === 'number' && !Number.isNaN(lastUpdated)) {
    timestamp = lastUpdated * 1000;
  } else if (typeof lastUpdated === 'string') {
    const parsed = Date.parse(lastUpdated.replace(' ', 'T'));
    if (!Number.isNaN(parsed)) timestamp = parsed;
  }
  if (!timestamp) return null;
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return '刚刚';
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
};

const CACHE_KEY = 'dockday_port_cache_v2';

const TOOLS = [
  { 
    id: 'port', 
    title: '港口预抵查询', 
    icon: Anchor, 
    color: 'bg-teal-500', 
    desc: '使用港口五位码和时间段查询预抵船舶列表 (GetETAShips)',
    apis: ['港口预抵船舶查询']
  }
];

// --- Real Implementation for Port Module ---

type TimeRangeOption = 'TODAY' | '24' | '48' | '72' | '168';
type ShipTypeFilter =
  | 'ALL'
  | 'CARGO'
  | 'TANKER'
  | 'PASSENGER'
  | 'SPECIAL'
  | 'FISHING'
  | 'UNKNOWN';

const TIME_RANGE_OPTIONS: TimeRangeOption[] = ['TODAY', '24', '48', '72', '168'];
const RISK_OPTIONS = ['ALL', 'HIGH', 'ATTENTION', 'NORMAL'] as const;
const DRAUGHT_OPTIONS = ['ALL', 'SHALLOW', 'MEDIUM', 'DEEP'] as const;
const SHIP_TYPE_OPTIONS: ShipTypeFilter[] = ['ALL', 'CARGO', 'TANKER', 'PASSENGER', 'SPECIAL', 'FISHING', 'UNKNOWN'];

const isTimeRangeOption = (value: any): value is TimeRangeOption =>
  typeof value === 'string' && TIME_RANGE_OPTIONS.includes(value as TimeRangeOption);
const isRiskFilterOption = (value: any): value is (typeof RISK_OPTIONS)[number] =>
  typeof value === 'string' && RISK_OPTIONS.includes(value as (typeof RISK_OPTIONS)[number]);
const isDraughtFilterOption = (value: any): value is (typeof DRAUGHT_OPTIONS)[number] =>
  typeof value === 'string' && DRAUGHT_OPTIONS.includes(value as (typeof DRAUGHT_OPTIONS)[number]);
const isShipTypeFilterOption = (value: any): value is ShipTypeFilter =>
  typeof value === 'string' && SHIP_TYPE_OPTIONS.includes(value as ShipTypeFilter);

interface DataQueryCenterProps {
  onFollowShip?: (ship: ShipxyShip) => void;
  isFollowed?: (mmsi: string | number) => boolean;
}

const PortModule: React.FC<DataQueryCenterProps> = ({ onFollowShip, isFollowed }) => {
  const [portCode, setPortCode] = useState('CNNJG'); // Default Nanjing
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('24'); // hours
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Data State
  const [rawData, setRawData] = useState<ShipxyShip[]>([]); // All fetched data
  const [data, setData] = useState<ShipxyShip[]>([]); // Filtered data for display
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Filter State
  const [shipTypeFilter, setShipTypeFilter] = useState<ShipTypeFilter>('CARGO'); // Changed default to CARGO as it maps to 70-79
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'ATTENTION' | 'NORMAL'>('ALL');
  const [draughtFilter, setDraughtFilter] = useState<'ALL' | 'SHALLOW' | 'MEDIUM' | 'DEEP'>('ALL');
  const [selectedShip, setSelectedShip] = useState<ShipxyShip | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedRisk = selectedShip ? evaluateRiskRules(selectedShip) : null;
  const selectedRiskReason = selectedRisk?.reason || '规则提示，非行政结论';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached);
      if (parsed.portCode) setPortCode(parsed.portCode);
      if (isTimeRangeOption(parsed.timeRange)) setTimeRange(parsed.timeRange);
      if (isShipTypeFilterOption(parsed.shipTypeFilter)) setShipTypeFilter(parsed.shipTypeFilter);
      if (isRiskFilterOption(parsed.riskFilter)) setRiskFilter(parsed.riskFilter);
      if (isDraughtFilterOption(parsed.draughtFilter)) setDraughtFilter(parsed.draughtFilter);
      if (typeof parsed.searchQuery === 'string') setSearchQuery(parsed.searchQuery);
      if (Array.isArray(parsed.rawData)) setRawData(parsed.rawData);
      if (parsed.lastUpdated) setLastUpdated(new Date(parsed.lastUpdated));
    } catch (err) {
      console.warn('Failed to restore cached port query', err);
    }
  }, []);

  // Apply filters whenever rawData or filter criteria change
  useEffect(() => {
    let result = rawData;

    const getEtaTime = (ship: ShipxyShip) => {
      const parsed = Date.parse((ship.eta || '').replace(' ', 'T'));
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    result = result.filter((ship) => !isMainlandFlag(ship.ship_flag));

    // Filter by Type
    if (shipTypeFilter === 'CARGO') {
        result = result.filter(s => {
            const t = Number(s.ship_type);
            return !isNaN(t) && t >= 70 && t <= 79;
        });
    } else if (shipTypeFilter === 'TANKER') {
        result = result.filter(s => {
            const t = Number(s.ship_type);
             return !isNaN(t) && t >= 80 && t <= 89;
        });
    } else if (shipTypeFilter === 'PASSENGER') {
        result = result.filter(s => {
            const t = Number(s.ship_type);
            return !isNaN(t) && t >= 60 && t <= 69;
        });
    } else if (shipTypeFilter === 'SPECIAL') {
        result = result.filter(s => {
            const t = Number(s.ship_type);
            return !isNaN(t) && t >= 50 && t <= 59;
        });
    } else if (shipTypeFilter === 'FISHING') {
        result = result.filter(s => {
            const t = Number(s.ship_type);
            return !isNaN(t) && t >= 30 && t <= 39;
        });
    } else if (shipTypeFilter === 'UNKNOWN') {
        result = result.filter(s => {
            const t = Number(s.ship_type);
            if (s.ship_type === null || s.ship_type === undefined) return true;
            if (typeof s.ship_type === 'string' && s.ship_type.trim() === '') return true;
            return Number.isNaN(t) || t === 0;
        });
    }

    if (riskFilter !== 'ALL') {
      result = result.filter((ship) => {
        const risk = evaluateRiskRules(ship);
        if (riskFilter === 'HIGH') return risk.level === RiskLevel.HIGH;
        if (riskFilter === 'ATTENTION') return risk.level === RiskLevel.ATTENTION;
        if (riskFilter === 'NORMAL') return risk.level === RiskLevel.NORMAL;
        return true;
      });
    }

    if (draughtFilter !== 'ALL') {
      result = result.filter((ship) => {
        const value = parseDraughtValue(ship.draught);
        if (value === null) return false;
        if (draughtFilter === 'SHALLOW') return value < 8;
        if (draughtFilter === 'MEDIUM') return value >= 8 && value < 14;
        if (draughtFilter === 'DEEP') return value >= 14;
        return true;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((ship) => {
        const name = (ship.ship_name || '').toLowerCase();
        const cnName = (ship.ship_cnname || '').toLowerCase();
        const mmsi = ship.mmsi ? String(ship.mmsi).toLowerCase() : '';
        return (
          name.includes(query) ||
          cnName.includes(query) ||
          mmsi.includes(query)
        );
      });
    }

    // Sort by ETA asc (最近靠前)
    result = [...result].sort((a, b) => getEtaTime(a) - getEtaTime(b));

    setData(result);
  }, [rawData, shipTypeFilter, riskFilter, draughtFilter, searchQuery]);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    try {
        const now = Math.floor(Date.now() / 1000) + 60; // start time必须大于当前
        const durationSeconds =
          timeRange === 'TODAY' ? computeTodayDurationSeconds() : Number(timeRange) * 3600;
        const end = now + durationSeconds;
        const targetPort = portCode.trim() || 'CNNJG';
        let shipTypeCode: number | undefined;
        if (shipTypeFilter === 'CARGO') shipTypeCode = 70;
        else if (shipTypeFilter === 'TANKER') shipTypeCode = 80;
        else if (shipTypeFilter === 'PASSENGER') shipTypeCode = 60;
        else if (shipTypeFilter === 'SPECIAL') shipTypeCode = 50;
        else if (shipTypeFilter === 'FISHING') shipTypeCode = 30;

        const res = await fetchETAShips(targetPort, now, end, shipTypeCode);
        if (res.status === 0) {
            const payload = res.data || [];
            setRawData(payload);
            const fetchedAt = new Date();
            setLastUpdated(fetchedAt);
            if (typeof window !== 'undefined') {
              const cachePayload = {
                portCode: targetPort,
                timeRange,
                shipTypeFilter,
                riskFilter,
                draughtFilter,
                searchQuery,
                rawData: payload,
                lastUpdated: fetchedAt.toISOString(),
              };
              localStorage.setItem(CACHE_KEY, JSON.stringify(cachePayload));
            }
        } else {
            setError(res.msg || 'API Error');
        }
    } catch (e) {
        setError('Network Error');
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full text-white">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 mb-6 border-b border-slate-800 pb-6">
        <div>
            <label className={labelClass}>港口代码</label>
            <div className="relative">
                <input 
                    type="text" 
                    value={portCode}
                    onChange={e => setPortCode(e.target.value)}
                    className={`w-32 font-mono uppercase ${inputClass}`}
                />
                <MapIcon className="absolute left-2.5 top-2.5 text-slate-400 w-4 h-4" />
            </div>
        </div>

        <div className="min-w-[190px] w-64">
            <label className={labelClass}>搜索关键词</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="输入船名或 MMSI"
                className={`w-full ${inputBaseClass} pl-8 pr-3 py-2`}
              />
            </div>
        </div>

        <div>
            <label className={labelClass}>时间范围</label>
            <select 
                value={timeRange}
                onChange={e => setTimeRange(e.target.value as TimeRangeOption)}
                className={selectClass}
            >
                <option value="TODAY">今天 (至 24:00)</option>
                <option value="24">未来 24 小时</option>
                <option value="48">未来 48 小时</option>
                <option value="72">未来 72 小时</option>
                <option value="168">未来 7 天</option>
            </select>
        </div>


        <div>
            <label className={labelClass}>船型筛选</label>
            <select 
                value={shipTypeFilter}
                onChange={e => setShipTypeFilter(e.target.value as ShipTypeFilter)}
                className={selectClass}
            >
                <option value="ALL">全部船型</option>
                <option value="CARGO">货船 (Cargo)</option>
                <option value="TANKER">油轮 (Tanker)</option>
                <option value="PASSENGER">客船 (Passenger)</option>
                <option value="SPECIAL">特种船 (Special)</option>
                <option value="FISHING">渔船 (Fishing)</option>
                <option value="UNKNOWN">未上报/未知</option>
            </select>
        </div>

        <div>
            <label className={labelClass}>风险级别</label>
            <select
                value={riskFilter}
                onChange={e => setRiskFilter(e.target.value as 'ALL' | 'HIGH' | 'ATTENTION' | 'NORMAL')}
                className={selectClass}
            >
                <option value="ALL">全部</option>
                <option value="HIGH">重点</option>
                <option value="ATTENTION">提醒</option>
                <option value="NORMAL">常规</option>
            </select>
        </div>

        <div>
            <label className={labelClass}>吃水深度</label>
            <select
                value={draughtFilter}
                onChange={e => setDraughtFilter(e.target.value as 'ALL' | 'SHALLOW' | 'MEDIUM' | 'DEEP')}
                className={selectClass}
            >
                <option value="ALL">全部</option>
                <option value="SHALLOW">浅吃水 (&lt; 8m)</option>
                <option value="MEDIUM">中等 (8-14m)</option>
                <option value="DEEP">深吃水 (&ge; 14m)</option>
            </select>
        </div>

        <button 
            onClick={handleFetch}
            disabled={loading}
            className="mb-[1px] px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
        >
            {loading ? <Loader2 className="animate-spin w-4 h-4" /> : <Search className="w-4 h-4" />}
            查询预抵
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-rose-500/10 text-rose-200 border border-rose-400/30 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto space-y-3">
        {data.map((ship, idx) => {
          const etaWeek = formatSmartWeekdayLabel(ship.eta);
          const normalizedDraught = getDraughtRatio(ship.draught);
          const markerPosition =
            normalizedDraught === null ? null : Math.max(4, (1 - normalizedDraught) * 100);
          const lastUpdatedRel = formatRelativeTime(ship.last_time_utc || ship.last_time);
          const draughtValue = parseDraughtValue(ship.draught);
          const risk = evaluateRiskRules(ship);
          const riskReason = risk.reason || '规则提示，非行政结论';
          return (
            <div
              key={`${ship.mmsi}-${idx}`}
              className="rounded-3xl border border-white/10 bg-slate-900/70 shadow-[0_20px_40px_-25px_rgba(0,0,0,0.9)] px-4 py-4 flex flex-col gap-4 md:flex-row md:items-center"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="text-3xl leading-none" title={ship.ship_flag || '未知船籍'}>
                  {getFlagEmoji(ship.ship_flag)}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <p className="text-base font-semibold text-white truncate">{ship.ship_name}</p>
                    <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-white/10 text-slate-100 border border-white/10">
                      {getShipTypeName(ship.ship_type)}
                    </span>
                    <div className="relative group">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getRiskBadgeClass(
                          risk.level
                        )}`}
                      >
                        {getRiskLabel(risk.level)}
                      </span>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap text-[11px] text-white bg-slate-900 px-2 py-1 rounded-lg border border-white/10 shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition">
                        {riskReason}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono">
                    MMSI {ship.mmsi} • IMO {ship.imo || '-'} • 船籍 {ship.ship_flag || '-'}
                  </p>
                </div>
              </div>
              <div className="flex-1 min-w-0 grid grid-cols-3 gap-4 text-xs text-slate-300">
                <div className="rounded-2xl border border-white/10 px-3 py-2 bg-slate-900/50 col-span-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="uppercase tracking-[0.2em] text-[9px] text-slate-400 mt-[2px]">ETA</p>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">
                        {ship.eta}
                        {etaWeek && <span className="text-xs text-slate-400 ml-1">({etaWeek})</span>}
                      </p>
                      {lastUpdatedRel && (
                        <p className="text-[11px] text-slate-500 mt-0.5">更新于 {lastUpdatedRel}</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 px-3 py-2 bg-slate-900/50">
                  <p className="text-[11px] text-slate-400">出发港</p>
                  <p className="text-sm font-semibold text-white truncate">
                    {formatPortWithCountry(ship.preport_cnname)}
                  </p>
                </div>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex flex-col items-center gap-1">
                  <div className="relative w-3 h-12 rounded-full bg-gradient-to-b from-emerald-200/70 via-cyan-300/60 to-blue-600/60 overflow-hidden border border-white/10">
                    {normalizedDraught !== null ? (
                      <>
                        <div className="absolute inset-0 bg-white/10" />
                        <div
                          className="absolute left-0 right-0 mx-auto transition-all duration-500 rounded-full bg-orange-400"
                          style={{
                            top: 0,
                            height: `${100 - markerPosition!}%`,
                            width: 'calc(100% - 2px)',
                          }}
                        />
                      </>
                    ) : (
                      <div className="absolute inset-0 bg-slate-200" />
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 text-right flex flex-col items-end gap-0.5">
                  <svg
                    className="w-4 h-4 text-slate-300"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 2s-6 7-6 11c0 3.59 2.91 6.5 6.5 6.5S19 16.59 19 13 12 2 12 2z" />
                  </svg>
                  <span className="block text-sm font-semibold text-white">
                    {draughtValue !== null ? `${draughtValue.toFixed(1)} m` : '-'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onFollowShip?.(ship)}
                    disabled={isFollowed?.(ship.mmsi)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      isFollowed?.(ship.mmsi)
                        ? 'border-emerald-500/40 text-emerald-200 cursor-not-allowed'
                        : 'border-slate-600 text-slate-200 hover:text-white hover:border-slate-400'
                    }`}
                  >
                    {isFollowed?.(ship.mmsi) ? '已关注' : '+关注'}
                  </button>
                <button
                  onClick={() => setSelectedShip(ship)}
                  className="p-2 rounded-full border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors"
                  aria-label="查看详情"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 5l8 7-8 7" />
                  </svg>
                </button>
                </div>
              </div>
            </div>
          );
        })}
        {!loading && data.length === 0 && (
          <div className="px-4 py-12 text-center text-slate-400 bg-slate-900/70 border border-white/10 rounded-3xl">
            {lastUpdated ? '未找到符合条件的船舶' : '请点击查询按钮获取数据'}
          </div>
        )}
      </div>
      
      {selectedShip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur p-4">
          <div className="bg-slate-950 rounded-3xl shadow-2xl w-full max-w-3xl border border-slate-800 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-900 text-white px-6 py-5 flex items-start justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-200">Vessel Detail</p>
                <h4 className="text-2xl font-semibold mt-1 leading-tight">{selectedShip.ship_name || '未知船名'}</h4>
                <p className="text-xs text-slate-200/80 font-mono mt-1">MMSI {selectedShip.mmsi} • IMO {selectedShip.imo || '-'}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="px-2.5 py-1 rounded-full bg-white/15 text-xs font-medium border border-white/20">
                    {selectedShip.ship_flag || '未知船籍'}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-white/15 text-xs font-medium border border-white/20">
                    {getShipTypeName(selectedShip.ship_type)}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-white/15 text-xs font-medium border border-white/20">
                    载重 {displayOrDash(selectedShip.dwt)}
                  </span>
                  {selectedRisk && (
                    <div className="relative group">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${getRiskBadgeClass(
                          selectedRisk.level
                        )}`}
                      >
                        {getRiskLabel(selectedRisk.level)}
                      </span>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap text-[11px] text-slate-900 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition">
                        {selectedRiskReason}
                      </div>
                    </div>
                  )}
                </div>
                {selectedRisk && (
                  <p className="text-[11px] text-slate-200/70 mt-2">
                    风险提示基于规则引擎，供参考，不代表行政结论。
                  </p>
                )}
              </div>
              <button 
                onClick={() => setSelectedShip(null)}
                className="p-2 text-white/80 hover:text-white rounded-full hover:bg-white/15 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5 text-white">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/60">
                  <p className="text-xs text-slate-400">尺寸</p>
                  <p className="text-sm font-semibold text-white mt-1">{`${selectedShip.length || '-'} m × ${selectedShip.width || '-'} m`}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/60">
                  <p className="text-xs text-slate-400">吃水</p>
                  <p className="text-sm font-semibold text-white mt-1">{selectedShip.draught ? `${selectedShip.draught} m` : '-'}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/60">
                  <p className="text-xs text-slate-400">目的地 / 出发港</p>
                  <p className="text-sm font-semibold text-white mt-1">{selectedShip.dest || '-'}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    出发港 {formatPortWithCountry(selectedShip.preport_cnname)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/70">
                  <p className="text-xs text-slate-400 mb-2">北京时间 (UTC+8)</p>
                  <div className="space-y-2">
                    <DetailRow label="最后更新时间" value={<span className="text-slate-300 font-normal">{formatBeijingWithWeek(selectedShip.last_time)}</span>} />
                    <DetailRow label="ETA" value={formatBeijingWithWeek(selectedShip.eta)} />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/70">
                  <p className="text-xs text-slate-400 mb-2">UTC</p>
                  <div className="space-y-2">
                    <DetailRow label="ETA (UTC)" value={formatUtcSeconds(selectedShip.eta_utc)} />
                    <DetailRow label="最后更新时间 (UTC)" value={<span className="text-slate-300 font-normal">{formatUtcSeconds(selectedShip.last_time_utc)}</span>} />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-900 border-t border-slate-800 flex justify-end">
              <button 
                onClick={() => setSelectedShip(null)}
                className="px-4 py-2 text-sm font-medium text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Footer Status */}
      <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
        <span>共检索到 {data.length} 艘船舶</span>
        <span>数据来源: Shipxy GetETAShips API • 更新于: {lastUpdated ? lastUpdated.toLocaleTimeString() : '-'}</span>
      </div>
    </div>
  );
};

// Placeholder modules
export const DataQueryCenter: React.FC<DataQueryCenterProps> = (props) => {
  const [activeTool] = useState<string>('port');

  const renderToolContent = () => {
    switch (activeTool) {
      case 'port':
        return <PortModule {...props} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in h-full flex flex-col bg-slate-950 text-white rounded-3xl p-6 border border-slate-900 shadow-2xl">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            {TOOLS.find(t => t.id === activeTool)?.title || '数据查询中心'}
          </h2>
          <div className="flex items-center gap-3 mt-1">
             <p className="text-slate-400 text-sm">
              通过 Shipxy GetETAShips 查询港口预抵船舶
            </p>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 border border-emerald-400/30 rounded-full text-[10px] text-emerald-200 font-medium">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
              <span>API 已连接 (Key: ...{API_CONFIG.API_KEY.slice(-4)})</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-slate-950/80 border border-slate-900 rounded-2xl shadow-inner p-6 overflow-hidden flex flex-col">
        {renderToolContent()}
      </div>
    </div>
  );
};
