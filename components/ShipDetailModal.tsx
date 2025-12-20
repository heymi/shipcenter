import React, { useEffect, useMemo, useState } from 'react';
import type { FollowedShipMeta } from '../api';
import {
  autoAnalyzeShipWithAI,
  fetchShipAiAnalysis,
  fetchShipEvents,
  saveShipAiAnalysis,
  ShipAiInference,
} from '../api';
import { Ship, ShipEvent } from '../types';
import { getRiskBadgeClass, getRiskLabel } from '../utils/risk';

interface ShipDetailModalProps {
  ship: Ship | null;
  onClose: () => void;
  onFollowShip?: (ship: Ship) => void;
  followedSet?: Set<string>;
  meta?: FollowedShipMeta | null;
  onUpdateMeta?: (mmsi: string, patch: Partial<FollowedShipMeta>) => Promise<void>;
}

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

const formatRelativeTime = (date?: Date | null) => {
  if (!date) return null;
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 1000) return '刚刚';
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
};

const formatTimestamp = (ms?: number | null) => {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
};

const normalizeDetail = (text: string) => text.replace(/\s+/g, ' ').trim();

const getDocStatusLabel = (status?: Ship['docStatus']) => {
  if (!status) return '-';
  switch (status) {
    case 'PENDING':
      return '待补充';
    case 'REVIEWING':
      return '审核中';
    case 'MISSING_INFO':
      return '缺失材料';
    case 'APPROVED':
      return '已完备';
    default:
      return '未知';
  }
};

const getEtaStatus = (eta?: string) => {
  if (!eta) {
    return { label: 'ETA 未知', className: 'bg-slate-800/80 text-slate-300 border-slate-700' };
  }
  const normalized = eta.replace('T', ' ');
  const date = parseBeijingDate(normalized) || new Date(eta);
  if (Number.isNaN(date.getTime())) {
    return { label: 'ETA 未知', className: 'bg-slate-800/80 text-slate-300 border-slate-700' };
  }
  const diffMinutes = Math.floor((date.getTime() - Date.now()) / (60 * 1000));
  if (diffMinutes <= 0) {
    return { label: '已到港', className: 'bg-slate-800/80 text-slate-300 border-slate-700' };
  }
  if (diffMinutes <= 30) {
    return { label: '30 分钟内到港', className: 'bg-rose-500/20 text-rose-200 border-rose-400/40' };
  }
  if (diffMinutes <= 120) {
    return { label: '2 小时内到港', className: 'bg-amber-500/20 text-amber-200 border-amber-400/40' };
  }
  const isToday = date.toDateString() === new Date().toDateString();
  if (isToday) {
    return { label: '今日到港', className: 'bg-blue-500/20 text-blue-200 border-blue-400/40' };
  }
  return { label: '预计到港', className: 'bg-slate-800/80 text-slate-300 border-slate-700' };
};

const getSignalStatus = (date?: Date | null) => {
  if (!date) return { label: 'AIS 未同步', className: 'text-slate-500' };
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / (60 * 1000));
  if (diffMinutes <= 30) return { label: 'AIS 正常', className: 'text-emerald-300' };
  if (diffMinutes <= 120) return { label: '信号延迟', className: 'text-amber-300' };
  return { label: '信号失联', className: 'text-rose-300' };
};

export const ShipDetailModal: React.FC<ShipDetailModalProps> = ({
  ship,
  onClose,
  onFollowShip,
  followedSet,
  meta,
  onUpdateMeta,
}) => {
  if (!ship) return null;
  const canEdit = Boolean(onUpdateMeta);
  const rawDraught =
    typeof ship.draught === 'number'
      ? ship.draught
      : typeof ship.draught === 'string'
        ? Number(ship.draught)
        : undefined;
  const hasDraught = typeof rawDraught === 'number' && Number.isFinite(rawDraught);

  const etaStatus = getEtaStatus(ship.eta);
  const isFollowed = followedSet?.has(ship.mmsi) ?? false;
  const followDisabled = !onFollowShip || isFollowed;
  const lastUpdateDate =
    (ship.lastTime && parseBeijingDate(ship.lastTime)) ||
    (ship.lastTimeUtc ? new Date(ship.lastTimeUtc * 1000) : null);
  const lastUpdateLabel = lastUpdateDate
    ? lastUpdateDate.toLocaleString('zh-CN', { hour12: false })
    : '-';
  const lastUpdateRelative = formatRelativeTime(lastUpdateDate);
  const signalStatus = getSignalStatus(lastUpdateDate);
  const etdLabel = ship.etd ? formatBeijingWithWeek(ship.etd.replace('T', ' ')) : '-';
  const editableMeta = useMemo(() => meta || {}, [meta]);
  const [aiResults, setAiResults] = useState<Record<string, ShipAiInference | null>>({});
  const [aiUpdatedAt, setAiUpdatedAt] = useState<Record<string, number | null>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [events, setEvents] = useState<ShipEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  useEffect(() => {
    if (!ship) return;
    let mounted = true;
    fetchShipAiAnalysis(String(ship.mmsi))
      .then((payload) => {
        if (!mounted) return;
        if (payload.data) {
          setAiResults((prev) => ({ ...prev, [String(ship.mmsi)]: payload.data }));
        }
        setAiUpdatedAt((prev) => ({ ...prev, [String(ship.mmsi)]: payload.updated_at ?? null }));
      })
      .catch((err) => {
        console.warn('读取AI分析失败', err);
      });
    return () => {
      mounted = false;
    };
  }, [ship]);

  useEffect(() => {
    if (!ship) return;
    let active = true;
    const loadEvents = async () => {
      setEventsLoading(true);
      setEventsError(null);
      try {
        const data = await fetchShipEvents(Date.now() - 12 * 3600 * 1000);
        if (!active) return;
        const filtered = data.filter((event) => String(event.mmsi) === String(ship.mmsi));
        setEvents(filtered);
      } catch (err) {
        console.warn(err);
        if (active) setEventsError('动态加载失败');
      } finally {
        if (active) setEventsLoading(false);
      }
    };
    loadEvents();
    return () => {
      active = false;
    };
  }, [ship]);

  const handleAutoAiInference = async () => {
    if (!ship) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await autoAnalyzeShipWithAI({
        ship: {
          name: ship.name,
          mmsi: ship.mmsi,
          imo: ship.imo,
          flag: ship.flag,
          type: ship.type,
          eta: ship.eta,
          etd: ship.etd,
          etaUtc: ship.etaUtc,
          lastTime: ship.lastTime,
          lastTimeUtc: ship.lastTimeUtc,
          dest: ship.dest,
          last_port: ship.lastPort,
          lastPort: ship.lastPort,
          dwt: ship.dwt,
          length: ship.length,
          width: ship.width,
          draught: ship.draught,
          agent: ship.agent,
          docStatus: ship.docStatus,
          riskReason: ship.riskReason,
        },
        events: (events || []).slice(0, 6).map((event: any) => ({
          event_type: event.event_type,
          detail: event.detail,
          detected_at: event.detected_at,
        })),
        max_sources: 6,
        max_per_source: 1,
      });
      setAiResults((prev) => ({ ...prev, [String(ship.mmsi)]: result }));
      setAiUpdatedAt((prev) => ({ ...prev, [String(ship.mmsi)]: Date.now() }));
      await saveShipAiAnalysis(String(ship.mmsi), result);
    } catch (err) {
      console.warn('AI auto inference failed', err);
      setAiError('自动检索失败，请检查网络或稍后重试');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center px-4 py-6 md:py-8 bg-slate-900/70 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl h-[92vh] bg-slate-950 border border-slate-800 rounded-t-3xl md:rounded-3xl shadow-[0_30px_80px_-35px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500">DockDay</p>
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                {ship.name}
              </h2>
              {ship.cnName && <p className="text-sm text-slate-400">{ship.cnName}</p>}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="px-2.5 py-1 rounded-full bg-slate-900/60 border border-slate-700">
                  MMSI {ship.mmsi}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-slate-900/60 border border-slate-700">
                  船籍 {ship.flag || '-'}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-slate-900/60 border border-slate-700">
                  {ship.type || '未知类型'}
                </span>
                <span className={`px-2.5 py-1 rounded-full border ${etaStatus.className}`}>{etaStatus.label}</span>
              </div>
            </div>

            <div className="flex flex-col items-start lg:items-end gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => !followDisabled && onFollowShip?.(ship)}
                  disabled={followDisabled}
                  className={`px-3.5 py-2 text-xs font-medium rounded-full border transition-colors ${
                    isFollowed
                      ? 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10 cursor-not-allowed'
                      : followDisabled
                        ? 'border-slate-800 text-slate-500 bg-slate-900/40 cursor-not-allowed'
                        : 'border-slate-700 text-slate-200 bg-slate-900/60 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  {isFollowed ? '已关注' : '+关注'}
                </button>
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs font-medium rounded-full border border-slate-700 text-slate-300 bg-slate-900/60 hover:text-white hover:border-slate-500 transition-colors"
                >
                  关闭
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className={`px-2.5 py-1 rounded-full border ${getRiskBadgeClass(ship.riskLevel)}`}>
                  风险 {getRiskLabel(ship.riskLevel)}
                </span>
                <span className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60">
                  AIS {signalStatus.label}
                </span>
                {lastUpdateRelative && <span>更新于 {lastUpdateRelative}</span>}
              </div>
            </div>
          </div>
          {ship.riskReason && (
            <p className="mt-4 text-xs text-slate-400">风险提示：{ship.riskReason}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-slate-200">
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">目的地</p>
              <p className="text-lg font-semibold text-white mt-2">{ship.dest || '南京港'}</p>
              <p className="text-xs text-slate-500 mt-1">上一港 {ship.lastPort || '-'}</p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">标准真实数据</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-300 mt-3">
                <div>
                  <p className="text-[10px] text-slate-500">船型</p>
                  <p className="text-sm text-white">{ship.type || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">DWT</p>
                  <p className="text-sm text-white">
                    {ship.dwt ? `${Number(ship.dwt).toLocaleString()} t` : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">吃水</p>
                  <p className="text-sm text-white">{hasDraught ? `${rawDraught!.toFixed(1)} m` : '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">船长/船宽</p>
                  <p className="text-sm text-white">
                    {ship.length ? `${ship.length} m` : '-'} / {ship.width ? `${ship.width} m` : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">ETD</p>
                  <p className="text-sm text-white">{etdLabel}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">AIS 更新时间</p>
                  <p className="text-sm text-white">{lastUpdateLabel}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">代理公司</p>
                  <p className="text-sm text-white">{ship.agent || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">材料状态</p>
                  <p className="text-sm text-white">{getDocStatusLabel(ship.docStatus)}</p>
                </div>
              </div>
              {ship.riskReason && (
                <p className="text-xs text-slate-500 mt-3">风险原因：{ship.riskReason}</p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Dockday 目标船只</p>
              <label className="flex items-center gap-2 text-sm text-slate-200 mt-2">
                <input
                  type="checkbox"
                  checked={Boolean(editableMeta.is_target)}
                  disabled={!canEdit}
                  onChange={(event) => {
                    if (!onUpdateMeta) return;
                    void onUpdateMeta(String(ship.mmsi), { is_target: event.target.checked });
                  }}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950/70 text-emerald-300"
                />
                添加为 Dockday 目标船只
              </label>
              {!canEdit && <p className="text-xs text-slate-500 mt-2">请登录后设置目标船只。</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">AI 推测</p>
                {aiUpdatedAt[String(ship.mmsi)] && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    上次分析 {formatTimestamp(aiUpdatedAt[String(ship.mmsi)] || 0)}
                  </p>
                )}
              </div>
              <button
                onClick={handleAutoAiInference}
                disabled={aiLoading}
                className={`px-3 py-2 rounded-full text-xs font-medium border transition ${
                  aiLoading
                    ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                    : 'border-emerald-400 text-white hover:bg-emerald-500/10'
                }`}
              >
                {aiLoading
                  ? 'AI 分析中...'
                  : aiResults[String(ship.mmsi)]
                    ? '更新分析'
                    : 'AI 分析'}
              </button>
            </div>
            {aiError && <p className="text-xs text-amber-300">{aiError}</p>}
            {aiResults[String(ship.mmsi)] ? (
              (() => {
                const result = aiResults[String(ship.mmsi)];
                if (!result) return null;
                if (result.parse_error) {
                  return (
                    <div className="text-xs text-slate-400">
                      分析结果解析失败，请点击“更新分析”重新获取。
                    </div>
                  );
                }
                const renderConfidence = (block?: any) => {
                  const level = block?.confidence || 'low';
                  const pct =
                    typeof block?.confidence_pct === 'number' && Number.isFinite(block?.confidence_pct)
                      ? `${Math.round(block.confidence_pct)}%`
                      : null;
                  return pct ? `${level} · ${pct}` : level;
                };
                const renderBlock = (label: string, block?: any) => (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{label}</span>
                      <span>{renderConfidence(block)}</span>
                    </div>
                    <p className="text-sm text-white mt-1">{block?.value || '无法判断'}</p>
                    {Array.isArray(block?.rationale) && block.rationale.length > 0 && (
                      <p className="text-[11px] text-slate-500 mt-1">{block.rationale.join('；')}</p>
                    )}
                  </div>
                );
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {renderBlock('货物类型', result.cargo_type_guess)}
                    {renderBlock('停靠码头', result.berth_guess)}
                    {renderBlock('代理公司', result.agent_guess)}
                    {renderBlock('船员国籍', result.crew_nationality_guess)}
                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>船员人数</span>
                        <span>{renderConfidence(result.crew_count_guess)}</span>
                      </div>
                      <p className="text-sm text-white mt-1">
                        {result.crew_count_guess?.value ?? '无法判断'}
                      </p>
                      {Array.isArray(result.crew_count_guess?.rationale) &&
                        result.crew_count_guess?.rationale?.length ? (
                        <p className="text-[11px] text-slate-500 mt-1">
                          {result.crew_count_guess?.rationale?.join('；')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })()
            ) : (
              <p className="text-xs text-slate-500">暂无 AI 推测结果</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">最新动态</p>
            {eventsLoading && <p className="text-xs text-slate-500 mt-2">动态加载中...</p>}
            {eventsError && <p className="text-xs text-amber-300 mt-2">{eventsError}</p>}
            {(() => {
              const sorted = [...events].sort((a, b) => (b.detected_at || 0) - (a.detected_at || 0));
              const uniqEvents = sorted.filter((event, idx, arr) => {
                const norm = normalizeDetail(event.detail || '');
                return (
                  arr.findIndex(
                    (ev) =>
                      normalizeDetail(ev.detail || '') === norm && ev.event_type === event.event_type
                  ) === idx
                );
              });
              if (!eventsLoading && uniqEvents.length === 0) {
                return <p className="text-xs text-slate-500 mt-2">暂无动态</p>;
              }
              return uniqEvents.slice(0, 8).map((event) => (
                <div key={`${event.mmsi}-${event.event_type}-${event.detail}`} className="mt-3">
                  <p className="text-sm text-slate-200">{event.detail}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {formatTimestamp(event.detected_at)}
                  </p>
                </div>
              ));
            })()}
          </section>
        </div>
      </div>
    </div>
  );
};
