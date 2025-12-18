import React, { useEffect, useMemo, useState } from 'react';
import { Ship, RiskLevel, ShipEvent } from '../types';
import { MOCK_SHIPS } from '../constants';
import { Clock, Ship as ShipIcon, Globe2, RefreshCw, Loader2, ArrowUpRight, Activity } from 'lucide-react';
import { isMainlandFlag } from '../utils/ship';
import { getRiskLabel, getRiskBadgeClass } from '../utils/risk';
import { formatSmartWeekdayLabel } from '../utils/date';
import { fetchShipEvents } from '../api';
import { EVENT_ICON_META } from './eventMeta';

interface DashboardProps {
  ships: Ship[];
  allShips: Ship[];
  flagFilter: 'ALL' | 'FOREIGN' | 'CHINA';
  onFlagChange: (filter: 'ALL' | 'FOREIGN' | 'CHINA') => void;
  onRefresh: () => void;
  refreshing: boolean;
  onSelectShip: (ship: Ship | null) => void;
  onNavigateToEvents?: () => void;
  onNavigateToArrivals?: () => void;
  onFollowShip?: (ship: Ship) => void;
  followedSet?: Set<string>;
}

const FLAG_EMOJI_MAP: Record<string, string> = {
  CHINA: '🇨🇳',
  PRCHINA: '🇨🇳',
  CHINAPEOPLESREPUBLICOF: '🇨🇳',
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
  中华人民共和国: '🇨🇳',
  香港: '🇭🇰',
  澳门: '🇲🇴',
  台湾: '🇹🇼',
  日本: '🇯🇵',
  新加坡: '🇸🇬',
  美国: '🇺🇸',
  英国: '🇬🇧',
  巴拿马: '🇵🇦',
  利比里亚: '🇱🇷',
  斯里兰卡: '🇱🇰',
  马绍尔群岛: '🇲🇭',
  马绍尔: '🇲🇭',
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

export const DashboardRadar: React.FC<DashboardProps> = ({
  ships,
  allShips,
  flagFilter,
  onFlagChange,
  onRefresh,
  refreshing,
  onSelectShip,
  onNavigateToEvents,
  onNavigateToArrivals,
  onFollowShip,
  followedSet,
}) => {
  const [timeRange, setTimeRange] = useState<'24h' | '72h' | '7d'>('24h');
  const [arrivalFilter, setArrivalFilter] = useState<'ALL' | 'TODAY' | 'TOMORROW'>('ALL');
  const [shipEvents, setShipEvents] = useState<ShipEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);

  const parseEtaToTs = (eta?: string) => {
    if (!eta) return null;
    const normalized = eta.replace(' ', 'T');
    const candidates = [
      normalized.endsWith('Z') || normalized.includes('+') ? normalized : `${normalized}+08:00`,
      `${normalized}Z`,
      normalized,
    ];
    for (const c of candidates) {
      const ts = Date.parse(c);
      if (!Number.isNaN(ts)) return ts;
    }
    return null;
  };

  useEffect(() => {
    let active = true;
    const loadEvents = async () => {
      if (!import.meta.env.VITE_LOCAL_API) {
        setShipEvents([]);
        return;
      }
      setEventsLoading(true);
      setEventsError(null);
      try {
        const events = await fetchShipEvents(Date.now() - 6 * 3600 * 1000);
        if (active) {
          setShipEvents(events);
        }
      } catch (err) {
        console.warn(err);
        if (active) setEventsError('动态加载失败');
      } finally {
        if (active) setEventsLoading(false);
      }
    };
    loadEvents();
    const interval = setInterval(loadEvents, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const shipLookup = useMemo(() => {
    const map = new Map<string, Ship>();
    const source = allShips.length > 0 ? allShips : ships.length > 0 ? ships : MOCK_SHIPS;
    source.forEach((ship) => map.set(ship.mmsi.toString(), ship));
    return map;
  }, [allShips, ships]);

  const filteredShipEvents = useMemo(() => {
    return shipEvents.filter((event) => {
      const key = typeof event.mmsi === 'string' ? event.mmsi : String(event.mmsi);
      const ship = shipLookup.get(key);
      const flag = (event.ship_flag || ship?.flag || '').trim();
      if (!flag) return flagFilter === 'ALL';
      const mainland = isMainlandFlag(flag);
      if (flagFilter === 'FOREIGN') return !mainland;
      if (flagFilter === 'CHINA') return mainland;
      return true;
    });
  }, [shipEvents, shipLookup, flagFilter]);

  const displayedEvents = useMemo(() => filteredShipEvents.slice(0, 10), [filteredShipEvents]);

  const normalizedShips = useMemo(() => {
    const base = ships.length > 0 ? ships : MOCK_SHIPS;
    return base.map((s) => ({
      ...s,
      etaTs: parseEtaToTs(s.eta),
    }));
  }, [ships]);

  const getFilteredShips = () => {
    const now = Date.now();
    let cutoff = now;
    if (timeRange === '24h') cutoff = now + 24 * 60 * 60 * 1000;
    if (timeRange === '72h') cutoff = now + 72 * 60 * 60 * 1000;
    if (timeRange === '7d') cutoff = now + 7 * 24 * 60 * 60 * 1000;
    
    const filtered = normalizedShips.filter(s => {
      if (s.etaTs === null) return false;
      return s.etaTs <= cutoff && s.etaTs >= now;
    });
    return filtered.length > 0 ? filtered : normalizedShips;
  };

  const displayShips = useMemo(() => {
    const source = getFilteredShips();
    return [...source].sort((a, b) => {
      const etaA = parseEtaToTs(a.eta) ?? 0;
      const etaB = parseEtaToTs(b.eta) ?? 0;
      return etaA - etaB;
    });
  }, [timeRange, normalizedShips]);

  const draughtStats = {
    min: 2,
    max: 20,
  };

  const getDraughtRatio = (value?: number) => {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return null;
    }
    const clamped = Math.min(Math.max(value, draughtStats.min), draughtStats.max);
    const ratio = (clamped - draughtStats.min) / (draughtStats.max - draughtStats.min);
    return Math.min(1, Math.max(0, ratio));
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

  const foreignCount = useMemo(() => {
    return displayShips.filter((s) => {
      const flag = s.flag ?? '';
      if (!flag.trim()) return false;
      return !isMainlandFlag(flag);
    }).length;
  }, [displayShips]);
  const next12hCount = useMemo(() => {
    const now = Date.now();
    return displayShips.filter((s) => {
      const eta = s.etaTs ?? parseEtaToTs(s.eta);
      const diff = (eta - now) / (1000 * 60 * 60);
      return diff >= 0 && diff <= 12;
    }).length;
  }, [displayShips]);
  const typeCount = useMemo(() => {
    const set = new Set(displayShips.map((s) => s.type));
    return set.size;
  }, [displayShips]);

  const riskStats = useMemo(() => {
    const counts = {
      high: 0,
      attention: 0,
      normal: 0,
    };
    displayShips.forEach((ship) => {
      if (ship.riskLevel === RiskLevel.HIGH) counts.high += 1;
      else if (ship.riskLevel === RiskLevel.ATTENTION) counts.attention += 1;
      else counts.normal += 1;
    });
    const total = counts.high + counts.attention + counts.normal;
    return { counts, total };
  }, [displayShips]);

  const riskSegments = [
    { key: 'high', label: '重点', color: '#b91c1c', count: riskStats.counts.high },
    { key: 'attention', label: '提醒', color: '#fbbf24', count: riskStats.counts.attention },
    { key: 'normal', label: '常规', color: '#34d399', count: riskStats.counts.normal },
  ];

  const riskGradient =
    riskStats.total > 0
      ? `conic-gradient(${riskSegments
          .map((seg, idx) => {
            const start =
              (riskSegments.slice(0, idx).reduce((sum, item) => sum + item.count, 0) /
                riskStats.total) *
              360;
            const end = start + (seg.count / riskStats.total) * 360;
            return `${seg.color} ${start}deg ${end}deg`;
          })
          .join(', ')})`
      : 'conic-gradient(#1f2937 0deg 360deg)';

  // Pie Chart Data: Ship Types
  const typeData = displayShips.reduce((acc: any[], ship) => {
    const existing = acc.find(i => i.name === ship.type);
    if (existing) existing.value++;
    else acc.push({ name: ship.type, value: 1 });
    return acc;
  }, []);
  const totalTypeCount = typeData.reduce((sum, item) => sum + item.value, 0);

  // Bar Chart Data: Arrival Distribution
  // Simply bucket by 6-hour intervals for demonstration
  const hourlyData = useMemo(() => {
    const buckets = [
      { name: '0-6h', count: 0 },
      { name: '6-12h', count: 0 },
      { name: '12-18h', count: 0 },
      { name: '18h+', count: 0 },
    ];
    const now = Date.now();
    displayShips.forEach(ship => {
      const eta = ship.etaTs ?? parseEtaToTs(ship.eta);
      if (!eta) return;
      const diffHours = (eta - now) / (1000 * 60 * 60);
      if (diffHours < 0) {
        buckets[0].count++;
        return;
      }
      if (diffHours < 6) buckets[0].count++;
      else if (diffHours < 12) buckets[1].count++;
      else if (diffHours < 18) buckets[2].count++;
      else buckets[3].count++;
    });
    return buckets;
  }, [displayShips]);
  const hourlyMax = Math.max(...hourlyData.map(b => b.count)) || 1;
  const topBucket = hourlyData.reduce((prev, curr) => (curr.count > prev.count ? curr : prev), hourlyData[0]);
  const lowestBucket = hourlyData.reduce((prev, curr) => (curr.count < prev.count ? curr : prev), hourlyData[0]);

  const arrivalFilteredShips = useMemo(() => {
    if (arrivalFilter === 'ALL') return displayShips;
    return displayShips.filter((ship) => {
      const label = formatSmartWeekdayLabel(ship.eta);
      if (arrivalFilter === 'TODAY') return label === '今天';
      if (arrivalFilter === 'TOMORROW') return label === '明天';
      return true;
    });
  }, [arrivalFilter, displayShips]);

  return (
    <div className="space-y-4 animate-fade-in bg-slate-950 text-white rounded-3xl p-5 shadow-2xl border border-slate-800">
      {/* Header & Controls */}
      <div className="flex flex-col gap-3 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-left">
            <h2 className="text-2xl font-bold text-white leading-tight">港口未来到港雷达</h2>
            <p className="text-slate-200 text-sm mt-1">
              实时监控未来预抵船舶态势，支持提前布防。
            </p>
          </div>
          <div className="flex flex-col lg:flex-row items-center justify-center gap-2">
            <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 shadow-inner">
              {(['24h', '72h', '7d'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                    timeRange === range
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  未来 {range}
                </button>
              ))}
            </div>
            <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 shadow-inner">
              {[
                { id: 'FOREIGN', label: '仅外籍' },
                { id: 'ALL', label: '全部' },
                { id: 'CHINA', label: '仅中国籍' },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => onFlagChange(option.id as 'ALL' | 'FOREIGN' | 'CHINA')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    flagFilter === option.id
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${
                refreshing
                  ? 'bg-slate-800 border-slate-700 text-slate-300 cursor-not-allowed'
                  : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white'
              }`}
            >
              {refreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>{refreshing ? '刷新中...' : '手动刷新'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Charts + Side Column */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
        {/* Arrival Trend */}
        <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-lg">
          <h3 className="text-lg font-semibold text-white mb-6">到港流量分布 (未来 {timeRange})</h3>
          {hourlyData.some(bucket => bucket.count > 0) ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-slate-400">高峰时段</p>
                    <p className="text-xl font-semibold text-white">{topBucket.name}</p>
                    <p className="text-sm text-slate-400">{topBucket.count} 艘预计抵港</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <p>最低：{lowestBucket.name}</p>
                    <p>{lowestBucket.count} 艘</p>
                  </div>
                </div>
                <div className="mt-6 flex items-center gap-2">
                  {hourlyData.map((bucket, idx) => {
                    const minSize = 18;
                    const maxSize = 86;
                    const circleSize = minSize + (bucket.count / hourlyMax) * (maxSize - minSize) + (bucket.name === topBucket.name ? 12 : 0);
                    const gradientClass = bucket.count === topBucket.count
                      ? 'from-orange-500 to-yellow-400'
                      : bucket.count === lowestBucket.count
                      ? 'from-emerald-500 to-lime-400'
                      : 'from-blue-500 to-sky-400';
                    return (
                      <div key={`node-${bucket.name}`} className="flex-1 flex flex-col items-center relative">
                        <div
                          className={`rounded-full flex items-center justify-center text-sm font-semibold text-white shadow bg-gradient-to-br ${gradientClass}`}
                          style={{ width: `${circleSize}px`, height: `${circleSize}px` }}
                        >
                          {bucket.count}
                        </div>
                        {idx < hourlyData.length - 1 && (
                          <div className="h-px bg-gradient-to-r from-slate-700 to-slate-700 flex-1 w-full absolute top-1/2 left-1/2 transform -translate-y-1/2 translate-x-1/2" />
                        )}
                        <span className="mt-2 text-xs text-slate-400">{bucket.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {hourlyData.map(bucket => {
                  const percentage = (bucket.count / hourlyMax) * 100;
                  const gradientClass = bucket.count === topBucket.count
                    ? 'from-orange-500 to-yellow-400'
                    : bucket.count === lowestBucket.count
                    ? 'from-emerald-500 to-lime-400'
                    : 'from-blue-500 to-sky-400';
                  return (
                    <div key={`mini-${bucket.name}`} className="flex flex-col gap-1.5 bg-slate-900 border border-slate-800 rounded-2xl p-2.5">
                      <div className="text-[11px] text-slate-400 uppercase tracking-wide">{bucket.name}</div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r rounded-full ${gradientClass}`}
                          style={{ width: `${percentage || 5}%` }}
                        />
                      </div>
                      <div className="text-xl font-semibold text-white">
                        {bucket.count}
                        <span className="text-[11px] text-slate-400 ml-1">艘</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
              暂无可显示的数据
            </div>
          )}
        </div>
        {/* Recent Updates */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">进港动态</h3>
          <p className="text-xs text-slate-400 mt-0.5">按未来 ETA 分类查看</p>
        </div>
        <div className="flex items-center gap-2">
          {[
            { id: 'ALL', label: '全部' },
            { id: 'TODAY', label: '今天' },
            { id: 'TOMORROW', label: '明天' },
          ].map((option) => (
            <button
              key={option.id}
              onClick={() => setArrivalFilter(option.id as 'ALL' | 'TODAY' | 'TOMORROW')}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                arrivalFilter === option.id
                  ? 'bg-blue-500/20 text-blue-100 border-blue-400/40'
                  : 'text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
          {onNavigateToArrivals && (
            <button
              onClick={onNavigateToArrivals}
              className="p-2 rounded-full border border-slate-700 text-slate-300 hover:border-blue-400 hover:text-white transition"
              title="查看全部进港船舶"
            >
              <ArrowUpRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
          <div className="space-y-3 p-3">
        {arrivalFilteredShips.slice(0, 5).map((ship, idx) => {
           const normalizedDraught = getDraughtRatio(ship.draught);
           const markerPosition =
             normalizedDraught === null ? null : Math.max(4, (1 - normalizedDraught) * 100);
           const etaWeekLabel = formatSmartWeekdayLabel(ship.eta);
           const isFollowed = followedSet?.has(ship.mmsi) ?? false;
           return (
           <div
             key={idx}
                 className="rounded-3xl border border-white/5 bg-gradient-to-br from-slate-900/70 via-slate-900/40 to-slate-900/20 px-4 py-4 backdrop-blur flex flex-col gap-4 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.8)] md:flex-row md:items-center"
               >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="text-3xl leading-none drop-shadow" title={ship.flag || '未知船籍'}>
                      {getFlagEmoji(ship.flag)}
                    </div>
                    <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <p className="text-base font-semibold text-white truncate">{ship.name}</p>
                    <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-white/10 text-slate-100 border border-white/10">
                      {ship.type || 'Unknown'}
                    </span>
                    <div className="relative group">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getRiskBadgeClass(
                          ship.riskLevel
                        )}`}
                      >
                        {getRiskLabel(ship.riskLevel)}
                      </span>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap text-[11px] text-slate-900 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition">
                        {ship.riskReason || '规则提示，非行政结论'}
                      </div>
                    </div>
                  </div>
                  {ship.cnName && (
                    <p className="text-xs text-slate-400 truncate">{ship.cnName}</p>
                  )}
                  <p className="text-[11px] text-slate-500 font-mono">
                    MMSI {ship.mmsi} • 船籍 {ship.flag || '-'}
                  </p>
                </div>
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-2 gap-4 text-xs text-slate-400">
                    <div className="rounded-2xl border border-white/5 px-3 py-2 bg-white/5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="uppercase tracking-[0.2em] text-[9px] text-slate-400 mt-[3px]">ETA</p>
                        <div className="flex flex-col text-right">
                          <p className="text-sm font-semibold text-white">
                            {new Date(ship.eta).toLocaleString('zh-CN', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {etaWeekLabel && (
                              <span className="text-xs text-slate-400 ml-1">({etaWeekLabel})</span>
                            )}
                          </p>
                          {formatRelativeTime(ship.lastTimeUtc || ship.lastTime) && (
                            <span className="text-[11px] text-slate-500">
                              更新于 {formatRelativeTime(ship.lastTimeUtc || ship.lastTime)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/5 px-3 py-2 bg-white/5">
                      <p className="text-[11px] text-slate-400 mb-0.5">上一港</p>
                      <p className="text-sm font-semibold text-white truncate">{ship.lastPort || '-'}</p>
                    </div>
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex flex-col items-center gap-1">
                      <div className="relative w-3 h-12 rounded-full bg-gradient-to-b from-emerald-400 via-cyan-400 to-blue-900 overflow-hidden border border-slate-700">
                        {normalizedDraught !== null ? (
                          <>
                            <div className="absolute inset-0 bg-slate-900/10" />
                            <div
                              className="absolute left-0 right-0 mx-auto transition-all duration-500 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.45)]"
                              style={{
                                top: 0,
                                height: `${100 - markerPosition!}%`,
                                width: 'calc(100% - 2px)',
                              }}
                            />
                          </>
                        ) : (
                          <div className="absolute inset-0 bg-slate-800/60" />
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 text-right flex flex-col items-end gap-0.5">
                      <svg
                        className="w-4 h-4 text-slate-400"
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
                        {ship.draught ? `${ship.draught.toFixed(1)} m` : '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onFollowShip && !isFollowed && onFollowShip(ship)}
                        disabled={!onFollowShip || isFollowed}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          isFollowed
                            ? 'border-emerald-500/40 text-emerald-200 cursor-not-allowed'
                            : 'border-white/20 text-white/70 hover:text-white hover:border-white/40'
                        }`}
                      >
                        {isFollowed ? '已关注' : '+关注'}
                      </button>
                      <button
                        onClick={() => onSelectShip(ship)}
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
             )})}
             {arrivalFilteredShips.length === 0 && (
               <div className="text-center text-sm text-slate-500 py-6">
                 暂无符合该分类的船舶
               </div>
             )}
          </div>
        </div>
        </div>

        {/* Side Column with KPIs + Ship Types */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="p-3 bg-blue-900/80 text-blue-200 rounded-lg">
                  <ShipIcon size={20} />
                </div>
                <span className="text-xs text-slate-200">未来 {timeRange}</span>
              </div>
              <p className="text-2xl font-semibold text-white mt-4">{displayShips.length}</p>
              <p className="text-xs text-slate-300">预计到港艘次</p>
            </div>
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="p-3 bg-amber-900/80 text-amber-200 rounded-lg">
                  <Clock size={20} />
                </div>
                <span className="text-xs text-slate-200">12 小时</span>
              </div>
              <p className="text-xl font-semibold text-white mt-4">{next12hCount}</p>
              <p className="text-xs text-slate-300">即将抵港</p>
            </div>
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="p-3 bg-emerald-900/80 text-emerald-200 rounded-lg">
                  <Globe2 size={20} />
                </div>
                <span className="text-xs text-slate-200">按船籍</span>
              </div>
              <p className="text-xl font-semibold text-white mt-4">{foreignCount}</p>
              <p className="text-xs text-slate-300">外籍/港澳台</p>
            </div>
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="p-3 bg-indigo-900/80 text-indigo-200 rounded-lg">
                  <Activity size={20} />
                </div>
                <span className="text-xs text-slate-200">覆盖</span>
              </div>
              <p className="text-xl font-semibold text-white mt-4">{typeCount}</p>
              <p className="text-xs text-slate-300">船型种类</p>
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">实时动态</h3>
              {onNavigateToEvents && (
                <button
                  onClick={onNavigateToEvents}
                  className="p-1.5 rounded-full border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
                  title="查看全部动态"
                >
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              )}
            </div>
            {eventsLoading && <span className="text-xs text-slate-400">更新中...</span>}
          </div>
            {displayedEvents.length > 0 ? (
              <div className="divide-y divide-slate-800">
                {displayedEvents.map((event) => {
                  const meta = EVENT_ICON_META[event.event_type] || EVENT_ICON_META.DEFAULT;
                  const IconComp = meta.icon;
                  const eventShipKey =
                    typeof event.mmsi === 'string' ? event.mmsi : String(event.mmsi);
                  const eventShip = shipLookup.get(eventShipKey);
                  const shipName = eventShip?.name;
                  let detailRemainder = event.detail;
                  if (shipName && detailRemainder.startsWith(shipName)) {
                    detailRemainder = detailRemainder.slice(shipName.length).trimStart();
                  }
                  return (
                    <div
                      key={`${event.mmsi}-${event.detected_at}`}
                      className="px-6 py-4 flex items-center gap-3"
                    >
                      <div
                        className={`w-10 h-10 rounded-full border flex items-center justify-center ${meta.className}`}
                        title={meta.label}
                      >
                        <IconComp className="w-4 h-4" />
                        <span className="sr-only">{meta.label}</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-white flex items-center flex-wrap gap-1">
                          {shipName && eventShip ? (
                            <button
                              className="text-emerald-300 hover:text-white font-semibold underline-offset-2 hover:underline transition-colors"
                              onClick={() => onSelectShip(eventShip)}
                            >
                              {shipName}
                            </button>
                          ) : null}
                          <span>{shipName ? detailRemainder || '动态更新' : event.detail}</span>
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          MMSI {event.mmsi} ·{' '}
                          {new Date(event.detected_at).toLocaleString('zh-CN', { hour12: false })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-6 py-8 text-center text-sm text-slate-500">
                {eventsLoading ? '动态同步中...' : '暂无外籍船动态'}
              </div>
            )}
            {eventsError && (
              <div className="px-6 py-3 border-t border-slate-800 text-amber-300 text-xs text-center">
                {eventsError}
              </div>
            )}
          </div>

          <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">风险等级分布</h3>
              <span className="text-xs text-slate-400">当前筛选</span>
            </div>
            <div className="mt-5 flex items-center gap-6">
              <div className="relative">
                <div
                  className="w-32 h-32 rounded-full border border-slate-800 shadow-inner"
                  style={{ background: riskGradient }}
                />
                <div className="absolute inset-5 rounded-full bg-slate-950 border border-slate-800 flex flex-col items-center justify-center">
                  <p className="text-2xl font-semibold text-white">{riskStats.total}</p>
                  <p className="text-xs text-slate-400">艘船</p>
                </div>
              </div>
              <div className="flex-1 space-y-3">
                {riskSegments.map((seg) => {
                  const pct = riskStats.total ? Math.round((seg.count / riskStats.total) * 100) : 0;
                  return (
                    <div key={seg.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: seg.color }}
                        />
                        <p className="text-sm text-slate-300">{seg.label}</p>
                      </div>
                      <div className="text-sm font-semibold text-white">
                        {seg.count}
                        <span className="text-xs text-slate-400 ml-1">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
                {riskStats.total === 0 && (
                  <p className="text-xs text-slate-500">暂无可统计的船舶数据</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-lg">
            <h3 className="text-lg font-semibold text-white mb-2">预抵船型构成</h3>
            <div className="space-y-4 mt-4">
              {typeData.length > 0 ? (
                typeData.slice(0, 10).map((entry) => {
                  const percentage = totalTypeCount ? (entry.value / totalTypeCount) * 100 : 0;
                  return (
                    <div key={entry.name}>
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                        <span>{entry.name}</span>
                        <span>{entry.value} 艘</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-sky-400 rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-slate-400 text-sm text-center py-10">暂无数据</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
