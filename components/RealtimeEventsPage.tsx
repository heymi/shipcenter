import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { autoAnalyzeShipWithAI, batchAnalyzeShipAi, fetchShipAiAnalysis, fetchShipEvents } from '../api';
import { Ship, ShipEvent } from '../types';
import { EVENT_ICON_META } from './eventMeta';
import { isMainlandFlag } from '../utils/ship';
import { getRiskBadgeClass, getRiskLabel } from '../utils/risk';
import { ArrivalDetailsPage } from './ArrivalDetailsPage';
import { supabase } from '../supabaseClient';

interface RealtimeEventsPageProps {
  ships: Ship[];
  allShips: Ship[];
  onSelectShip: (ship: Ship) => void;
  onFollowShip?: (ship: Ship) => void;
  followedSet?: Set<string>;
  dockdayTargetSet?: Set<string>;
  tab?: 'events' | 'arrivals';
  onTabChange?: (tab: 'events' | 'arrivals') => void;
  arrivalDataUpdatedAt?: number | null;
  onShareArrivals?: () => void;
  shareArrivalsActive?: boolean;
  isShareModeArrivals?: boolean;
}

type SeverityLevel = 'high' | 'medium' | 'low';

const EVENT_SEVERITY: Record<string, SeverityLevel> = {
  ARRIVAL_URGENT: 'high',
  RISK_LEVEL_CHANGE: 'high',
  DRAUGHT_SPIKE: 'medium',
  ARRIVAL_IMMINENT: 'medium',
  STALE_SIGNAL: 'medium',
  ARRIVAL_SOON: 'medium',
  FOREIGN_REPORT: 'medium',
  ETA_UPDATE: 'low',
  LAST_PORT_CHANGE: 'low',
  DEFAULT: 'low',
};

const severityWeight: Record<SeverityLevel, number> = { high: 3, medium: 2, low: 1 };
const EVENT_FETCH_HISTORY_HOURS = (() => {
  const raw = Number((import.meta as any)?.env?.VITE_EVENT_HISTORY_HOURS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 7 * 24;
})();
const EVENT_FETCH_LIMIT = (() => {
  const raw = Number((import.meta as any)?.env?.VITE_EVENT_FETCH_LIMIT);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 1000;
})();
const getSeverity = (type: string): SeverityLevel => EVENT_SEVERITY[type] || EVENT_SEVERITY.DEFAULT;
const SIDEBAR_SCROLL_ANIMATION = `
@keyframes dockdaySidebarScroll {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-50%);
  }
}
`;

export const RealtimeEventsPage: React.FC<RealtimeEventsPageProps> = ({
  ships,
  allShips,
  onSelectShip,
  onFollowShip,
  followedSet,
  dockdayTargetSet,
  tab,
  onTabChange,
  arrivalDataUpdatedAt,
  onShareArrivals,
  shareArrivalsActive,
  isShareModeArrivals,
}) => {
  const [shipEvents, setShipEvents] = useState<ShipEvent[]>([]);
  const [internalTab, setInternalTab] = useState<'arrivals' | 'events'>(tab ?? 'arrivals');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinceHours, setSinceHours] = useState(12);
  const [eventType, setEventType] = useState('ALL');
  const [page, setPage] = useState(1);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const knownMmsiRef = useRef<Set<string>>(new Set());
  const autoQueueRef = useRef<Promise<void>>(Promise.resolve());
  const PAGE_SIZE = 15;
  const batchOnceKey = 'dockday_ai_batch_events_v1';

  const canRunAi = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      return Boolean(data?.session?.access_token);
    } catch (err) {
      console.warn('Failed to resolve auth session', err);
      return false;
    }
  }, []);

  const normalizeMmsi = useCallback((value: ShipEvent['mmsi']) => {
    return String(value ?? '').replace(/\.0+$/, '').trim();
  }, []);

  const eventsByMmsi = useMemo(() => {
    const map = new Map<string, ShipEvent[]>();
    shipEvents.forEach((event) => {
      const key = normalizeMmsi(event.mmsi);
      if (!key) return;
      const list = map.get(key) || [];
      list.push(event);
      map.set(key, list);
    });
    map.forEach((list) =>
      list.sort((a, b) => (b.detected_at || 0) - (a.detected_at || 0))
    );
    return map;
  }, [shipEvents, normalizeMmsi]);

  const buildAiShipPayload = useCallback(
    (ship: Ship | undefined, mmsi: string, fallbackFlag?: string) => ({
      name: ship?.name,
      mmsi: ship?.mmsi ?? mmsi,
      imo: ship?.imo,
      flag: ship?.flag || fallbackFlag,
      type: ship?.type,
      eta: ship?.eta,
      etd: ship?.etd,
      etaUtc: ship?.etaUtc,
      lastTime: ship?.lastTime,
      lastTimeUtc: ship?.lastTimeUtc,
      dest: ship?.dest,
      last_port: ship?.lastPort,
      lastPort: ship?.lastPort,
      dwt: ship?.dwt,
      length: ship?.length,
      width: ship?.width,
      draught: ship?.draught,
      agent: ship?.agent,
      docStatus: ship?.docStatus,
      riskReason: ship?.riskReason,
    }),
    []
  );

  const runBatchAnalysis = useCallback(
    async (force = false) => {
      const ok = await canRunAi();
      if (!ok) {
        setBatchMessage('请先登录后再执行 AI 分析');
        return;
      }
      if (!force && localStorage.getItem(batchOnceKey)) return;
      setBatchLoading(true);
      setBatchMessage(null);
      try {
        const summary = await batchAnalyzeShipAi({
          scope: 'events',
          since_hours: EVENT_FETCH_HISTORY_HOURS,
          limit: 30,
          max_sources: 4,
          max_per_source: 1,
        });
        setBatchMessage(`存量分析完成：${summary.analyzed} 已分析，${summary.skipped} 已存在`);
        localStorage.setItem(batchOnceKey, String(Date.now()));
      } catch (err) {
        console.warn('批量 AI 分析失败', err);
        setBatchMessage('存量分析失败，请稍后重试');
      } finally {
        setBatchLoading(false);
      }
    },
    [batchOnceKey, canRunAi]
  );

  const runFilteredBatchAnalysis = useCallback(async () => {
    const ok = await canRunAi();
    if (!ok) {
      setBatchMessage('请先登录后再执行 AI 分析');
      return;
    }
    setBatchLoading(true);
    setBatchMessage(null);
    try {
      const uniqueMmsi = new Set<string>();
      shipEvents.forEach((event) => {
        const mmsi = normalizeMmsi(event.mmsi);
        if (mmsi) uniqueMmsi.add(mmsi);
      });
      const summary = await batchAnalyzeShipAi({
        scope: 'events',
        since_hours: sinceHours,
        limit: Math.max(1, Math.min(200, uniqueMmsi.size || 1)),
        max_sources: 4,
        max_per_source: 1,
      });
      setBatchMessage(`当前动态分析完成：${summary.analyzed} 已分析，${summary.skipped} 已存在`);
    } catch (err) {
      console.warn('当前动态 AI 分析失败', err);
      setBatchMessage('当前动态分析失败，请稍后重试');
    } finally {
      setBatchLoading(false);
    }
  }, [canRunAi, normalizeMmsi, shipEvents, sinceHours]);

  const shipLookup = useMemo(() => {
    const map = new Map<string, Ship>();
    const pool = allShips.length > 0 ? allShips : ships;
    pool.forEach((ship) => map.set(ship.mmsi.toString(), ship));
    return map;
  }, [ships, allShips]);

  const enqueueAutoAnalyze = useCallback(
    (mmsiList: string[]) => {
      autoQueueRef.current = autoQueueRef.current.then(async () => {
        const ok = await canRunAi();
        if (!ok) return;
        for (const mmsi of mmsiList) {
          try {
            const existing = await fetchShipAiAnalysis(mmsi);
            if (existing.data) continue;
            const ship = shipLookup.get(mmsi);
            const relatedEvents = (eventsByMmsi.get(mmsi) || []).slice(0, 6);
            await autoAnalyzeShipWithAI({
              ship: buildAiShipPayload(ship, mmsi, relatedEvents[0]?.ship_flag),
              events: relatedEvents.map((event) => ({
                event_type: event.event_type,
                detail: event.detail,
                detected_at: event.detected_at,
              })),
              max_sources: 4,
              max_per_source: 1,
            });
          } catch (err) {
            console.warn('自动 AI 分析失败', err);
          }
        }
      });
    },
    [buildAiShipPayload, canRunAi, eventsByMmsi, shipLookup]
  );

  const loadEvents = useCallback(async () => {
    if (!import.meta.env.VITE_LOCAL_API) {
      setShipEvents([]);
      setError('本地 API 未启用，无法获取动态');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const sinceTs = Date.now() - EVENT_FETCH_HISTORY_HOURS * 3600 * 1000;
      const events = await fetchShipEvents(sinceTs, EVENT_FETCH_LIMIT);
      setShipEvents(events);
      setLastRefreshAt(Date.now());
    } catch (err) {
      console.warn(err);
      setError('动态加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
    const interval = setInterval(loadEvents, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadEvents]);

  useEffect(() => {
    setPage(1);
  }, [eventType, sinceHours]);

  useEffect(() => {
    if (shipEvents.length === 0) return;
    const current = new Set<string>();
    shipEvents.forEach((event) => {
      const mmsi = normalizeMmsi(event.mmsi);
      if (mmsi) current.add(mmsi);
    });
    if (knownMmsiRef.current.size === 0) {
      knownMmsiRef.current = current;
      void runBatchAnalysis(false);
      return;
    }
    const newMmsi = Array.from(current).filter((mmsi) => !knownMmsiRef.current.has(mmsi));
    if (newMmsi.length) {
      newMmsi.forEach((mmsi) => knownMmsiRef.current.add(mmsi));
      enqueueAutoAnalyze(newMmsi);
    }
  }, [enqueueAutoAnalyze, normalizeMmsi, runBatchAnalysis, shipEvents]);

  const filteredEvents = useMemo(() => {
    return shipEvents.filter((event) => {
      if (eventType !== 'ALL' && event.event_type !== eventType) return false;
      const key = typeof event.mmsi === 'string' ? event.mmsi : String(event.mmsi);
      const ship = shipLookup.get(key);
      const flag = (event.ship_flag || ship?.flag || '').trim();
      if (!flag) return true;
      return !isMainlandFlag(flag);
    });
  }, [shipEvents, shipLookup, eventType]);

  const outdatedThreshold = useMemo(
    () => Date.now() - sinceHours * 3600 * 1000,
    [sinceHours, lastRefreshAt]
  );

  const isEventOutdated = useCallback(
    (event: ShipEvent) =>
      typeof event.detected_at === 'number' && event.detected_at < outdatedThreshold,
    [outdatedThreshold]
  );

  const prioritizedEvents = useMemo(() => {
    return [...filteredEvents].sort((a, b) => {
      const aOutdated = isEventOutdated(a);
      const bOutdated = isEventOutdated(b);
      if (aOutdated !== bOutdated) return aOutdated ? 1 : -1;
      const sa = severityWeight[getSeverity(a.event_type)];
      const sb = severityWeight[getSeverity(b.event_type)];
      if (sa !== sb) return sb - sa;
      return (b.detected_at || 0) - (a.detected_at || 0);
    });
  }, [filteredEvents, isEventOutdated]);

  const totalPages = Math.max(1, Math.ceil(prioritizedEvents.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedEvents = prioritizedEvents.slice(
    (currentPage - 1) * PAGE_SIZE,
    (currentPage - 1) * PAGE_SIZE + PAGE_SIZE
  );

  const formatTimestamp = (ms: number) => new Date(ms).toLocaleString('zh-CN', { hour12: false });

  const handleShipClick = (event: ShipEvent) => {
    const key = typeof event.mmsi === 'string' ? event.mmsi : String(event.mmsi);
    const ship = shipLookup.get(key);
    if (ship) onSelectShip(ship);
  };

  const activeTab = tab ?? internalTab;
  const handleTabChange = (next: 'arrivals' | 'events') => {
    setInternalTab(next);
    onTabChange?.(next);
  };

  useEffect(() => {
    if (isShareModeArrivals) handleTabChange('arrivals');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShareModeArrivals]);

  const renderEventSummary = (
    event: ShipEvent,
    compact = false,
    outdated = false,
    keyPrefix = ''
  ) => {
    const meta = EVENT_ICON_META[event.event_type] || EVENT_ICON_META.DEFAULT;
    const ShipIconComp = meta.icon;
    const key = typeof event.mmsi === 'string' ? event.mmsi : String(event.mmsi);
    const ship = shipLookup.get(key);
    const shipName = ship?.name;
    let detailRemainder = event.detail;
    if (shipName && detailRemainder.startsWith(shipName)) {
      detailRemainder = detailRemainder.slice(shipName.length).trimStart();
    }

    return (
      <div
        key={`${keyPrefix}${event.mmsi}-${event.detected_at}`}
        className={`${compact ? 'px-4 py-4 flex items-start gap-3' : 'px-6 py-5 flex items-start gap-4'} ${
          outdated ? 'opacity-60 hover:opacity-100 transition-opacity' : ''
        }`}
      >
        <div
          className={`${compact ? 'w-10 h-10' : 'w-12 h-12'} rounded-full border flex items-center justify-center ${meta.className}`}
          title={meta.label}
        >
          <ShipIconComp className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
          <span className="sr-only">{meta.label}</span>
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-white flex items-center flex-wrap gap-2">
              {shipName && ship ? (
                <button
                  onClick={() => handleShipClick(event)}
                  className="text-emerald-300 hover:text-white font-semibold underline-offset-2 hover:underline transition-colors"
                >
                  {shipName}
                </button>
              ) : (
                <span className="text-slate-300">MMSI {key}</span>
              )}
              {ship?.cnName && <span className="text-xs text-slate-400">{ship.cnName}</span>}
              <span className="text-slate-200">{shipName ? detailRemainder || '动态更新' : event.detail}</span>
              {!compact && ship?.riskLevel && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${getRiskBadgeClass(ship.riskLevel)}`}
                >
                  船舶风险：{getRiskLabel(ship.riskLevel)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              {!compact && (
                <span className="px-2 py-0.5 rounded-full bg-slate-800/60 border border-slate-700 text-slate-300">
                  {meta.label}
                </span>
              )}
              <span className="font-mono">{formatTimestamp(event.detected_at)}</span>
            </div>
          </div>
          {ship && (
            <div className="text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
              <span>MMSI {ship.mmsi}</span>
              <span>船籍 {ship.flag || '-'}</span>
              {ship.cnName && <span>中文名 {ship.cnName}</span>}
              <span>ETA {ship.eta?.replace('T', ' ') || '-'}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const foreignSidebarEvents = useMemo(() => {
    return [...shipEvents]
      .filter((event) => {
        const key = typeof event.mmsi === 'string' ? event.mmsi : String(event.mmsi);
        const flag = (event.ship_flag || shipLookup.get(key)?.flag || '').trim();
        return flag && !isMainlandFlag(flag);
      })
      .sort((a, b) => {
        const aOutdated = isEventOutdated(a);
        const bOutdated = isEventOutdated(b);
        if (aOutdated !== bOutdated) return aOutdated ? 1 : -1;
        const sa = severityWeight[getSeverity(a.event_type)];
        const sb = severityWeight[getSeverity(b.event_type)];
        if (sa !== sb) return sb - sa;
        return (b.detected_at || 0) - (a.detected_at || 0);
      })
      .slice(0, 10);
  }, [shipEvents, shipLookup, isEventOutdated]);
  const sidebarTickerKey = useMemo(
    () => foreignSidebarEvents.map((event) => `${event.mmsi}-${event.detected_at}`).join('|'),
    [foreignSidebarEvents]
  );
  const sidebarScrollDuration = useMemo(
    () => Math.max(30, Math.max(foreignSidebarEvents.length, 1) * 5),
    [foreignSidebarEvents.length]
  );
  const shouldAutoScrollSidebar = foreignSidebarEvents.length > 1;

  const arrivalLayout = (
    <div className="flex flex-col md:flex-row gap-4 items-stretch flex-1">
      <div className="md:flex-[0_0_70%] flex flex-col space-y-3">
        <div className="flex-1">
          <ArrivalDetailsPage
            ships={ships}
            allShips={allShips}
            onSelectShip={onSelectShip}
            onFollowShip={onFollowShip}
            followedSet={followedSet}
            dataUpdatedAt={arrivalDataUpdatedAt}
            onShare={onShareArrivals}
            shareActive={shareArrivalsActive}
            isShareMode={isShareModeArrivals}
            dockdayTargetSet={dockdayTargetSet}
          />
        </div>
      </div>
      <div className="md:flex-[0_0_30%] flex flex-col space-y-3">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 shadow-lg flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-white font-semibold text-base">船舶信息动态</h3>
              {!isShareModeArrivals && (
                <p className="text-xs text-slate-400">仅显示外籍船舶最新 10 条动态</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isShareModeArrivals && (
                <span className="text-[11px] text-slate-500">共 {foreignSidebarEvents.length} 条</span>
              )}
              <button
                onClick={() => handleTabChange('events')}
                className="text-[11px] text-blue-300 hover:text-white inline-flex items-center gap-1"
              >
                更多
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
          <div
            className={`bg-slate-950/50 border border-slate-800 rounded-xl flex-1 relative overflow-hidden min-h-[660px] ${
              isShareModeArrivals ? 'max-h-[60vh] sm:max-h-[520px] md:max-h-none' : ''
            }`}
          >
            {loading && foreignSidebarEvents.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-blue-300" />
                正在加载动态...
              </div>
            ) : foreignSidebarEvents.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">
                {error || '当前时间范围内暂无外籍船动态'}
              </div>
            ) : shouldAutoScrollSidebar ? (
              <div className="absolute inset-0 overflow-hidden">
                <div
                  key={sidebarTickerKey}
                  className="flex flex-col"
                  style={{
                    animation: `dockdaySidebarScroll ${sidebarScrollDuration}s linear infinite`,
                    willChange: 'transform',
                  }}
                >
                  {[0, 1].map((copyIndex) => (
                    <div key={`ticker-copy-${copyIndex}`} className="divide-y divide-slate-800">
                      {foreignSidebarEvents.map((event) =>
                        renderEventSummary(event, true, isEventOutdated(event), `ticker-${copyIndex}-`)
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-800 overflow-auto h-full">
                {foreignSidebarEvents.map((event) =>
                  renderEventSummary(event, true, isEventOutdated(event))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const eventsLayout = (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-lg overflow-hidden flex-1 flex flex-col">
      {loading && prioritizedEvents.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-blue-300" />
          正在加载动态...
        </div>
      ) : prioritizedEvents.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">{error || '当前时间范围内暂无动态'}</div>
      ) : (
        <div className="divide-y divide-slate-800 flex-1 overflow-auto">
          {paginatedEvents.map((event) => renderEventSummary(event, false, isEventOutdated(event)))}
        </div>
      )}
      {error && prioritizedEvents.length > 0 && (
        <div className="px-6 py-3 border-t border-slate-800 text-amber-300 text-xs text-center">{error}</div>
      )}
      {prioritizedEvents.length > 0 && (
        <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>
            第 {currentPage} / {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={`px-3 py-1 rounded-full border text-sm ${
                currentPage === 1
                  ? 'border-slate-800 text-slate-600 cursor-not-allowed'
                  : 'border-slate-700 text-slate-200 hover:text-white hover:border-slate-500'
              }`}
            >
              上一页
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={`px-3 py-1 rounded-full border text-sm ${
                currentPage === totalPages
                  ? 'border-slate-800 text-slate-600 cursor-not-allowed'
                  : 'border-slate-700 text-slate-200 hover:text-white hover:border-slate-500'
              }`}
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="flex flex-col gap-4 pb-4 flex-1"
      style={{ minHeight: 'calc(100vh - 80px)' }}
    >
      <style>{SIDEBAR_SCROLL_ANIMATION}</style>
      {!isShareModeArrivals && (
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">实时动态</h1>
            <p className="text-sm text-slate-400 mt-1">进港动态与船舶信息动态统一入口</p>
            <div className="inline-flex items-center mt-3 rounded-full border border-slate-700 bg-slate-900/50 p-1 gap-1">
              <button
                onClick={() => handleTabChange('arrivals')}
                className={`px-3 py-1.5 text-xs font-medium rounded-full ${
                  activeTab === 'arrivals'
                    ? 'bg-blue-500/20 text-blue-100 border border-blue-400/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                进港动态
              </button>
              <button
                onClick={() => handleTabChange('events')}
                className={`px-3 py-1.5 text-xs font-medium rounded-full ${
                  activeTab === 'events'
                    ? 'bg-blue-500/20 text-blue-100 border border-blue-400/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                船舶信息动态
              </button>
            </div>
          </div>
          <div className="flex-1 flex justify-end">
            {activeTab === 'events' && (
              <div className="flex items-center gap-2">
                {[6, 12, 24].map((hours) => (
                  <button
                    key={hours}
                    onClick={() => setSinceHours(hours)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      sinceHours === hours
                        ? 'bg-blue-500/20 text-blue-100 border-blue-400/40'
                        : 'text-slate-400 border-slate-700 hover:text-white'
                    }`}
                  >
                    近 {hours} 小时
                  </button>
                ))}
                <button
                  onClick={loadEvents}
                  disabled={loading}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border ${
                    loading
                      ? 'bg-slate-800 border-slate-700 text-slate-400 cursor-not-allowed'
                      : 'border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {loading ? '刷新中' : '手动刷新'}
                </button>
                <button
                  onClick={() => runBatchAnalysis(true)}
                  disabled={batchLoading}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border ${
                    batchLoading
                      ? 'bg-slate-800 border-slate-700 text-slate-400 cursor-not-allowed'
                      : 'border-emerald-400/50 text-emerald-100 hover:border-emerald-300 hover:text-white'
                  }`}
                >
                  {batchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {batchLoading ? 'AI 批量中' : '存量 AI 分析'}
                </button>
                <button
                  onClick={runFilteredBatchAnalysis}
                  disabled={batchLoading || shipEvents.length === 0}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border ${
                    batchLoading || shipEvents.length === 0
                      ? 'bg-slate-800 border-slate-700 text-slate-400 cursor-not-allowed'
                      : 'border-blue-400/50 text-blue-100 hover:border-blue-300 hover:text-white'
                  }`}
                >
                  {batchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  当前动态 AI 分析
                </button>
                {lastRefreshAt && (
                  <span className="text-[11px] text-slate-500">
                    上次同步 {new Date(lastRefreshAt).toLocaleTimeString('zh-CN', { hour12: false })}
                  </span>
                )}
                {batchMessage && <span className="text-[11px] text-slate-500">{batchMessage}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'arrivals' ? arrivalLayout : eventsLayout}
    </div>
  );
};
