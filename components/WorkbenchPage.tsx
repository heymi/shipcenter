import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ship, ShipEvent } from '../types';
import { FollowedShipMeta } from '../api';
import { fetchShipEvents } from '../api';
import { getRiskBadgeClass, getRiskLabel } from '../utils/risk';
import { formatSmartWeekdayLabel } from '../utils/date';
import { formatPortWithCountry } from '../utils/port';
import { Loader2, Bell, AlertCircle, Share2 } from 'lucide-react';
import { SHIP_CN_NAME_OVERRIDES } from '../shipNameMap';

interface WorkbenchPageProps {
  followedShips: Ship[];
  onUnfollow: (mmsi: string) => void;
  activeShip: Ship | null;
  setActiveShip: (ship: Ship | null) => void;
  meta: Record<string, FollowedShipMeta>;
  onUpdateMeta: (mmsi: string, patch: Partial<FollowedShipMeta>) => void;
  lastUpdatedAt?: number | null;
  onShareFollow?: () => void;
  isSharing?: boolean;
  isShareMode?: boolean;
}

const formatTimestamp = (ms: number) =>
  new Date(ms).toLocaleString('zh-CN', { hour12: false });

const formatUpdateTime = (ts?: number | null) => {
  if (!ts) return '未同步';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
};

const BERTH_OPTIONS = [
  '新生圩港区',
  '明州码头',
  '龙翔化工码头',
  '清江码头（西坝港区）',
  '西坝港区',
  '华能金陵电厂码头',
];
const AGENT_OPTIONS = [
  '中国外运南京有限公司',
  '五矿国际货运江苏有限责任公司',
  '中远海运物流有限公司南京分公司',
  '中国外轮代理有限公司南京分公司',
  '南京思诺福船舶代理有限公司',
  '南京航姆船舶代理有限公司',
  '中钢国际货运有限公司华东分公司',
  '南京永隆船务代理有限公司',
  '江苏星致航船务代理有限公司',
];
const TARGET_FLAG = 'DOCKDAY 目标船';
const GEMINI_API_KEY = (import.meta as any)?.env?.VITE_GEMINI_API_KEY || '';
const TRANSLATION_CACHE_KEY = 'dockday_ship_translate_v1';
const DOCKDAY_VEHICLES_BY_SHIP: Record<
  string,
  {
    model: string;
    plate: string;
    driver: string;
    driverPhone: string;
    translator: string;
    translatorPhone: string;
    status: string;
    departTime: string;
    returnTime: string;
  }[]
> = {
  'GREAT KAPPA': [
    {
      model: '丰田考斯特',
      plate: '苏A·9F218',
      driver: '张师傅',
      driverPhone: '13814237568',
      translator: '陈敏',
      translatorPhone: '13241896325',
      status: '返程中',
      departTime: '09:45',
      returnTime: '15:20',
    },
  ],
  'COS LUCKY': [
    {
      model: '大众途安',
      plate: '苏A·6K732',
      driver: '王师傅',
      driverPhone: '13751469802',
      translator: '刘慧',
      translatorPhone: '13956728430',
      status: '游玩中',
      departTime: '10:30',
      returnTime: '17:00',
    },
  ],
  'RED SAKURA': [
    {
      model: '别克GL8',
      plate: '苏A·3L589',
      driver: '刘师傅',
      driverPhone: '13585421076',
      translator: '周婷',
      translatorPhone: '13678120493',
      status: '休息中',
      departTime: '14:10',
      returnTime: '21:30',
    },
  ],
};
const FLAG_EMOJI_MAP: Record<string, string> = {
  中国: '🇨🇳',
  香港: '🇭🇰',
  澳门: '🇲🇴',
  台湾: '🇹🇼',
  巴拿马: '🇵🇦',
  PANAMA: '🇵🇦',
  LIBERIA: '🇱🇷',
  利比里亚: '🇱🇷',
  SINGAPORE: '🇸🇬',
  新加坡: '🇸🇬',
  日本: '🇯🇵',
  JAPAN: '🇯🇵',
  UNITEDSTATES: '🇺🇸',
  US: '🇺🇸',
  美国: '🇺🇸',
  UNITEDKINGDOM: '🇬🇧',
  UK: '🇬🇧',
  英国: '🇬🇧',
  NORWAY: '🇳🇴',
  CYPRUS: '🇨🇾',
  BELGIUM: '🇧🇪',
  MARSHALLISLANDS: '🇲🇭',
  HONGKONG: '🇭🇰',
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

const getNormalizedShipKey = (name?: string) =>
  name ? name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() : '';

const getShipCnName = (ship: Ship, aiMap: Record<string, string>) => {
  if (ship.cnName) return ship.cnName;
  const normalized = getNormalizedShipKey(ship.name);
  if (normalized && aiMap[normalized]) return aiMap[normalized];
  return '';
};

export const WorkbenchPage: React.FC<WorkbenchPageProps> = ({
  followedShips,
  onUnfollow,
  activeShip,
  setActiveShip,
  meta,
  onUpdateMeta,
  lastUpdatedAt,
  onShareFollow,
  isSharing,
  isShareMode,
}) => {
  const [tab, setTab] = useState<'follow' | 'calendar'>('follow');
  const [formBerth, setFormBerth] = useState('');
  const [formAgent, setFormAgent] = useState('');
  const [formAgentContact, setFormAgentContact] = useState('');
  const [formAgentPhone, setFormAgentPhone] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [isTarget, setIsTarget] = useState(false);
  const [crewIncome, setCrewIncome] = useState('');
  const [disembarkIntent, setDisembarkIntent] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [crewCount, setCrewCount] = useState<string>('');
  const [expectedCount, setExpectedCount] = useState<string>('');
  const [actualCount, setActualCount] = useState<string>('');
  const [disembarkDate, setDisembarkDate] = useState<string>('');
  const [aiTranslations, setAiTranslations] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(TRANSLATION_CACHE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch (err) {
      console.warn('load translation cache failed', err);
      return {};
    }
  });
  const aiPending = useRef(new Set<string>());
  const [dirty, setDirty] = useState(false);
  const [events, setEvents] = useState<ShipEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const followedSet = useMemo(
    () => new Set(followedShips.map((ship) => ship.mmsi.toString())),
    [followedShips]
  );

  const filteredShips = useMemo(() => {
    // 日历视图展示全部关注船舶，列表视图也展示全部
    return followedShips;
  }, [followedShips]);

  const calendarSlotLabels = useMemo(
    () => Array.from({ length: 12 }, (_, idx) => `${String(idx * 2).padStart(2, '0')}-${String((idx + 1) * 2).padStart(2, '0')}`),
    []
  );

  const calendarData = useMemo(() => {
    if (tab !== 'calendar') return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today); // 第一列为当天
    const days = Array.from({ length: 7 }, (_, idx) => new Date(start.getTime() + idx * 24 * 3600 * 1000));
    const slots = days.map(() => Array.from({ length: calendarSlotLabels.length }, () => [] as Ship[]));
    filteredShips.forEach((ship) => {
      const etaTs = ship.eta ? Date.parse(ship.eta) : NaN;
      if (!Number.isFinite(etaTs)) return;
      const diffDays = Math.floor((etaTs - start.getTime()) / (24 * 3600 * 1000));
      if (diffDays < 0 || diffDays >= 7) return;
      const date = new Date(etaTs);
      const hour = date.getHours();
      const slotIdx = Math.min(calendarSlotLabels.length - 1, Math.max(0, Math.floor(hour / 2)));
      slots[diffDays][slotIdx].push(ship);
    });
    return { start, days, slots };
  }, [filteredShips, tab, calendarSlotLabels]);


  useEffect(() => {
    if (followedSet.size === 0) {
      setEvents([]);
      return;
    }
    let mounted = true;
    const loadEvents = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchShipEvents(Date.now() - 12 * 3600 * 1000);
        if (!mounted) return;
        const filtered = data.filter((event) =>
          followedSet.has(typeof event.mmsi === 'string' ? event.mmsi : String(event.mmsi))
        );
        setEvents(filtered);
      } catch (err) {
        console.warn(err);
        if (mounted) setError('动态加载失败');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadEvents();
    const timer = setInterval(loadEvents, 5 * 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [followedSet]);

  const normalizeDetail = (text: string) => text.replace(/\s+/g, ' ').trim();

  const eventsByShip = useMemo(() => {
    const sorted = [...events].sort((a, b) => (b.detected_at || 0) - (a.detected_at || 0));
    const map = new Map<string, ShipEvent[]>();
    const seen = new Map<string, Set<string>>();
    sorted.forEach((event) => {
      const key = typeof event.mmsi === 'string' ? event.mmsi : String(event.mmsi);
      if (!followedSet.has(key)) return;
      const sig = `${event.event_type}-${normalizeDetail(event.detail || '')}`; // 去掉时间戳，防止同文案重复显示
      if (!seen.has(key)) seen.set(key, new Set());
      if (seen.get(key)!.has(sig)) return;
      seen.get(key)!.add(sig);
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(event);
    });
    return map;
  }, [events, followedSet]);

  const sortedShips = useMemo(() => {
    const parseEta = (ship: Ship) => {
      if (!ship.eta) return Number.MAX_SAFE_INTEGER;
      const ts = Date.parse(ship.eta);
      return Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
    };
    return [...filteredShips].sort((a, b) => parseEta(a) - parseEta(b));
  }, [filteredShips]);
  const followDisplayShips = useMemo(() => {
    if (!isShareMode) return sortedShips;
    if (sortedShips.length === 0) return [];
    const [first, ...rest] = sortedShips;
    const targetShips = rest.filter((ship) => meta[ship.mmsi]?.is_target);
    const remaining = rest.filter((ship) => !meta[ship.mmsi]?.is_target);
    return [first, ...targetShips, ...remaining].slice(0, 10);
  }, [isShareMode, sortedShips, meta]);

  useEffect(() => {
    if (!activeShip) {
      setFormBerth('');
      setFormAgent('');
      setFormAgentContact('');
      setFormAgentPhone('');
      setFormRemark('');
      setDirty(false);
      return;
    }
    const current = meta[activeShip.mmsi] || {};
    setFormBerth(current.berth || '');
    setFormAgent(current.agent || '');
    setFormAgentContact(current.agent_contact_name || '');
    setFormAgentPhone(current.agent_contact_phone || '');
    setFormRemark(current.remark || '');
    setIsTarget(Boolean(current.is_target));
    setCrewIncome(current.crew_income_level || '');
    setDisembarkIntent(current.disembark_intent || '');
    setEmailStatus(current.email_status || '');
    setCrewCount(current.crew_count !== null && current.crew_count !== undefined ? String(current.crew_count) : '');
    setExpectedCount(
      current.expected_disembark_count !== null && current.expected_disembark_count !== undefined
        ? String(current.expected_disembark_count)
        : ''
    );
    setActualCount(
      current.actual_disembark_count !== null && current.actual_disembark_count !== undefined
        ? String(current.actual_disembark_count)
        : ''
    );
    setDisembarkDate(current.disembark_date || '');
    setDirty(false);
  }, [activeShip, meta]);

  useEffect(() => {
    if (!GEMINI_API_KEY) return;
    const targets = [activeShip, ...followDisplayShips].filter(Boolean) as Ship[];
    const uniqueNames = Array.from(
      new Set(
        targets
          .map((ship) => (ship.cnName ? '' : getNormalizedShipKey(ship.name)))
          .filter((key) => key)
      )
    );
    uniqueNames.forEach((key) => {
      if (aiTranslations[key] || SHIP_CN_NAME_OVERRIDES[key]) return;
      if (aiPending.current.has(key)) return;
      aiPending.current.add(key);
      const name = key.replace(/\s+/g, ' ');
      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `将船名翻译成简洁、可读的中文译名（不要解释），保留数字与缩写。只返回中文译名本身：${name}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 50,
        },
      };
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      )
        .then(async (res) => {
          if (!res.ok) throw new Error(`Gemini error ${res.status}`);
          const payload = await res.json();
          const text =
            payload?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text).join('') || '';
          const cleaned = String(text).replace(/[\r\n]+/g, ' ').replace(/^["'“”]+|["'“”]+$/g, '').trim();
          if (!cleaned) return;
          setAiTranslations((prev) => {
            if (prev[key] === cleaned) return prev;
            const next = { ...prev, [key]: cleaned };
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(next));
            }
            return next;
          });
        })
        .catch((err) => {
          console.warn('Gemini translate failed', err);
        })
        .finally(() => {
          aiPending.current.delete(key);
        });
    });
  }, [activeShip, followDisplayShips, aiTranslations]);

  const saveFollowMeta = () => {
    if (!activeShip || !dirty) return;
    onUpdateMeta(activeShip.mmsi, {
      berth: formBerth,
      agent: formAgent,
      agent_contact_name: formAgentContact || null,
      agent_contact_phone: formAgentPhone || null,
      remark: formRemark,
      is_target: isTarget,
      crew_income_level: crewIncome || null,
      disembark_intent: disembarkIntent || null,
      email_status: emailStatus || null,
      crew_count: crewCount ? Number(crewCount) : null,
      expected_disembark_count: expectedCount ? Number(expectedCount) : null,
      actual_disembark_count: actualCount ? Number(actualCount) : null,
      disembark_date: disembarkDate || null,
    });
    setDirty(false);
  };

  useEffect(() => {
    if (tab !== 'follow') return;
    if (activeShip && !filteredShips.find((s) => s.mmsi === activeShip.mmsi)) {
      setActiveShip(null);
    }
  }, [activeShip, filteredShips, tab, setActiveShip]);

  useEffect(() => {
    if (!isShareMode || tab !== 'follow') return;
    if (activeShip && !followDisplayShips.find((s) => s.mmsi === activeShip.mmsi)) {
      setActiveShip(null);
    }
  }, [isShareMode, tab, activeShip, followDisplayShips, setActiveShip]);

  useEffect(() => {
    if (tab === 'calendar') {
      setActiveShip(null);
    }
  }, [tab, setActiveShip]);

  if (filteredShips.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-sm space-y-3 text-slate-400">
          <Bell className="w-10 h-10 mx-auto text-slate-500" />
          <p className="text-lg text-white font-semibold">工作台为空</p>
          <p className="text-sm">
            {tab === 'dockday'
              ? '暂无 Dockday 目标船，请先在关注列表中勾选目标船只'
              : '在首页或预抵查询列表中点击「+关注」，即可将船舶加入工作台，集中跟踪其动态。'}
          </p>
        </div>
      </div>
    );
  }

  const renderDetailPanel = (
    <div className="space-y-4 text-slate-200">
      {activeShip ? (
        <>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">关注详情</p>
            <p className="text-2xl font-semibold text-white mt-1 flex flex-wrap items-baseline gap-2">
              {activeShip.name}
              {getShipCnName(activeShip, aiTranslations) && (
                <span className="text-sm text-slate-400">
                  ({getShipCnName(activeShip, aiTranslations)})
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500 mt-1 font-mono">
              MMSI {activeShip.mmsi} · 船籍 {activeShip.flag || '-'}
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${getRiskBadgeClass(
                  activeShip.riskLevel
                )}`}
              >
                {getRiskLabel(activeShip.riskLevel)}
              </span>
              {meta[activeShip.mmsi]?.is_target && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gradient-to-r from-amber-300 to-orange-400 text-slate-900 border border-amber-300/80 shadow-[0_10px_22px_-12px_rgba(251,191,36,0.9)]">
                  ⭐ {TARGET_FLAG}
                </span>
              )}
              <span className="text-xs text-slate-400">
                ETA {activeShip.eta?.replace('T', ' ') || '-'}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 p-3 text-sm text-slate-200 space-y-1">
            <p className="text-xs text-slate-400">目的地</p>
            <p className="font-semibold">{activeShip.dest || '南京港'}</p>
            <p className="text-xs text-slate-500">
              上一港 {formatPortWithCountry(activeShip.lastPort)}
            </p>
            {(formAgentContact || formAgentPhone) && (
              <p className="text-xs text-slate-500">
                代理人 {formAgentContact || '-'} {formAgentPhone || ''}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-slate-800 p-3 text-sm text-slate-200 space-y-3">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={isTarget}
                onChange={(e) => {
                  setIsTarget(e.target.checked);
                  setDirty(true);
                }}
                className="h-4 w-4 rounded border-slate-600 text-emerald-400 focus:ring-emerald-500 bg-slate-900"
              />
              添加为 Dockday 目标船只
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">船员平均收入水平</label>
                <select
                  value={crewIncome}
                  onChange={(e) => {
                    setCrewIncome(e.target.value);
                    setDirty(true);
                  }}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
                >
                  <option value="">请选择</option>
                  {['低', '中', '高', '不确定'].map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">下船意愿</label>
                <select
                  value={disembarkIntent}
                  onChange={(e) => {
                    setDisembarkIntent(e.target.value);
                    setDirty(true);
                  }}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
                >
                  <option value="">请选择</option>
                  {['不确定', '低', '中', '强烈'].map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">邮件沟通</label>
                <select
                  value={emailStatus}
                  onChange={(e) => {
                    setEmailStatus(e.target.value);
                    setDirty(true);
                  }}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
                >
                  <option value="">请选择</option>
                  {['未发送', '已发送'].map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">停靠码头</label>
              <select
                value={formBerth}
                onChange={(e) => {
                  setFormBerth(e.target.value);
                  setDirty(true);
                }}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
              >
                <option value="">请选择</option>
                {BERTH_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">船舶代理</label>
              <select
                value={formAgent}
                onChange={(e) => {
                  setFormAgent(e.target.value);
                  setDirty(true);
                }}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
              >
                <option value="">请选择</option>
                {AGENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">代理人姓名</label>
                <input
                  value={formAgentContact}
                  onChange={(e) => {
                    setFormAgentContact(e.target.value);
                    setDirty(true);
                  }}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
                  placeholder="联系人姓名"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">代理人电话</label>
                <input
                  value={formAgentPhone}
                  onChange={(e) => {
                    setFormAgentPhone(e.target.value);
                    setDirty(true);
                  }}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
                  placeholder="联系电话"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">备注</label>
              <textarea
                value={formRemark}
                onChange={(e) => {
                  setFormRemark(e.target.value);
                  setDirty(true);
                }}
                rows={3}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none resize-none"
                placeholder="可填写靠泊计划、查验要求、值班人等"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">下船日期</label>
                <input
                  type="date"
                  value={disembarkDate}
                  onChange={(e) => {
                    setDisembarkDate(e.target.value);
                    setDirty(true);
                  }}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">船员数量</label>
                <input
                  type="number"
                  min={0}
                  value={crewCount}
                  onChange={(e) => {
                    setCrewCount(e.target.value);
                    setDirty(true);
                  }}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
                  placeholder="人数"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">预计下船人数</label>
                <input
                  type="number"
                  min={0}
                  value={expectedCount}
                  onChange={(e) => {
                    setExpectedCount(e.target.value);
                    setDirty(true);
                  }}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
                  placeholder="预计下船"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">实际下船人数</label>
                <input
                  type="number"
                  min={0}
                  value={actualCount}
                  onChange={(e) => {
                    setActualCount(e.target.value);
                    setDirty(true);
                  }}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
                  placeholder="实际下船"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={saveFollowMeta}
                disabled={!dirty}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  dirty
                    ? 'border-emerald-400 text-white hover:bg-emerald-500/10'
                    : 'border-slate-700 text-slate-500 cursor-not-allowed'
                }`}
              >
                {dirty ? '保存' : '已保存'}
              </button>
            </div>
          </div>
          {meta[activeShip.mmsi]?.is_target && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-3 text-sm text-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-200">Dockday 目标船 · 下船联动</p>
                <span className="text-[11px] text-amber-100">生命周期跟踪中</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-amber-400/30 bg-slate-900/60 p-3">
                  <p className="text-xs text-amber-200">船员下船信息</p>
                  <p className="text-sm text-slate-200 mt-1">
                    总人数 {crewCount || '—'} · 预计 {expectedCount || '—'} · 实际 {actualCount || '—'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    收入 {crewIncome || '未填写'} · 意愿 {disembarkIntent || '未填写'}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-400/30 bg-slate-900/60 p-3">
                  <p className="text-xs text-amber-200">沟通进度</p>
                  <p className="text-sm text-slate-200 mt-1">
                    邮件 {emailStatus || '未填写'} · 码头 {formBerth || '未填写'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    代理 {formAgent || '未填写'} · {formAgentContact || '未填写'} {formAgentPhone || ''}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-400/30 bg-slate-900/60 p-3">
                  <p className="text-xs text-amber-200">车辆跟踪</p>
                  <p className="text-sm text-slate-200 mt-1">
                    {DOCKDAY_VEHICLES_BY_SHIP[activeShip.name]?.length || 0} 辆在途
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    下船日期 {disembarkDate || '未填写'}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {(DOCKDAY_VEHICLES_BY_SHIP[activeShip.name] || []).map((vehicle, idx) => (
                  <div
                    key={`${vehicle.plate}-${idx}`}
                    className="rounded-lg border border-amber-400/20 bg-slate-900/70 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-white font-semibold">
                        {vehicle.model} · {vehicle.plate}
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-400/50 text-amber-100">
                        {vehicle.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-2 space-y-1">
                      <p>司机 {vehicle.driver} · {vehicle.driverPhone}</p>
                      <p>翻译 {vehicle.translator} · {vehicle.translatorPhone}</p>
                      <p>出发 {vehicle.departTime} · 返回 {vehicle.returnTime}</p>
                    </div>
                  </div>
                ))}
                {(!DOCKDAY_VEHICLES_BY_SHIP[activeShip.name] ||
                  DOCKDAY_VEHICLES_BY_SHIP[activeShip.name].length === 0) && (
                  <p className="text-xs text-slate-500">暂无车辆调度信息</p>
                )}
              </div>
            </div>
          )}
          <div className="rounded-xl border border-slate-800 p-3 text-sm text-slate-200">
            <p className="text-xs text-slate-400 mb-2">最新动态</p>
            {(() => {
              const uniqEvents = (eventsByShip.get(activeShip.mmsi) ?? []).filter(
                (event, idx, arr) => {
                  const norm = normalizeDetail(event.detail || '');
                  return arr.findIndex((ev) => normalizeDetail(ev.detail || '') === norm && ev.event_type === event.event_type) === idx;
                }
              );
              return uniqEvents.length > 0 ? (
                uniqEvents.slice(0, 8).map((event) => (
                  <div key={`${event.mmsi}-${event.event_type}-${event.detail}`} className="mb-3">
                    <p>{event.detail}</p>
                    <p className="text-[11px] text-slate-500 mt-1">{formatTimestamp(event.detected_at)}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">暂无动态</p>
              );
            })()}
          </div>
        </>
      ) : (
        <div className="text-center text-slate-500 text-sm">请选择船舶查看详情</div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">工作台</h1>
          <p className="text-sm text-slate-400 mt-1">已关注 {followedShips.length} 艘船舶</p>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>数据更新至 {formatUpdateTime(lastUpdatedAt)}</span>
            {onShareFollow && tab === 'follow' && !isShareMode && (
              <button
                onClick={onShareFollow}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs transition ${
                  isSharing
                    ? 'border-rose-500/40 text-rose-200 hover:border-rose-400'
                    : 'border-slate-600 text-slate-200 hover:border-emerald-400 hover:text-white'
                }`}
              >
                <Share2 className="w-3.5 h-3.5" />
                {isSharing ? '停止分享' : '分享列表'}
              </button>
            )}
            {isShareMode && tab === 'follow' && (
              <span className="px-3 py-1 rounded-full border border-emerald-400/60 text-emerald-100 bg-emerald-500/10 text-[11px]">
                分享模式 · 仅展示前10条
              </span>
            )}
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              动态刷新中...
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        {[
          { id: 'follow', label: '关注列表' },
          { id: 'calendar', label: '日历视图' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as 'follow' | 'dockday')}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              tab === item.id
                ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/50'
                : 'border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
        {tab === 'calendar' && (
          <span className="text-xs text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-full px-2 py-1">
            日历视图
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-amber-300 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {tab === 'calendar' && calendarData ? (
        <>
          <div className="relative space-y-4 max-h-screen overflow-auto">
            <div className="flex items-center gap-3 text-xs text-slate-300">
              <span className="px-3 py-1 rounded-full bg-gradient-to-r from-sky-500/20 to-cyan-400/20 border border-cyan-400/40 text-cyan-100">
                单周 · 2 小时刻度
              </span>
              <span className="px-2 py-1 rounded-full bg-slate-800/60 border border-slate-700 text-slate-200">
                起始 {calendarData.start.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
              </span>
            </div>
            <div className="overflow-hidden border border-slate-800 bg-slate-950/80 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.7)]">
              <div className="grid grid-cols-[80px_repeat(7,1fr)] bg-slate-900/70 text-slate-200 text-xs divide-x divide-slate-800">
                <div className="px-3 py-2 text-slate-500">时间</div>
                {calendarData.days.map((day) => (
                  <div key={day.toISOString()} className="px-3 py-2">
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-semibold text-white leading-none">
                        {day.getDate().toString().padStart(2, '0')}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {day.toLocaleDateString('zh-CN', { month: 'short' })}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {day.toLocaleDateString('zh-CN', { weekday: 'short' })}
                    </div>
                  </div>
                ))}
              </div>
              {calendarSlotLabels.map((slotLabel, slotIdx) => (
                <div
                  key={slotLabel}
                  className="grid grid-cols-[80px_repeat(7,1fr)] divide-x divide-slate-800 border-t border-slate-800 bg-slate-950/40"
                >
                  <div className="px-2 py-3 text-[11px] text-slate-400 font-semibold flex items-start">
                    {slotLabel}
                  </div>
                  {calendarData.slots.map((daySlots, dayIdx) => {
                    const ships = daySlots[slotIdx];
                    const isToday = calendarData.days[dayIdx].toDateString() === new Date().toDateString();
                    return (
                      <div
                        key={calendarData.days[dayIdx].toISOString()}
                        className={`px-2 py-3 min-h-[52px] ${
                          isToday
                            ? `bg-cyan-500/5 border-cyan-300/70 ${
                                slotIdx === calendarSlotLabels.length - 1 ? 'border-b' : ''
                              } border-l border-r`
                            : ''
                        }`}
                      >
                        {ships.length > 0 && (
                          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                            <span className="text-slate-500">{ships.length} 艘</span>
                          </div>
                        )}
                        <div className="flex flex-col gap-1">
                          {ships.map((ship) => {
                            const isTarget = meta[ship.mmsi]?.is_target;
                            const baseClass =
                              activeShip?.mmsi === ship.mmsi
                                ? 'border-cyan-400/70 bg-cyan-500/10 text-cyan-50 shadow-[0_8px_24px_-12px_rgba(34,211,238,0.7)]'
                                : 'border-slate-800 bg-slate-900/80 text-slate-100 hover:border-cyan-400/50 hover:bg-slate-900';
                            const targetClass = isTarget ? 'border-amber-400/70 bg-amber-500/10 text-amber-50' : '';
                            return (
                              <button
                                key={ship.mmsi}
                                onClick={() => setActiveShip(ship)}
                                className={`w-full text-left text-[11px] px-2 py-1 rounded-md border transition ${targetClass} ${baseClass}`}
                              >
                                <div className="flex items-center gap-1">
                                  <span className="text-lg leading-none">
                                    {getFlagEmoji(ship.flag)}
                                  </span>
                                  <div className="truncate font-semibold">
                                    {ship.name}
                                    {isTarget && <span className="ml-1 text-[10px] text-amber-200">★</span>}
                                  </div>
                                </div>
                                {getShipCnName(ship, aiTranslations) && (
                                  <div className="text-[10px] text-slate-400 truncate">
                                    {getShipCnName(ship, aiTranslations)}
                                  </div>
                                )}
                                <div className="text-[10px] text-slate-400">
                                  {new Date(ship.eta).toLocaleTimeString('zh-CN', {
                                    hour12: false,
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs text-slate-500">点击日历中的船舶以查看详情和编辑信息</div>
        </>
      ) : (
        <div className="space-y-4">
          {followDisplayShips.map((ship, idx) => {
            const shipEvents = eventsByShip.get(ship.mmsi) ?? [];
            const etaLabel = formatSmartWeekdayLabel(ship.eta);
            const latestEvent = shipEvents[0];
            return (
              <div
                key={`${ship.mmsi}-${idx}`}
                onClick={() => setActiveShip(ship)}
                className={`rounded-3xl border border-white/5 bg-gradient-to-br from-slate-900/70 via-slate-900/40 to-slate-900/20 px-4 py-4 backdrop-blur flex flex-col gap-4 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.8)] transition ring-2 ${
                  activeShip?.mmsi === ship.mmsi ? 'ring-emerald-400/60' : 'ring-transparent hover:ring-emerald-300/40'
                } cursor-pointer`}
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="text-3xl leading-none drop-shadow" title={ship.flag || '未知船籍'}>
                    🚢
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <p className="text-base font-semibold text-white truncate">
                        {ship.name}
                        {getShipCnName(ship, aiTranslations) && (
                          <span className="text-xs text-slate-400 ml-2">
                            ({getShipCnName(ship, aiTranslations)})
                          </span>
                        )}
                      </p>
                      {meta[ship.mmsi]?.is_target && (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-gradient-to-r from-amber-300 to-orange-400 text-slate-900 border border-amber-300/80 shadow-[0_8px_20px_-10px_rgba(251,191,36,0.9)]">
                          ⭐ {TARGET_FLAG}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-white/10 text-slate-100 border border-white/10">
                        {ship.type || 'Unknown'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getRiskBadgeClass(
                          ship.riskLevel
                        )}`}
                      >
                        {getRiskLabel(ship.riskLevel)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono">
                      MMSI {ship.mmsi} · 船籍 {ship.flag || '-'} · ETA {ship.eta?.replace('T', ' ') || '-'}{' '}
                      {etaLabel && `(${etaLabel})`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm text-slate-300">
                  <p className="text-xs text-slate-400">
                    最新动态：{latestEvent ? latestEvent.detail : '暂无动态'}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onUnfollow(ship.mmsi);
                        if (activeShip?.mmsi === ship.mmsi) {
                          setActiveShip(null);
                        }
                      }}
                      className="px-3 py-1 rounded-full text-xs font-medium border border-slate-700 text-slate-400 hover:text-white hover:border-rose-400 transition-colors"
                    >
                      取消关注
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div
        className={`fixed inset-0 z-40 pointer-events-none transition-opacity duration-300 ${
          activeShip ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          onClick={() => activeShip && setActiveShip(null)}
          style={{ pointerEvents: activeShip ? 'auto' : 'none' }}
        />
        <div
          className={`absolute right-0 top-0 h-full w-[50vw] max-w-[900px] min-w-[480px] bg-slate-950 border-l border-slate-800 shadow-2xl overflow-auto p-5 transform transition-transform duration-300 ease-out ${
            activeShip ? 'translate-x-0' : 'translate-x-full'
          }`}
          onClick={(e) => e.stopPropagation()}
          style={{ pointerEvents: activeShip ? 'auto' : 'none' }}
        >
          {renderDetailPanel}
        </div>
      </div>
    </div>
  );
};
