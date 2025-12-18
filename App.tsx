import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { DashboardRadar } from './components/DashboardRadar';
import { DataQueryCenter } from './components/DataQueryCenter';
import { RealtimeEventsPage } from './components/RealtimeEventsPage';
import { ShipDetailModal } from './components/ShipDetailModal';
import { WorkbenchPage } from './components/WorkbenchPage';
import { CrewDisembarkPage } from './components/CrewDisembarkPage';
import { CrewLifecyclePage } from './components/CrewLifecyclePage';
import { fetchETAShips, fetchFollowedShips, upsertFollowedShip, deleteFollowedShip, FollowedShipMeta } from './api';
import { MOCK_SHIPS } from './constants';
import { SHIP_CN_NAME_OVERRIDES } from './shipNameMap';
import { Ship, RiskLevel, DocStatus, ShipxyShip } from './types';
import { Loader2, AlertCircle, Copy, X } from 'lucide-react';
import { getShipTypeName, isMainlandFlag } from './utils/ship';
import { evaluateRiskRules } from './utils/risk';
import { API_CONFIG } from './config';

const SHIP_CN_NAME_MAP = MOCK_SHIPS.reduce<Record<string, string>>((acc, ship) => {
  if (ship.name && ship.cnName) {
    acc[ship.name.toUpperCase()] = ship.cnName;
  }
  return acc;
}, {});

// Helper to transform API data to App's internal Ship type
const transformApiData = (apiShips: ShipxyShip[]): Ship[] => {
  return apiShips.map((s) => {
    const riskEvaluation = evaluateRiskRules(s);

    // Doc status placeholder based on rule level
    let docStatus = DocStatus.APPROVED;
    if (riskEvaluation.level === RiskLevel.HIGH) docStatus = DocStatus.MISSING_INFO;
    else if (riskEvaluation.level === RiskLevel.ATTENTION) docStatus = DocStatus.REVIEWING;

    // Format ETA (API returns "YYYY-MM-DD HH:mm:ss", needs to be ISO-ish for Date parsing)
    // Replace space with T for better compatibility
    const etaString = s.eta ? s.eta.replace(' ', 'T') : new Date().toISOString();
    
    // Mock ETD as ETA + 24h roughly
    const etaDate = new Date(etaString);
    const etdDate = new Date(etaDate.getTime() + 24 * 60 * 60 * 1000);

    return {
      id: s.mmsi.toString(),
      name: s.ship_name || `Unknown Ship (${s.mmsi})`,
      cnName:
        s.ship_cnname ||
        SHIP_CN_NAME_OVERRIDES[(s.ship_name || '').toUpperCase()] ||
        SHIP_CN_NAME_MAP[(s.ship_name || '').toUpperCase()],
      mmsi: s.mmsi.toString(),
      flag: String(s.ship_flag || 'Unknown'),
      type: getShipTypeName(s.ship_type), // Use helper to get readable name
      eta: etaString,
      etd: etdDate.toISOString(),
      draught: typeof s.draught === 'number' ? s.draught : Number(s.draught) || undefined,
      length: typeof s.length === 'number' ? s.length : Number(s.length) || undefined,
      width: typeof s.width === 'number' ? s.width : Number(s.width) || undefined,
      dwt: typeof s.dwt === 'number' ? s.dwt : Number(s.dwt) || undefined,
      dest: s.dest,
      etaUtc: s.eta_utc,
      lastTime: s.last_time,
      lastTimeUtc: s.last_time_utc,
      riskLevel: riskEvaluation.level,
      riskReason: riskEvaluation.reason,
      docStatus,
      lastPort: s.preport_cnname || 'Unknown',
      agent: 'Dockday Shipping Agency', // Mock Agent
    };
  });
};

// Regenerate mock data with fresh时间，避免固定时间被过滤掉
const getFreshMockShips = (): Ship[] => {
  const now = Date.now();
  return MOCK_SHIPS.map((ship, idx) => {
    const etaDate = new Date(now + (idx + 1) * 3 * 60 * 60 * 1000); // 每艘间隔3小时
    const etdDate = new Date(etaDate.getTime() + 24 * 60 * 60 * 1000);
    return {
      ...ship,
      eta: etaDate.toISOString(),
      etd: etdDate.toISOString(),
    };
  });
};

const AUTO_REFRESH_MS = (() => {
  const raw =
    typeof import.meta !== 'undefined' ? Number((import.meta as any)?.env?.VITE_AUTO_REFRESH_MS) : NaN;
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 5 * 60 * 1000; // 默认 5 分钟
})();

const getCookie = (name: string) => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
};

const setCookie = (name: string, value: string, days = 7) => {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; expires=${expires}`;
};

const deleteCookie = (name: string) => {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; path=/; expires=${new Date(0).toUTCString()}`;
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState('dashboard');
  const [allShips, setAllShips] = useState<Ship[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flagFilter, setFlagFilter] = useState<'ALL' | 'FOREIGN' | 'CHINA'>('FOREIGN');
  const [activeShip, setActiveShip] = useState<Ship | null>(null);
  const [workbenchShip, setWorkbenchShip] = useState<Ship | null>(null);
  const [followedShipsMap, setFollowedShipsMap] = useState<Record<string, Ship>>({});
  const [followedMeta, setFollowedMeta] = useState<Record<string, FollowedShipMeta>>({});
  const [followedDataUpdatedAt, setFollowedDataUpdatedAt] = useState<number | null>(null);
  const [shipDataUpdatedAt, setShipDataUpdatedAt] = useState<number | null>(null);
  const [followOpsQueue, setFollowOpsQueue] = useState<
    { op: 'follow' | 'unfollow' | 'update'; mmsi: string; payload?: FollowedShipMeta }[]
  >([]);
  const [followQueueBlocked, setFollowQueueBlocked] = useState(false);
  const [shareMode, setShareMode] = useState<'arrivals' | 'workspace' | null>(null);
  const [eventsTab, setEventsTab] = useState<'events' | 'arrivals'>('arrivals');
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareVerified, setShareVerified] = useState(true);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharePasswordInput, setSharePasswordInput] = useState('');
  const [activeShares, setActiveShares] = useState<Partial<Record<'arrivals' | 'workspace', { token: string }>>>({});
  const [shareModal, setShareModal] = useState<{ target: 'arrivals' | 'workspace'; url: string; password: string } | null>(null);
  const [shareRemoteMeta, setShareRemoteMeta] = useState<{
    token: string;
    target: 'arrivals' | 'workspace';
    passwordHash: string;
    active: boolean;
  } | null>(null);
  const [shareMetaStatus, setShareMetaStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const shareMessageTimer = useRef<number | null>(null);
  const flagFilterRef = useRef(flagFilter);
  const LOCAL_FOLLOW_CACHE = 'dockday_follow_cache_v1';
  const LOCAL_FOLLOW_QUEUE = 'dockday_follow_queue_v1';
  const localApiBase = useMemo(() => {
    if (API_CONFIG.LOCAL_API) return API_CONFIG.LOCAL_API;
    if (typeof window === 'undefined') return '';
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:4000`;
  }, []);
  const hasLocalApi = Boolean(localApiBase);
  useEffect(() => {
    flagFilterRef.current = flagFilter;
  }, [flagFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const share = params.get('share');
    const key = params.get('key');
    if (share === 'arrivals' || share === 'workspace') {
      setShareMode(share);
      setShareToken(key);
      if (share === 'arrivals') {
        setCurrentView('events');
        setEventsTab('arrivals');
      } else {
        setCurrentView('workspace');
      }
    } else {
      setShareMode(null);
      setShareToken(null);
      setShareVerified(true);
    }
  }, []);

  useEffect(() => {
    if (!shareMode) {
      setShareVerified(true);
      setShareError(null);
      setSharePasswordInput('');
      setShareRemoteMeta(null);
      setShareMetaStatus('idle');
      return;
    }
    if (!shareToken) {
      setShareVerified(false);
      setShareError('分享链接缺少密码信息，请联系分享者。');
      setShareRemoteMeta(null);
      setShareMetaStatus('error');
      return;
    }
    if (!hasLocalApi) {
      setShareVerified(false);
      setShareError('后端 API 未运行，无法验证分享链接');
      setShareRemoteMeta(null);
      setShareMetaStatus('error');
      return;
    }
    let aborted = false;
    setShareMetaStatus('loading');
    fetch(`${localApiBase}/share-links/${shareToken}`)
      .then(async (resp) => {
        if (!resp.ok) {
          if (resp.status === 404 || resp.status === 410) {
            throw new Error('分享已停止或密码已失效');
          }
          throw new Error('分享凭证校验失败');
        }
        const data = await resp.json();
        if (aborted) return;
        setShareRemoteMeta({
          token: data.token,
          target: data.target,
          passwordHash: data.password_hash,
          active: Boolean(data.active),
        });
        setShareMetaStatus('idle');
        setShareError(null);
        const authCookieKey = `dockday_share_auth_${shareToken}`;
        if (getCookie(authCookieKey) === '1') {
          setShareVerified(true);
        } else {
          setShareVerified(false);
          setSharePasswordInput('');
        }
      })
      .catch((err) => {
        if (aborted) return;
        setShareRemoteMeta(null);
        setShareMetaStatus('error');
        setShareVerified(false);
        setShareError(err instanceof Error ? err.message : '分享信息无效');
      });
    return () => {
      aborted = true;
    };
  }, [shareMode, shareToken, hasLocalApi, localApiBase]);

  useEffect(() => {
    return () => {
      if (shareMessageTimer.current) {
        window.clearTimeout(shareMessageTimer.current);
      }
    };
  }, []);

  const persistLocalFollow = useCallback(
    (meta: Record<string, FollowedShipMeta>, shipMap: Record<string, Ship>) => {
      if (typeof window === 'undefined') return;
      try {
        const payload = {
          meta,
          ships: shipMap,
        };
        window.localStorage.setItem(LOCAL_FOLLOW_CACHE, JSON.stringify(payload));
      } catch (err) {
        console.warn('persist follow cache failed', err);
      }
    },
    []
  );

  const persistQueue = useCallback(
    (queue: { op: 'follow' | 'unfollow' | 'update'; mmsi: string; payload?: FollowedShipMeta }[]) => {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(LOCAL_FOLLOW_QUEUE, JSON.stringify(queue));
      } catch (err) {
        console.warn('persist follow queue failed', err);
      }
    },
    []
  );

  const showShareMessage = useCallback((msg: string) => {
    if (shareMessageTimer.current) {
      window.clearTimeout(shareMessageTimer.current);
    }
    setShareMessage(msg);
    shareMessageTimer.current = window.setTimeout(() => {
      setShareMessage(null);
    }, 4000);
  }, []);

  const copyText = useCallback(async (text: string, successMsg?: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        if (successMsg) showShareMessage(successMsg);
        return;
      } catch (err) {
        console.warn('copy failed', err);
      }
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successMsg) showShareMessage(successMsg);
    } catch (err) {
      console.warn('fallback copy failed', err);
      if (successMsg) showShareMessage(`请手动复制：${text}`);
    }
  }, [showShareMessage]);

  const handleShareToggle = useCallback(
    async (target: 'arrivals' | 'workspace') => {
      if (!hasLocalApi) {
        showShareMessage('请先启动后端 API 服务再尝试分享');
        return;
      }
      if (activeShares[target]) {
        const { token } = activeShares[target]!;
        try {
          await fetch(`${localApiBase}/share-links/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });
        } catch (err) {
          console.warn('停止分享失败', err);
        }
        deleteCookie(`dockday_share_pass_${token}`);
        deleteCookie(`dockday_share_auth_${token}`);
        setActiveShares((prev) => {
          const next = { ...prev };
          delete next[target];
          return next;
        });
        setShareModal(null);
        showShareMessage('已停止分享，本次分享链接已失效。');
        return;
      }
      if (typeof window === 'undefined') return;
      const password = generateSharePassword();
      const token = Math.random().toString(36).slice(2, 10).toUpperCase();
      const encoded = window.btoa(password);
      try {
        const resp = await fetch(`${localApiBase}/share-links/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, target, password_hash: encoded }),
        });
        if (!resp.ok) {
          throw new Error(await resp.text());
        }
      } catch (err) {
        console.warn('同步分享令牌失败', err);
        showShareMessage('分享初始化失败，请稍后重试');
        return;
      }
      const passCookieKey = `dockday_share_pass_${token}`;
      const authCookieKey = `dockday_share_auth_${token}`;
      setCookie(passCookieKey, encoded, 1);
      setCookie(authCookieKey, '1', 1);
      const url = new URL(window.location.href);
      url.searchParams.set('share', target);
      url.searchParams.set('key', token);
      if (target === 'arrivals') {
        setCurrentView('events');
        setEventsTab('arrivals');
      }
      setActiveShares((prev) => ({ ...prev, [target]: { token } }));
      setShareModal({ target, url: url.toString(), password });
    },
    [activeShares, showShareMessage, hasLocalApi, localApiBase]
  );

  const handleShareAccess = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!shareToken) {
        setShareError('分享链接缺少密码信息，请联系分享者。');
        return;
      }
      if (!shareRemoteMeta || !shareRemoteMeta.active) {
        setShareError('分享已停止或密码已失效');
        return;
      }
      const normalized = sharePasswordInput.trim();
      if (!normalized) {
        setShareError('请输入密码');
        return;
      }
      const authCookieKey = `dockday_share_auth_${shareToken}`;
      const encoded = window.btoa(normalized);
      if (encoded === shareRemoteMeta.passwordHash) {
        setShareVerified(true);
        setShareError(null);
        setCookie(authCookieKey, '1');
        setSharePasswordInput('');
      } else {
        setShareError('密码不正确');
      }
    },
    [sharePasswordInput, shareToken, shareRemoteMeta]
  );

  const flushFollowQueue = useCallback(
    async (queueOverride?: { op: 'follow' | 'unfollow' | 'update'; mmsi: string; payload?: FollowedShipMeta }[]) => {
      if (followQueueBlocked) return;
      const queue = queueOverride ?? followOpsQueue;
      if (!queue.length) return;
      let blocked = false;
      const remaining: typeof queue = [];
      for (const job of queue) {
        try {
          if (job.op === 'follow') {
            await upsertFollowedShip({ mmsi: job.mmsi });
          } else if (job.op === 'unfollow') {
            await deleteFollowedShip(job.mmsi);
          } else if (job.op === 'update') {
            await upsertFollowedShip({
              mmsi: job.mmsi,
              berth: job.payload?.berth,
              agent: job.payload?.agent,
              agent_contact_name: job.payload?.agent_contact_name,
              agent_contact_phone: job.payload?.agent_contact_phone,
              remark: job.payload?.remark,
              is_target: job.payload?.is_target,
              crew_income_level: job.payload?.crew_income_level,
              disembark_intent: job.payload?.disembark_intent,
              email_status: job.payload?.email_status,
              crew_count: job.payload?.crew_count,
              expected_disembark_count: job.payload?.expected_disembark_count,
              actual_disembark_count: job.payload?.actual_disembark_count,
              disembark_date: job.payload?.disembark_date,
            });
          }
        } catch (err) {
          console.warn('follow queue job failed', err);
          const message = err instanceof Error ? err.message : String(err);
          // Any error (including 4xx/5xx) should stop further retries to avoid spamming
          if (!(err instanceof Error) || /CORS|Failed to fetch|Local API not configured|4\\d\\d|5\\d\\d|followed-ships/i.test(message)) {
            blocked = true;
            break;
          }
          remaining.push(job);
        }
      }
      if (blocked) {
        persistQueue(queue);
        setFollowOpsQueue(queue);
        setFollowQueueBlocked(true);
        return;
      }
      setFollowOpsQueue(remaining);
      persistQueue(remaining);
      if (remaining.length === 0) {
        try {
          const metas = await fetchFollowedShips();
          const metaMap = metas.reduce<Record<string, FollowedShipMeta>>((acc, item) => {
            if (item.mmsi)
              acc[String(item.mmsi)] = {
                ...item,
                is_target: !!(item as any).is_target,
                crew_income_level: item.crew_income_level ?? null,
                disembark_intent: item.disembark_intent ?? null,
                email_status: item.email_status ?? null,
                crew_count: item.crew_count ?? null,
                expected_disembark_count: item.expected_disembark_count ?? null,
                actual_disembark_count: item.actual_disembark_count ?? null,
                agent_contact_name: item.agent_contact_name ?? null,
                agent_contact_phone: item.agent_contact_phone ?? null,
                disembark_date: item.disembark_date ?? null,
              };
            return acc;
          }, {});
          setFollowedMeta(metaMap);
          setFollowQueueBlocked(false);
          setFollowedDataUpdatedAt(Date.now());
        } catch (err) {
          console.warn('refresh followed meta after flush failed', err);
          setFollowQueueBlocked(true);
          persistQueue(remaining);
        }
      }
    },
    [followOpsQueue, persistQueue, followQueueBlocked]
  );

  useEffect(() => {
    const loadFollowed = async () => {
      let localMeta: Record<string, FollowedShipMeta> = {};
      let localShips: Record<string, Ship> = {};
      let localQueue: { op: 'follow' | 'unfollow' | 'update'; mmsi: string; payload?: FollowedShipMeta }[] =
        [];
      if (typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(LOCAL_FOLLOW_CACHE);
          if (raw) {
            const parsed = JSON.parse(raw);
            localMeta = parsed?.meta || {};
            localShips = parsed?.ships || {};
            setFollowedMeta(localMeta);
            setFollowedShipsMap(localShips);
            setFollowedDataUpdatedAt(Date.now());
          }
          const rawQueue = window.localStorage.getItem(LOCAL_FOLLOW_QUEUE);
          if (rawQueue) {
            const parsedQueue = JSON.parse(rawQueue);
            if (Array.isArray(parsedQueue)) {
              localQueue = parsedQueue;
              setFollowOpsQueue(parsedQueue);
            }
          }
        } catch (err) {
          console.warn('load follow cache failed', err);
        }
      }

      try {
        if (!hasLocalApi) {
          setFollowQueueBlocked(true);
          return;
        }
        const metas = await fetchFollowedShips();
        const metaMap = metas.reduce<Record<string, FollowedShipMeta>>((acc, item) => {
          if (item.mmsi)
            acc[String(item.mmsi)] = {
              ...item,
              is_target: !!(item as any).is_target,
              crew_income_level: item.crew_income_level ?? null,
              disembark_intent: item.disembark_intent ?? null,
              email_status: item.email_status ?? null,
              crew_count: item.crew_count ?? null,
              expected_disembark_count: item.expected_disembark_count ?? null,
              actual_disembark_count: item.actual_disembark_count ?? null,
              agent_contact_name: item.agent_contact_name ?? null,
              agent_contact_phone: item.agent_contact_phone ?? null,
              disembark_date: item.disembark_date ?? null,
            };
          return acc;
        }, {});
        // merge local fallback ships into map to keep data for ones not in live list
        setFollowedMeta((prev) => ({ ...localMeta, ...metaMap }));
        setFollowedShipsMap((prev) => ({ ...localShips, ...prev }));
        persistLocalFollow({ ...localMeta, ...metaMap }, { ...localShips, ...followedShipsMap });
        setFollowedDataUpdatedAt(Date.now());
        // 尝试冲刷本地队列
        if (localQueue.length > 0) {
          flushFollowQueue(localQueue);
        }
      } catch (err) {
        console.warn('Failed to load followed meta', err);
        setFollowQueueBlocked(true);
      }
    };
    loadFollowed();
  }, [persistLocalFollow, hasLocalApi]);

  const followedMmsiSet = useMemo(() => new Set(Object.keys(followedMeta)), [followedMeta]);
  const dockdayTargetSet = useMemo(() => {
    const targets = new Set<string>();
    Object.values(followedMeta).forEach((item) => {
      if (item?.is_target) targets.add(String(item.mmsi));
    });
    return targets;
  }, [followedMeta]);

  const followedShips = useMemo(() => {
    const list: Ship[] = [];
    followedMmsiSet.forEach((mmsi) => {
      const fromLive = allShips.find((s) => s.mmsi === mmsi);
      const cached = followedShipsMap[mmsi];
      if (fromLive) list.push(fromLive);
      else if (cached) list.push(cached);
      else {
        list.push({
          id: mmsi,
          name: `关注船舶 ${mmsi}`,
          mmsi,
          flag: '-',
          type: '-',
          eta: '',
          etd: '',
          riskLevel: RiskLevel.NORMAL,
          docStatus: DocStatus.APPROVED,
          lastPort: '',
          agent: '',
        } as Ship);
      }
    });
    return list;
  }, [followedMmsiSet, allShips, followedShipsMap]);

  const filterShipsByFlag = (shipList: Ship[], filter: 'ALL' | 'FOREIGN' | 'CHINA') => {
    if (filter === 'FOREIGN') {
      const filtered = shipList.filter((ship) => !isMainlandFlag(ship.flag));
      return filtered.length > 0 ? filtered : shipList;
    }
    if (filter === 'CHINA') {
      const filtered = shipList.filter((ship) => isMainlandFlag(ship.flag));
      return filtered.length > 0 ? filtered : shipList;
    }
    return shipList;
  };

  const loadData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (!silent) setLoading(true);
      setRefreshing(true);
      setError(null);
      try {
        // Default: Fetch next 7 days for Nanjing (CNNJG)
        const now = Math.floor(Date.now() / 1000);
        const historyWindow = 3 * 24 * 60 * 60; // keep 3 days of history
        const futureWindow = 7 * 24 * 60 * 60;
        const startTime = Math.max(0, now - historyWindow);
        const endTime = now + futureWindow;

        const res = await fetchETAShips('CNNJG', startTime, endTime);

        if (res.status === 0) {
          const fallbackShips = getFreshMockShips();
          const formattedShips = transformApiData(res.data || []);
          const finalShips = formattedShips.length > 0 ? formattedShips : fallbackShips;
          setAllShips(finalShips);
          setShips(filterShipsByFlag(finalShips, flagFilterRef.current));
          setShipDataUpdatedAt(Date.now());
          setNotice(formattedShips.length > 0 ? null : '接口无返回，展示示例数据');
        } else {
          const fallbackShips = getFreshMockShips();
          setError(null);
          setNotice((res.msg || '数据加载失败') + '，已展示示例数据');
          setAllShips(fallbackShips);
          setShips(filterShipsByFlag(fallbackShips, flagFilterRef.current));
          setShipDataUpdatedAt(Date.now());
        }
      } catch (err) {
        console.error(err);
        setError(null);
        setNotice('网络请求失败，已展示示例数据');
        const fallbackShips = getFreshMockShips();
        setAllShips(fallbackShips);
        setShips(filterShipsByFlag(fallbackShips, flagFilterRef.current));
        setShipDataUpdatedAt(Date.now());
      } finally {
        if (!silent) setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!hasLocalApi) return;
    if (followOpsQueue.length > 0 && !followQueueBlocked) {
      flushFollowQueue();
    }
  }, [followOpsQueue, flushFollowQueue, hasLocalApi, followQueueBlocked]);

  useEffect(() => {
    if (!hasLocalApi) return;
    if (followQueueBlocked) return;
    const timer = setInterval(() => {
      if (followOpsQueue.length > 0) {
        flushFollowQueue();
      }
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [followOpsQueue.length, flushFollowQueue, followQueueBlocked, hasLocalApi]);

  useEffect(() => {
    if (!AUTO_REFRESH_MS) return;
    const timer = setInterval(() => {
      loadData({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    setShips(filterShipsByFlag(allShips, flagFilter));
  }, [allShips, flagFilter]);

  useEffect(() => {
    setFollowedShipsMap((prev) => {
      let changed = false;
      const next = { ...prev };
      allShips.forEach((ship) => {
        if (followedMmsiSet.has(ship.mmsi)) {
          next[ship.mmsi] = ship;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [allShips, followedMmsiSet]);

  const handleFollowShip = useCallback(
    async (ship: Ship) => {
      try {
        if (!hasLocalApi) throw new Error('Local API not configured');
        await upsertFollowedShip({ mmsi: ship.mmsi });
        const metas = await fetchFollowedShips();
        let metaMap = metas.reduce<Record<string, FollowedShipMeta>>((acc, item) => {
          if (item.mmsi) acc[String(item.mmsi)] = { ...item, is_target: !!(item as any).is_target };
          return acc;
        }, {});
        if (Object.keys(metaMap).length === 0) {
          metaMap = { ...followedMeta, [ship.mmsi]: { mmsi: ship.mmsi } };
        }
        const shipsMap = { ...followedShipsMap, [ship.mmsi]: ship };
        setFollowedMeta(metaMap);
        setFollowedShipsMap(shipsMap);
        persistLocalFollow(metaMap, shipsMap);
        setFollowedDataUpdatedAt(Date.now());
      } catch (err) {
        console.warn('Follow ship failed', err);
        // 即使后端不可用，仍在前端标记关注以保证按钮反馈
        const meta = { ...followedMeta, [ship.mmsi]: { mmsi: ship.mmsi } };
        const ships = { ...followedShipsMap, [ship.mmsi]: ship };
        setFollowedMeta(meta);
        setFollowedShipsMap(ships);
        persistLocalFollow(meta, ships);
        setFollowedDataUpdatedAt(Date.now());
        setFollowOpsQueue((prev) => {
          const next = [...prev, { op: 'follow', mmsi: ship.mmsi }];
          persistQueue(next);
          return next;
        });
      }
    },
    [followedMeta, followedShipsMap, persistLocalFollow, persistQueue, hasLocalApi]
  );

  const handleFollowShipFromApi = useCallback(
    async (ship: ShipxyShip) => {
      const [converted] = transformApiData([ship]);
      if (converted) {
        await handleFollowShip(converted);
      }
    },
    [handleFollowShip]
  );

  const handleUnfollowShip = useCallback(async (mmsi: string) => {
    try {
      if (!hasLocalApi) throw new Error('Local API not configured');
      await deleteFollowedShip(mmsi);
      const metas = await fetchFollowedShips();
        const metaMap = metas.reduce<Record<string, FollowedShipMeta>>((acc, item) => {
          if (item.mmsi)
            acc[String(item.mmsi)] = {
              ...item,
              is_target: !!(item as any).is_target,
              crew_income_level: item.crew_income_level ?? null,
              disembark_intent: item.disembark_intent ?? null,
              email_status: item.email_status ?? null,
              crew_count: item.crew_count ?? null,
              expected_disembark_count: item.expected_disembark_count ?? null,
              actual_disembark_count: item.actual_disembark_count ?? null,
              agent_contact_name: item.agent_contact_name ?? null,
              agent_contact_phone: item.agent_contact_phone ?? null,
              disembark_date: item.disembark_date ?? null,
            };
          return acc;
        }, {});
      setFollowedMeta(metaMap);
      const nextShips = { ...followedShipsMap };
      delete nextShips[mmsi];
      setFollowedShipsMap(nextShips);
      persistLocalFollow(metaMap, nextShips);
      setFollowedDataUpdatedAt(Date.now());
      return;
    } catch (err) {
      console.warn('Unfollow ship failed', err);
    }
    setFollowedMeta((prev) => {
      const next = { ...prev };
      delete next[mmsi];
      persistLocalFollow(next, followedShipsMap);
      return next;
    });
    setFollowedShipsMap((prev) => {
      const next = { ...prev };
      delete next[mmsi];
      persistLocalFollow(followedMeta, next);
      return next;
    });
    setFollowedDataUpdatedAt(Date.now());
    setFollowOpsQueue((prev) => {
      const next = [...prev, { op: 'unfollow', mmsi }];
      persistQueue(next);
      return next;
    });
  }, [followedMeta, followedShipsMap, persistLocalFollow, persistQueue, flushFollowQueue]);

  const isShipFollowed = useCallback(
    (mmsi: string | number) => followedMmsiSet.has(String(mmsi)),
    [followedMmsiSet]
  );

  const handleUpdateFollowMeta = useCallback(
    async (mmsi: string, patch: Partial<FollowedShipMeta>) => {
      const nextMeta = { ...(followedMeta[mmsi] || { mmsi }), ...patch };
      try {
        if (!hasLocalApi) throw new Error('Local API not configured');
        await upsertFollowedShip({
          mmsi,
          berth: nextMeta.berth,
          agent: nextMeta.agent,
          agent_contact_name: nextMeta.agent_contact_name,
          agent_contact_phone: nextMeta.agent_contact_phone,
          remark: nextMeta.remark,
          is_target: nextMeta.is_target,
          crew_income_level: nextMeta.crew_income_level,
          disembark_intent: nextMeta.disembark_intent,
          email_status: nextMeta.email_status,
          crew_count: nextMeta.crew_count,
          expected_disembark_count: nextMeta.expected_disembark_count,
          actual_disembark_count: nextMeta.actual_disembark_count,
          disembark_date: nextMeta.disembark_date,
        });
        setFollowedMeta((prev) => {
          const next = { ...prev, [mmsi]: nextMeta };
          persistLocalFollow(next, followedShipsMap);
          return next;
        });
        setFollowedDataUpdatedAt(Date.now());
      } catch (err) {
        console.warn('Update follow meta failed', err);
        setFollowedMeta((prev) => {
          const next = { ...prev, [mmsi]: nextMeta };
          persistLocalFollow(next, followedShipsMap);
          return next;
        });
        setFollowedDataUpdatedAt(Date.now());
      }
      setFollowOpsQueue((prev) => {
        const next = [...prev, { op: 'update', mmsi, payload: nextMeta }];
        persistQueue(next);
        return next;
      });
    },
    [followedMeta, followedShipsMap, persistLocalFollow, persistQueue, hasLocalApi]
  );

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return (
          <DashboardRadar
            ships={ships}
            allShips={allShips}
            flagFilter={flagFilter}
            onFlagChange={setFlagFilter}
            onRefresh={() => loadData({ silent: true })}
            refreshing={refreshing}
            onSelectShip={setActiveShip}
            onNavigateToEvents={() => {
              setCurrentView('events');
              setEventsTab('events');
            }}
            onNavigateToArrivals={() => {
              setCurrentView('events');
              setEventsTab('arrivals');
            }}
            onFollowShip={handleFollowShip}
            followedSet={followedMmsiSet}
          />
        );
      case 'workspace':
        return (
          <WorkbenchPage
            followedShips={followedShips}
            onUnfollow={handleUnfollowShip}
            activeShip={workbenchShip}
            setActiveShip={setWorkbenchShip}
            meta={followedMeta}
            onUpdateMeta={handleUpdateFollowMeta}
            lastUpdatedAt={followedDataUpdatedAt}
            onShareFollow={shareMode ? undefined : () => handleShareToggle('workspace')}
            isSharing={Boolean(activeShares.workspace)}
            isShareMode={shareMode === 'workspace'}
          />
        );
      case 'events':
        return (
          <RealtimeEventsPage
            ships={ships}
            allShips={allShips}
            onSelectShip={(ship) => setActiveShip(ship)}
            dockdayTargetSet={dockdayTargetSet}
            tab={eventsTab}
            onTabChange={setEventsTab}
            arrivalDataUpdatedAt={shipDataUpdatedAt}
            onShareArrivals={shareMode ? undefined : () => handleShareToggle('arrivals')}
            shareArrivalsActive={Boolean(activeShares.arrivals)}
            isShareModeArrivals={shareMode === 'arrivals'}
          />
        );
      case 'data':
        return (
          <DataQueryCenter
            onFollowShip={handleFollowShipFromApi}
            isFollowed={isShipFollowed}
          />
        );
      case 'crew':
        return <CrewDisembarkPage />;
      case 'crew-lifecycle':
        return <CrewLifecyclePage ships={ships} allShips={allShips} />;
      default:
        return (
          <DashboardRadar
            ships={ships}
            allShips={allShips}
            flagFilter={flagFilter}
            onFlagChange={setFlagFilter}
            onRefresh={() => loadData({ silent: true })}
            refreshing={refreshing}
            onSelectShip={setActiveShip}
            onNavigateToEvents={() => setCurrentView('events')}
            onNavigateToArrivals={() => setCurrentView('arrivals')}
            onFollowShip={handleFollowShip}
            followedSet={followedMmsiSet}
          />
        );
    }
  };

  const mainContent = (
    <>
      {loading && (
        <div className="absolute inset-0 bg-slate-950/80 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="flex flex-col items-center">
            <Loader2 className="w-8 h-8 text-blue-400 animate-spin mb-2" />
            <p className="text-sm text-slate-300 font-medium">正在同步预抵船舶数据...</p>
          </div>
        </div>
      )}

      {notice && !loading && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-400/30 text-amber-200 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle size={16} className="text-amber-300" />
          <span>{notice}</span>
        </div>
      )}
      {shareMessage && (
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-400/30 text-blue-200 rounded-lg text-sm whitespace-pre-line">
          {shareMessage}
        </div>
      )}

      {!loading && renderContent()}

      {shareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setShareModal(null)}
              className="absolute top-3 right-3 p-1 rounded-full border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition"
            >
              <X className="w-4 h-4" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">share link</p>
              <h2 className="text-xl font-semibold text-white mt-1">
                {shareModal.target === 'arrivals' ? '进港动态详情' : '工作台关注列表'}
              </h2>
              <p className="text-xs text-slate-400 mt-1">链接与密码仅本次有效，再次点击分享可立即失效。</p>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-400">分享链接</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 break-all">
                  {shareModal.url}
                </div>
                <button
                  onClick={() => copyText(shareModal.url, '链接已复制')}
                  className="px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-blue-400 transition flex items-center gap-1"
                >
                  <Copy className="w-4 h-4" />
                  复制
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-400">访问密码</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-emerald-200 tracking-widest font-mono">
                  {shareModal.password}
                </div>
                <button
                  onClick={() => copyText(shareModal.password, '密码已复制')}
                  className="px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-blue-400 transition flex items-center gap-1"
                >
                  <Copy className="w-4 h-4" />
                  复制
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              提示：再次点击「停止分享」可立即失效，已打开的分享页面刷新后需输入新密码。
            </p>
          </div>
        </div>
      )}
    </>
  );

  if (shareMode) {
    if (!shareVerified) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="space-y-1">
              <p className="text-sm uppercase tracking-[0.3em] text-slate-500">share access</p>
              <h1 className="text-2xl font-semibold text-white">
                {shareMode === 'arrivals' ? '进港详情' : '工作台关注列表'}
              </h1>
              <p className="text-xs text-slate-400">请输入分享者提供的密码以查看内容</p>
            </div>
            {shareToken ? (
              shareMetaStatus === 'loading' ? (
                <p className="text-sm text-slate-400">正在校验分享信息...</p>
              ) : shareRemoteMeta && shareRemoteMeta.active ? (
                <form onSubmit={handleShareAccess} className="space-y-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">访问密码</label>
                    <input
                      type="password"
                      value={sharePasswordInput}
                      onChange={(e) => setSharePasswordInput(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-400 focus:outline-none"
                      placeholder="输入密码"
                    />
                  </div>
                  {shareError && <p className="text-xs text-rose-300">{shareError}</p>}
                  <button
                    type="submit"
                    className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                  >
                    确认
                  </button>
                </form>
              ) : (
                <p className="text-sm text-rose-300">{shareError || '分享链接无效'}</p>
              )
            ) : (
              <p className="text-sm text-rose-300">{shareError || '链接无效'}</p>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-950 overflow-auto p-6 relative">
        {mainContent}
        {shareMode === 'arrivals' && (
          <ShipDetailModal ship={activeShip} onClose={() => setActiveShip(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      <Sidebar currentView={currentView} setView={setCurrentView} />
      
      <main className="flex-1 overflow-auto p-6 relative bg-slate-950">{mainContent}</main>
      {currentView !== 'workspace' && (!shareMode || shareMode === 'arrivals') && (
        <ShipDetailModal ship={activeShip} onClose={() => setActiveShip(null)} />
      )}
    </div>
  );
};

export default App;
const generateSharePassword = () => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const array = new Uint32Array(8);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map((v) => chars[v % chars.length])
      .join('');
  }
  return Math.random().toString(36).slice(-8).toUpperCase();
};
