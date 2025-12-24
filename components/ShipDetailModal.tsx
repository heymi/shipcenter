import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { FollowedShipMeta } from '../api';
import {
  autoAnalyzeShipWithAI,
  deleteShipConfirmedField,
  fetchSharedShipConfirmedFields,
  fetchSharedShipAiAnalysis,
  fetchShipParties,
  fetchShipAiAnalysis,
  fetchShipConfirmedFields,
  fetchShipEvents,
  saveShipConfirmedField,
  saveShipAiAnalysis,
  ShipPartiesV2Response,
  ShipAiInference,
} from '../api';
import { Ship, ShipEvent } from '../types';
import { getRiskBadgeClass, getRiskLabel } from '../utils/risk';
import { formatPortWithCountry } from '../utils/port';

interface ShipDetailModalProps {
  ship: Ship | null;
  onClose: () => void;
  onFollowShip?: (ship: Ship) => void;
  followedSet?: Set<string>;
  meta?: FollowedShipMeta | null;
  onUpdateMeta?: (mmsi: string, patch: Partial<FollowedShipMeta>) => Promise<void>;
  shareToken?: string | null;
  variant?: 'modal' | 'page';
  onBack?: () => void;
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
  return new Date(ms).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
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

const CONFIRMED_LABELS: Record<string, string> = {
  cargo_type: '货物类型',
  berth: '停靠码头',
  agent: '代理公司',
  crew_nationality: '船员国籍',
  crew_count: '船员人数',
};

export const ShipDetailModal: React.FC<ShipDetailModalProps> = ({
  ship,
  onClose,
  onFollowShip,
  followedSet,
  meta,
  onUpdateMeta,
  shareToken,
  variant = 'modal',
  onBack,
}) => {
  const editableMeta = useMemo(() => meta || {}, [meta]);
  const [aiResults, setAiResults] = useState<Record<string, ShipAiInference | null>>({});
  const [aiUpdatedAt, setAiUpdatedAt] = useState<Record<string, number | null>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'parties'>('overview');
  const [partiesLoading, setPartiesLoading] = useState(false);
  const [partiesError, setPartiesError] = useState<string | null>(null);
  const [partiesData, setPartiesData] = useState<Record<string, ShipPartiesV2Response | null>>({});
  const [confirmedFields, setConfirmedFields] = useState<Record<string, string>>({});
  const [confirmLoading, setConfirmLoading] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [agentEditing, setAgentEditing] = useState(false);
  const [agentDraft, setAgentDraft] = useState('');
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentSaveError, setAgentSaveError] = useState<string | null>(null);
  const [events, setEvents] = useState<ShipEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  useEffect(() => {
    if (!ship) return;
    let mounted = true;
    const fetcher = shareToken
      ? fetchSharedShipAiAnalysis(shareToken, String(ship.mmsi))
      : fetchShipAiAnalysis(String(ship.mmsi));
    fetcher
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
    setDetailTab('overview');
  }, [ship]);

  useEffect(() => {
    if (!ship) return;
    const currentAgent = String(meta?.agent ?? ship.agent ?? '');
    if (!agentEditing) {
      setAgentDraft(currentAgent);
    }
  }, [ship, meta?.agent, ship?.agent, agentEditing]);

  useEffect(() => {
    if (!ship) return;
    setAgentEditing(false);
    setAgentSaveError(null);
  }, [ship]);

  useEffect(() => {
    if (!agentEditing) {
      setAgentSaveError(null);
    }
  }, [agentEditing]);

  useEffect(() => {
    if (!ship) return;
    let active = true;
    const loader = shareToken
      ? fetchSharedShipConfirmedFields(shareToken, String(ship.mmsi))
      : fetchShipConfirmedFields(String(ship.mmsi));
    loader
      .then((rows) => {
        if (!active) return;
        const map = rows.reduce<Record<string, string>>((acc, item) => {
          if (item.field_key && item.field_value) {
            acc[item.field_key] = String(item.field_value);
          }
          return acc;
        }, {});
        setConfirmedFields(map);
      })
      .catch((err) => {
        console.warn('读取已确认字段失败', err);
      });
    return () => {
      active = false;
    };
  }, [ship, shareToken]);

  const loadParties = useCallback(
    (options?: { forceAi?: boolean; refresh?: boolean }) => {
      if (!ship) return;
      const key = String(ship.mmsi);
      if (!options?.refresh && partiesData[key]) return;
      let active = true;
      setPartiesLoading(true);
      setPartiesError(null);
      fetchShipParties({
        imo: ship.imo || null,
        mmsi: ship.mmsi,
        name: ship.name,
        version: '2',
        mode: 'aggressive',
        forceAi: options?.forceAi,
      })
        .then((payload) => {
          if (!active) return;
          setPartiesData((prev) => ({ ...prev, [key]: payload }));
        })
        .catch((err) => {
          console.warn('读取 ship parties 失败', err);
          if (!active) return;
          setPartiesError('读取 ship parties 失败');
        })
        .finally(() => {
          if (!active) return;
          setPartiesLoading(false);
        });
      return () => {
        active = false;
      };
    },
    [ship, partiesData]
  );

  useEffect(() => {
    if (!ship || detailTab !== 'parties') return;
    loadParties({ forceAi: true });
  }, [ship, detailTab, loadParties]);

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

  if (!ship) return null;

  const isPage = variant === 'page';
  const closeLabel = isPage ? '返回分享首页' : '关闭';
  const handleClose = isPage ? onBack ?? onClose : onClose;
  const canEdit = Boolean(onUpdateMeta);
  const canTriggerAi = !shareToken;
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
    ? lastUpdateDate.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
    : '-';
  const lastUpdateRelative = formatRelativeTime(lastUpdateDate);
  const signalStatus = getSignalStatus(lastUpdateDate);
  const etaLabel = ship.eta ? formatBeijingWithWeek(ship.eta.replace('T', ' ')) : '-';

  const agentDisplay = (meta?.agent ?? ship.agent ?? '').trim() || '-';
  const partiesPayload = partiesData[String(ship.mmsi)] || null;
  const partiesStatus = partiesPayload?.ai_status;
  const partiesEmpty =
    !partiesPayload?.parties?.registeredOwner &&
    !partiesPayload?.parties?.beneficialOwner &&
    !partiesPayload?.parties?.operator &&
    !partiesPayload?.parties?.manager &&
    !partiesPayload?.parties?.bareboatCharterer &&
    (!partiesPayload?.candidates || Object.keys(partiesPayload.candidates).length === 0);

  const renderPartyBlock = (
    label: string,
    field: 'registeredOwner' | 'beneficialOwner' | 'operator' | 'manager' | 'bareboatCharterer'
  ) => {
    const primary = partiesPayload?.parties?.[field] || null;
    const conflicts = partiesPayload?.candidates?.[field] || [];
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>{label}</span>
          <span>{primary ? primary.confidence || '-' : '-'}</span>
        </div>
        <p className="text-sm text-white mt-1">{primary?.name || '无法判断'}</p>
        {primary?.status && (
          <p className="text-[11px] text-slate-500 mt-1">状态：{primary.status}</p>
        )}
        {primary?.evidence?.length ? (
          <div className="mt-2 space-y-1 text-[11px] text-slate-500">
            {primary.evidence.map((item, idx) => (
              <p key={`${field}-evidence-${idx}`}>
                {item.source} · {item.path} · {item.strength}
                {item.note ? ` · ${item.note}` : ''}
              </p>
            ))}
          </div>
        ) : null}
        {conflicts.length > 0 && (
          <div className="mt-2 space-y-1 text-[11px] text-amber-300">
            <p>候选冲突：</p>
            {conflicts.map((candidate, idx) => (
              <p key={`${field}-conflict-${idx}`}>
                {candidate.name} · {candidate.confidence} · {candidate.score}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  const saveAgent = async () => {
    if (!ship || !onUpdateMeta) return;
    setAgentSaving(true);
    setAgentSaveError(null);
    try {
      const trimmed = agentDraft.trim();
      await onUpdateMeta(String(ship.mmsi), { agent: trimmed ? trimmed : null });
      setAgentEditing(false);
    } catch (err) {
      console.warn('保存代理公司失败', err);
      setAgentSaveError('保存失败，请稍后重试');
    } finally {
      setAgentSaving(false);
    }
  };

  const handleAutoAiInference = async () => {
    if (!ship) return;
    if (!canTriggerAi) {
      setAiError('分享页面不可更新 AI 分析');
      return;
    }
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

  const applyConfirmedField = async (
    fieldKey: string,
    value: string,
    aiValue?: string | null,
    confidencePct?: number | null,
    source = 'manual'
  ) => {
    if (!ship) return;
    setConfirmLoading(fieldKey);
    try {
      await saveShipConfirmedField(String(ship.mmsi), {
        field_key: fieldKey,
        field_value: value,
        source,
        ai_value: aiValue || null,
        confidence_pct: confidencePct ?? null,
      });
      setConfirmedFields((prev) => ({ ...prev, [fieldKey]: value }));
      setEditingField(null);
      setEditingValue('');
    } catch (err) {
      console.warn('保存已确认字段失败', err);
      setAiError('保存人工确认失败，请稍后重试');
    } finally {
      setConfirmLoading(null);
    }
  };

  const clearConfirmedField = async (fieldKey: string) => {
    if (!ship) return;
    setConfirmLoading(fieldKey);
    try {
      await deleteShipConfirmedField(String(ship.mmsi), fieldKey);
      setConfirmedFields((prev) => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
    } catch (err) {
      console.warn('删除已确认字段失败', err);
      setAiError('取消确认失败，请稍后重试');
    } finally {
      setConfirmLoading(null);
    }
  };

  const content = (
    <div className="px-4 sm:px-6 py-5 sm:py-6 space-y-6 text-slate-200 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500">DockDay</p>
              <h2 className="text-xl sm:text-3xl font-semibold text-white tracking-tight">
                {ship.name}
              </h2>
              {ship.cnName && <p className="text-sm text-slate-400">{ship.cnName}</p>}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="px-2.5 py-1 rounded-full bg-slate-900/60 border border-slate-700">
                  MMSI {ship.mmsi}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-slate-900/60 border border-slate-700">
                  IMO {ship.imo || '-'}
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
                  onClick={handleClose}
                  className="px-3.5 py-2 text-xs font-medium rounded-full border border-slate-700 text-slate-300 bg-slate-900/60 hover:text-white hover:border-slate-500 transition-colors"
                >
                  {closeLabel}
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
            <p className="text-xs text-slate-400">风险提示：{ship.riskReason}</p>
          )}
          <div className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 p-1">
            <button
              onClick={() => setDetailTab('overview')}
              className={`px-3 py-1.5 text-xs font-medium rounded-full ${
                detailTab === 'overview'
                  ? 'bg-blue-500/20 text-blue-100 border border-blue-400/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              详情概览
            </button>
            <button
              onClick={() => setDetailTab('parties')}
              className={`px-3 py-1.5 text-xs font-medium rounded-full ${
                detailTab === 'parties'
                  ? 'bg-blue-500/20 text-blue-100 border border-blue-400/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Ship Parties
            </button>
          </div>

          {detailTab === 'overview' ? (
            <>
              <section className="space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">目的地</p>
                  <p className="text-lg font-semibold text-white mt-2">{ship.dest || '南京港'}</p>
                  <p className="text-xs text-slate-500 mt-1">出发港 {formatPortWithCountry(ship.lastPort)}</p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">标准真实数据</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-slate-300 mt-3">
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
                      <p className="text-[10px] text-slate-500">ETA</p>
                      <p className="text-sm text-white">{etaLabel}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">AIS 更新时间</p>
                      <p className="text-sm text-white">{lastUpdateLabel}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">代理公司</p>
                      {!agentEditing && (
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-white">{agentDisplay}</p>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => setAgentEditing(true)}
                              className="text-[11px] px-2 py-0.5 rounded-full border border-blue-400/60 text-blue-200 hover:text-white"
                            >
                              编辑
                            </button>
                          )}
                        </div>
                      )}
                      {agentEditing && (
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            value={agentDraft}
                            onChange={(event) => setAgentDraft(event.target.value)}
                            className="flex-1 rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-xs text-slate-200 focus:border-blue-400 focus:outline-none"
                            placeholder="输入代理公司"
                          />
                          <button
                            type="button"
                            disabled={agentSaving}
                            onClick={saveAgent}
                            className={`text-[11px] px-2 py-1 rounded-md border ${
                              agentSaving
                                ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                                : 'border-emerald-400/60 text-emerald-200 hover:text-white'
                            }`}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            disabled={agentSaving}
                            onClick={() => {
                              setAgentEditing(false);
                              setAgentDraft(String(meta?.agent ?? ship.agent ?? ''));
                            }}
                            className="text-[11px] px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:text-white"
                          >
                            取消
                          </button>
                        </div>
                      )}
                      {agentSaveError && (
                        <p className="text-[11px] text-rose-300 mt-1">{agentSaveError}</p>
                      )}
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
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                    disabled={aiLoading || !canTriggerAi}
                    className={`px-3 py-2 rounded-full text-xs font-medium border transition ${
                      aiLoading || !canTriggerAi
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
                {Object.keys(confirmedFields).length > 0 && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-200">已确认</p>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-emerald-50">
                      {Object.entries(confirmedFields).map(([key, value]) => (
                        <span key={key}>
                          {CONFIRMED_LABELS[key] || key}：{value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
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
                    const renderBlock = (label: string, block?: any, fieldKey?: string) => {
                      const confirmedValue = fieldKey ? confirmedFields[fieldKey] : '';
                      const isEditing = editingField === fieldKey;
                      return (
                      <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>{label}</span>
                          <span>{renderConfidence(block)}</span>
                        </div>
                        <p className="text-sm text-white mt-1">
                          {confirmedValue || block?.value || '无法判断'}
                        </p>
                        {confirmedValue && (
                          <p className="text-[11px] text-emerald-300 mt-1">人工确认</p>
                        )}
                        {Array.isArray(block?.rationale) && block.rationale.length > 0 && (
                          <p className="text-[11px] text-slate-500 mt-1">{block.rationale.join('；')}</p>
                        )}
                        {!shareToken && fieldKey && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              type="button"
                              disabled={confirmLoading === fieldKey || !block?.value}
                              onClick={() =>
                                applyConfirmedField(
                                  fieldKey,
                                  String(block?.value ?? '').trim(),
                                  String(block?.value ?? ''),
                                  typeof block?.confidence_pct === 'number' ? block.confidence_pct : null,
                                  'ai_confirmed'
                                )
                              }
                              className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                confirmLoading === fieldKey || !block?.value
                                  ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                                  : 'border-emerald-400/60 text-emerald-200 hover:text-white'
                              }`}
                            >
                              确认
                            </button>
                            <button
                              type="button"
                              disabled={confirmLoading === fieldKey}
                              onClick={() => {
                                setEditingField(fieldKey);
                                setEditingValue(confirmedValue || String(block?.value ?? '').trim());
                              }}
                              className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                confirmLoading === fieldKey
                                  ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                                  : 'border-blue-400/60 text-blue-200 hover:text-white'
                              }`}
                            >
                              纠正
                            </button>
                            {confirmedValue && (
                              <button
                                type="button"
                                disabled={confirmLoading === fieldKey}
                                onClick={() => clearConfirmedField(fieldKey)}
                                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                  confirmLoading === fieldKey
                                    ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'border-slate-600 text-slate-300 hover:text-white'
                                }`}
                              >
                                取消确认
                              </button>
                            )}
                          </div>
                        )}
                        {!shareToken && fieldKey && isEditing && (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              value={editingValue}
                              onChange={(event) => setEditingValue(event.target.value)}
                              className="flex-1 rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-xs text-slate-200 focus:border-blue-400 focus:outline-none"
                              placeholder={`输入${label}`}
                            />
                            <button
                              type="button"
                              disabled={confirmLoading === fieldKey || !editingValue.trim()}
                              onClick={() =>
                                applyConfirmedField(
                                  fieldKey,
                                  editingValue.trim(),
                                  String(block?.value ?? ''),
                                  typeof block?.confidence_pct === 'number' ? block.confidence_pct : null,
                                  'manual'
                                )
                              }
                              className={`text-[11px] px-2 py-1 rounded-md border ${
                                confirmLoading === fieldKey || !editingValue.trim()
                                  ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                                  : 'border-blue-400/60 text-blue-200 hover:text-white'
                              }`}
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingField(null);
                                setEditingValue('');
                              }}
                              className="text-[11px] px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:text-white"
                            >
                              取消
                            </button>
                          </div>
                        )}
                      </div>
                      );
                    };
                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {renderBlock('货物类型', result.cargo_type_guess, 'cargo_type')}
                        {renderBlock('停靠码头', result.berth_guess, 'berth')}
                        {renderBlock('代理公司', result.agent_guess, 'agent')}
                        {renderBlock('船员国籍', result.crew_nationality_guess, 'crew_nationality')}
                        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span>船员人数</span>
                            <span>{renderConfidence(result.crew_count_guess)}</span>
                          </div>
                          <p className="text-sm text-white mt-1">
                            {confirmedFields.crew_count ?? result.crew_count_guess?.value ?? '无法判断'}
                          </p>
                          {confirmedFields.crew_count && (
                            <p className="text-[11px] text-emerald-300 mt-1">人工确认</p>
                          )}
                          {Array.isArray(result.crew_count_guess?.rationale) &&
                            result.crew_count_guess?.rationale?.length ? (
                            <p className="text-[11px] text-slate-500 mt-1">
                              {result.crew_count_guess?.rationale?.join('；')}
                            </p>
                          ) : null}
                          {!shareToken && (
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                type="button"
                                disabled={confirmLoading === 'crew_count' || result.crew_count_guess?.value === undefined}
                                onClick={() =>
                                  applyConfirmedField(
                                    'crew_count',
                                    String(result.crew_count_guess?.value ?? '').trim(),
                                    result.crew_count_guess?.value !== undefined
                                      ? String(result.crew_count_guess?.value)
                                      : null,
                                    typeof result.crew_count_guess?.confidence_pct === 'number'
                                      ? result.crew_count_guess.confidence_pct
                                      : null,
                                    'ai_confirmed'
                                  )
                                }
                                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                  confirmLoading === 'crew_count' || result.crew_count_guess?.value === undefined
                                    ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'border-emerald-400/60 text-emerald-200 hover:text-white'
                                }`}
                              >
                                确认
                              </button>
                              <button
                                type="button"
                                disabled={confirmLoading === 'crew_count'}
                                onClick={() => {
                                  setEditingField('crew_count');
                                  setEditingValue(
                                    confirmedFields.crew_count ??
                                      String(result.crew_count_guess?.value ?? '').trim()
                                  );
                                }}
                                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                  confirmLoading === 'crew_count'
                                    ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'border-blue-400/60 text-blue-200 hover:text-white'
                                }`}
                              >
                                纠正
                              </button>
                              {confirmedFields.crew_count && (
                                <button
                                  type="button"
                                  disabled={confirmLoading === 'crew_count'}
                                  onClick={() => clearConfirmedField('crew_count')}
                                  className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                    confirmLoading === 'crew_count'
                                      ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                                      : 'border-slate-600 text-slate-300 hover:text-white'
                                  }`}
                                >
                                  取消确认
                                </button>
                              )}
                            </div>
                          )}
                          {!shareToken && editingField === 'crew_count' && (
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                value={editingValue}
                                onChange={(event) => setEditingValue(event.target.value)}
                                className="flex-1 rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-xs text-slate-200 focus:border-blue-400 focus:outline-none"
                                placeholder="输入船员人数"
                              />
                              <button
                                type="button"
                                disabled={confirmLoading === 'crew_count' || !editingValue.trim()}
                                onClick={() =>
                                  applyConfirmedField(
                                    'crew_count',
                                    editingValue.trim(),
                                    result.crew_count_guess?.value !== undefined
                                      ? String(result.crew_count_guess?.value)
                                      : null,
                                    typeof result.crew_count_guess?.confidence_pct === 'number'
                                      ? result.crew_count_guess.confidence_pct
                                      : null,
                                    'manual'
                                  )
                                }
                                className={`text-[11px] px-2 py-1 rounded-md border ${
                                  confirmLoading === 'crew_count' || !editingValue.trim()
                                    ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'border-blue-400/60 text-blue-200 hover:text-white'
                                }`}
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingField(null);
                                  setEditingValue('');
                                }}
                                className="text-[11px] px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:text-white"
                              >
                                取消
                              </button>
                            </div>
                          )}
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
                    <div
                      key={`${event.mmsi}-${event.event_type}-${event.detail}`}
                      className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
                    >
                      <p className="text-sm text-slate-200">{event.detail}</p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {formatTimestamp(event.detected_at)}
                      </p>
                    </div>
                  ));
                })()}
              </section>
            </>
          ) : (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Ship Parties</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    仅展示有证据支持的结果；冲突会列出候选项与证据路径。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {partiesStatus && (
                    <span className="text-[11px] text-slate-500">AI 状态：{partiesStatus}</span>
                  )}
                  {partiesPayload?.retrieval_status && (
                    <span className="text-[11px] text-slate-500">检索：{partiesPayload.retrieval_status}</span>
                  )}
                  <button
                    onClick={() => loadParties({ forceAi: true, refresh: true })}
                    disabled={partiesLoading}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                      partiesLoading
                        ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                        : 'border-emerald-400/50 text-emerald-100 hover:text-white hover:border-emerald-300'
                    }`}
                  >
                    {partiesLoading ? '分析中...' : 'AI 再分析'}
                  </button>
                </div>
              </div>
              {partiesLoading && <p className="text-xs text-slate-500">加载中...</p>}
              {partiesError && <p className="text-xs text-amber-300">{partiesError}</p>}
              {!partiesLoading && !partiesError && !partiesPayload && (
                <p className="text-xs text-slate-500">暂无可用数据</p>
              )}
              {!partiesLoading && !partiesError && partiesPayload && partiesEmpty && (
                <p className="text-xs text-amber-300">
                  {partiesStatus === 'failed'
                    ? 'AI 分析失败，请稍后重试'
                    : partiesStatus === 'not_requested'
                      ? '暂无证据，无法判断'
                      : '无法判断'}
                </p>
              )}
              {partiesPayload && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {renderPartyBlock('Registered Owner', 'registeredOwner')}
                  {renderPartyBlock('Beneficial Owner', 'beneficialOwner')}
                  {renderPartyBlock('Operator', 'operator')}
                  {renderPartyBlock('Manager', 'manager')}
                  {renderPartyBlock('Bareboat Charterer', 'bareboatCharterer')}
                </div>
              )}
              {partiesPayload?.contacts?.length ? (
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-[11px] text-slate-400">联系方式（仅官方来源）</p>
                  <div className="mt-2 space-y-1 text-xs text-slate-200">
                    {partiesPayload.contacts.map((contact, idx) => (
                      <p key={`contact-${idx}`}>
                        {contact.company} · {contact.type} · {contact.value}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          )}
    </div>
  );

  if (isPage) {
    return (
      <div className="w-full max-w-6xl mx-auto">
        <div className="bg-slate-950 border border-slate-800 rounded-3xl shadow-[0_30px_80px_-35px_rgba(0,0,0,0.8)] overflow-y-auto overscroll-contain">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center px-4 py-6 md:py-8 bg-slate-900/70 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl max-h-[92vh] bg-slate-950 border border-slate-800 rounded-t-3xl md:rounded-3xl shadow-[0_30px_80px_-35px_rgba(0,0,0,0.8)] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
};
