import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatSmartWeekdayLabel } from '../utils/date';
import { Ship } from '../types';
import { getRiskBadgeClass, getRiskLabel } from '../utils/risk';
import { formatPortWithCountry } from '../utils/port';
import { isMainlandFlag } from '../utils/ship';
import { Share2 } from 'lucide-react';

interface ArrivalDetailsPageProps {
  ships: Ship[];
  allShips: Ship[];
  onSelectShip: (ship: Ship) => void;
  onFollowShip?: (ship: Ship) => void;
  followedSet?: Set<string>;
  dockdayTargetSet?: Set<string>;
  dataUpdatedAt?: number | null;
  onShare?: () => void;
  shareActive?: boolean;
  isShareMode?: boolean;
}

const FLAG_EMOJI_MAP: Record<string, string> = {
  中国: '🇨🇳',
  中国香港: '🇭🇰',
  中国澳门: '🇲🇴',
  台湾: '🇹🇼',
  PANAMA: '🇵🇦',
  巴拿马: '🇵🇦',
  LIBERIA: '🇱🇷',
  利比里亚: '🇱🇷',
  SINGAPORE: '🇸🇬',
  新加坡: '🇸🇬',
  JAPAN: '🇯🇵',
  日本: '🇯🇵',
  UNITEDSTATES: '🇺🇸',
  美国: '🇺🇸',
  UNITEDKINGDOM: '🇬🇧',
  英国: '🇬🇧',
  NORWAY: '🇳🇴',
  CYPRUS: '🇨🇾',
  BELGIUM: '🇧🇪',
  MARSHALLISLANDS: '🇲🇭',
  马绍尔群岛: '🇲🇭',
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

const draughtStats = { min: 2, max: 20 };
const getDraughtRatio = (value?: number) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }
  const clamped = Math.min(Math.max(value, draughtStats.min), draughtStats.max);
  const ratio = (clamped - draughtStats.min) / (draughtStats.max - draughtStats.min);
  return Math.min(1, Math.max(0, ratio));
};

const normalizeEtaString = (eta?: string | null) => {
  if (!eta) return '';
  return eta.replace(/[（(].*?[）)]/g, '').replace(/\s+/g, ' ').trim();
};

const parseEta = (eta?: string | null) => {
  const normalized = normalizeEtaString(eta);
  if (!normalized) return null;
  const candidate = normalized.includes('T') ? normalized : normalized.replace(' ', 'T');
  const attempts = [candidate, `${candidate}+08:00`, `${candidate}Z`];
  for (const value of attempts) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

const filterByRange = (ship: Ship, range: string) => {
  const etaTs = parseEta(ship.eta);
  if (!etaTs) return false;
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (range === 'TODAY') {
    return etaTs >= today.getTime() && etaTs < tomorrow.getTime();
  }
  if (range === 'TOMORROW') {
    const dayAfter = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
    return etaTs >= tomorrow.getTime() && etaTs < dayAfter.getTime();
  }
  return etaTs >= now.getTime();
};

const formatUpdateTime = (ts?: number | null) => {
  if (!ts) return '未同步';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
};

const SHARE_PAGE_SIZE = 10;
const SHARE_PAGE_DURATION = 50_000;
const BOARD_ANIMATION = `
@keyframes dockdayBoardSlide {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes dockdayFlipIn {
  0% {
    opacity: 0;
    transform: rotateX(70deg) scale(0.96);
  }
  60% {
    opacity: 1;
    transform: rotateX(-10deg) scale(1.01);
  }
  100% {
    opacity: 1;
    transform: rotateX(0deg) scale(1);
  }
}
.dockday-share-card-active {
  animation: dockdayFlipIn 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  transform-origin: top center;
  backface-visibility: hidden;
  perspective: 1200px;
}
.dockday-pinned-card-pulse::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: none;
  box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.35);
  animation: dockdayPinnedGlow 4s ease-in-out infinite;
  pointer-events: none;
}
@keyframes dockdayPinnedGlow {
  0% {
    opacity: 0.4;
    box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.35);
  }
  50% {
    opacity: 0.9;
    box-shadow: 0 0 14px 3px rgba(251, 191, 36, 0.6);
  }
  100% {
    opacity: 0.4;
    box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.35);
  }
}
`;

export const ArrivalDetailsPage: React.FC<ArrivalDetailsPageProps> = ({
  ships,
  allShips,
  onSelectShip,
  onFollowShip,
  followedSet,
  dockdayTargetSet,
  dataUpdatedAt,
  onShare,
  shareActive,
  isShareMode,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'TODAY' | 'TOMORROW'>('ALL');
  const [page, setPage] = useState(1);
  const [shareDisplayShips, setShareDisplayShips] = useState<Ship[]>([]);
  const [shareFlippingSlot, setShareFlippingSlot] = useState<number | null>(null);
  const sharePointerRef = useRef(0);
  const shareSlotRef = useRef(0);
  const PAGE_SIZE = 10;
  const base = allShips.length > 0 ? allShips : ships;

  const arrivalShips = useMemo(() => {
    const now = Date.now();
    const foreignOnly = base.filter((ship) => !isMainlandFlag(ship.flag || ''));
    const filtered =
      filter === 'ALL' ? foreignOnly : foreignOnly.filter((ship) => filterByRange(ship, filter));
    const sorted = [...filtered].sort((a, b) => {
      const ta = parseEta(a.eta);
      const tb = parseEta(b.eta);
      const aPast = typeof ta === 'number' && ta < now;
      const bPast = typeof tb === 'number' && tb < now;
      if (aPast !== bPast) return aPast ? 1 : -1;
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ta - tb;
    });
    if (!isShareMode || !dockdayTargetSet || dockdayTargetSet.size === 0) return sorted;
    if (sorted.length <= 1) return sorted;
    const [first, ...rest] = sorted;
    const targets = rest.filter((ship) => dockdayTargetSet.has(ship.mmsi));
    const remaining = rest.filter((ship) => !dockdayTargetSet.has(ship.mmsi));
    return [first, ...targets, ...remaining];
  }, [base, filter, isShareMode, dockdayTargetSet]);

  const totalPages = Math.max(1, Math.ceil(Math.max(arrivalShips.length, 1) / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedShips = arrivalShips.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const shareFallbackShips = arrivalShips.slice(0, Math.min(SHARE_PAGE_SIZE, arrivalShips.length));
  const visibleShips = isShareMode
    ? shareDisplayShips.length > 0
      ? shareDisplayShips
      : shareFallbackShips
    : paginatedShips;

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [totalPages, page]);

  useEffect(() => {
    if (!isShareMode) {
      if (shareDisplayShips.length > 0) {
        setShareDisplayShips([]);
      }
      sharePointerRef.current = 0;
      shareSlotRef.current = 0;
      return;
    }
    if (arrivalShips.length === 0) {
      if (shareDisplayShips.length > 0) {
        setShareDisplayShips([]);
      }
      sharePointerRef.current = 0;
      shareSlotRef.current = 0;
      return;
    }
    const next: Ship[] = [];
    for (let i = 0; i < SHARE_PAGE_SIZE; i++) {
      const ship = arrivalShips[i % arrivalShips.length];
      next.push(ship);
    }
    const sameOrder =
      shareDisplayShips.length === next.length &&
      shareDisplayShips.every((ship, index) => ship.mmsi === next[index]?.mmsi);
    if (!sameOrder) {
      setShareDisplayShips(next);
      sharePointerRef.current = SHARE_PAGE_SIZE % arrivalShips.length;
      shareSlotRef.current = 0;
    }
  }, [isShareMode, arrivalShips, shareDisplayShips]);

  useEffect(() => {
    if (!isShareMode) return;
    if (arrivalShips.length === 0) return;
    if (shareDisplayShips.length === 0) return;
    const timer = setInterval(() => {
      setShareDisplayShips((prev) => {
        if (prev.length === 0 || arrivalShips.length === 0) return prev;
        if (prev.length === 1) return prev;
        const nextShip = arrivalShips[sharePointerRef.current % arrivalShips.length];
        const availableSlots = Math.max(prev.length - 1, 1);
        const slotOffset = shareSlotRef.current % availableSlots;
        const slot = slotOffset + 1;
        const updated = [...prev];
        updated[slot] = nextShip;
        sharePointerRef.current = (sharePointerRef.current + 1) % arrivalShips.length;
        shareSlotRef.current = (shareSlotRef.current + 1) % availableSlots;
        setShareFlippingSlot(slot);
        return updated;
      });
    }, SHARE_PAGE_DURATION / SHARE_PAGE_SIZE);
    return () => clearInterval(timer);
  }, [isShareMode, arrivalShips, shareDisplayShips.length]);

  useEffect(() => {
    if (shareFlippingSlot === null) return;
    const timeout = setTimeout(() => setShareFlippingSlot(null), 900);
    return () => clearTimeout(timeout);
  }, [shareFlippingSlot]);

  return (
    <div className="space-y-5">
      {isShareMode && <style>{BOARD_ANIMATION}</style>}
      {!isShareMode && (
        <div className="flex flex-wrap gap-3 items-start">
          <div className="text-left flex-1 min-w-[200px]">
            <h1 className="text-xl font-semibold text-white">进港动态</h1>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs text-slate-400 w-full lg:w-[30%] ml-auto">
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {[
                { id: 'ALL', label: '全部' },
                { id: 'TODAY', label: '仅今天' },
                { id: 'TOMORROW', label: '明天' },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => setFilter(option.id as 'ALL' | 'TODAY' | 'TOMORROW')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                    filter === option.id
                      ? 'bg-blue-500/20 text-blue-100 border-blue-400/50'
                      : 'text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
              {onShare && !isShareMode && (
                <button
                  onClick={onShare}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                    shareActive
                      ? 'border-rose-500/40 text-rose-200 hover:border-rose-400'
                      : 'border-slate-600 text-slate-200 hover:border-blue-400 hover:text-white'
                  }`}
                >
                  <Share2 className="w-3.5 h-3.5" />
                  {shareActive ? '停止分享' : '分享列表'}
                </button>
              )}
            </div>
            <p>数据更新至 {formatUpdateTime(dataUpdatedAt)}</p>
          </div>
        </div>
      )}

        <div
          key={isShareMode ? 'share-board' : `page-${currentPage}`}
          className={`space-y-3 ${
            isShareMode ? 'rounded-2xl border border-white/10 bg-slate-950/30 p-2 shadow-inner' : ''
          }`}
          style={isShareMode ? { animation: 'dockdayBoardSlide 0.8s ease' } : undefined}
        >
          {visibleShips.map((ship, idx) => {
            const rawDraught =
              typeof ship.draught === 'number'
                ? ship.draught
                : typeof ship.draught === 'string'
                  ? Number(ship.draught)
                  : undefined;
            const hasDraught = typeof rawDraught === 'number' && Number.isFinite(rawDraught);
            const normalizedDraught = getDraughtRatio(hasDraught ? rawDraught : undefined);
            const markerPosition =
              normalizedDraught === null ? null : Math.max(4, (1 - normalizedDraught) * 100);
            const normalizedEta = normalizeEtaString(ship.eta);
            const etaWeekLabel = formatSmartWeekdayLabel(normalizedEta);
            const etaTimestamp = parseEta(ship.eta);
            const isPastEta = typeof etaTimestamp === 'number' && etaTimestamp < Date.now();
            const isPinnedCard = isShareMode && idx === 0;
            const isDockdayTarget = Boolean(dockdayTargetSet?.has(ship.mmsi));
            const hasTopBadge = isPinnedCard || isDockdayTarget;
            const isFollowed = followedSet?.has(ship.mmsi) ?? false;
            const followDisabled = !onFollowShip || isFollowed || isShareMode;
            return (
              <div
                key={ship.mmsi}
              role="button"
              tabIndex={0}
              onClick={() => onSelectShip(ship)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectShip(ship);
                }
              }}
                className={`relative w-full rounded-3xl border ${
                  isPinnedCard || isDockdayTarget
                    ? 'border-amber-300/60 shadow-[0_18px_45px_-20px_rgba(251,191,36,0.65)] bg-gradient-to-br from-amber-400/15 via-slate-900/50 to-slate-900/20 dockday-pinned-card-pulse'
                    : 'border-white/5 bg-gradient-to-br from-slate-900/70 via-slate-900/40 to-slate-900/20 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.8)]'
                } ${hasTopBadge ? 'pt-10' : ''} px-3 py-3 sm:px-4 sm:py-4 backdrop-blur flex flex-col gap-4 md:flex-row md:items-center cursor-pointer focus:outline-none focus:ring-2 ${
                  isPastEta ? 'opacity-60 hover:opacity-90' : ''
                } ${isShareMode && shareFlippingSlot === idx ? 'dockday-share-card-active' : ''}`}
            >
              {isPinnedCard && (
                <div className="absolute top-3 left-4 px-3 py-0.5 rounded-full bg-amber-400/90 text-slate-900 text-[10px] font-semibold tracking-[0.2em] uppercase shadow-lg border border-amber-200/70">
                  最近进港
                </div>
              )}
              {isDockdayTarget && (
                <div className="absolute top-3 left-4 px-3 py-0.5 rounded-full bg-gradient-to-r from-amber-300 to-orange-400 text-slate-900 text-[10px] font-semibold uppercase shadow-lg border border-amber-300/80">
                  ⭐ Dockday 目标船
                </div>
              )}
              <div className="md:hidden flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="text-3xl leading-none drop-shadow" title={ship.flag || '未知船籍'}>
                    {getFlagEmoji(ship.flag)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-semibold text-white truncate">{ship.name}</p>
                      {ship.cnName && (
                        <span className="text-[11px] text-slate-400 truncate">({ship.cnName})</span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getRiskBadgeClass(
                          ship.riskLevel
                        )}`}
                      >
                        {getRiskLabel(ship.riskLevel)}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono">
                      MMSI {ship.mmsi} · IMO {ship.imo || '-'} · 船籍 {ship.flag || '-'}
                    </p>
                  </div>
                  <div className="ml-auto">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!followDisabled && onFollowShip) onFollowShip(ship);
                      }}
                      disabled={followDisabled}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        isFollowed
                          ? 'border-emerald-500/40 text-emerald-200 cursor-not-allowed'
                          : followDisabled
                            ? 'border-white/10 text-white/30 cursor-not-allowed'
                            : 'border-white/20 text-white/70 hover:text-white hover:border-white/40'
                      }`}
                    >
                      {isFollowed ? '已关注' : '+关注'}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-2xl border border-white/5 px-3 py-2 bg-white/5">
                    <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">ETA</p>
                    <p className="text-sm font-semibold text-white mt-1">
                      {etaTimestamp
                        ? new Date(etaTimestamp).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-'}
                      {etaWeekLabel && (
                        <span className="text-[10px] text-slate-400 ml-1">({etaWeekLabel})</span>
                      )}
                    </p>
                    {formatRelativeTime(ship.lastTimeUtc || ship.lastTime) && (
                      <p className="text-[10px] text-slate-500">
                        更新于 {formatRelativeTime(ship.lastTimeUtc || ship.lastTime)}
                      </p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-white/5 px-3 py-2 bg-white/5">
                    <p className="text-[10px] text-slate-400">出发港</p>
                    <p className="text-sm font-semibold text-white truncate">
                      {formatPortWithCountry(ship.lastPort)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="hidden md:flex items-start gap-3 flex-1 min-w-0">
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
                  {ship.cnName && <p className="text-xs text-slate-400 truncate">{ship.cnName}</p>}
                  <p className="text-[11px] text-slate-500 font-mono">
                    MMSI {ship.mmsi} • IMO {ship.imo || '-'} • 船籍 {ship.flag || '-'}
                  </p>
                </div>
              </div>
              <div className="hidden md:grid flex-1 min-w-0 grid-cols-2 gap-4 text-xs text-slate-400">
                <div className="rounded-2xl border border-white/5 px-3 py-2 bg-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="uppercase tracking-[0.2em] text-[9px] text-slate-400 mt-[3px]">ETA</p>
                    <div className="flex flex-col text-right">
                      <p className="text-sm font-semibold text-white">
                        {etaTimestamp
                          ? new Date(etaTimestamp).toLocaleString('zh-CN', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '-'}
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
                  <p className="text-[11px] text-slate-400 mb-0.5">出发港</p>
                  <p className="text-sm font-semibold text-white truncate">
                    {formatPortWithCountry(ship.lastPort)}
                  </p>
                </div>
              </div>
              <div className="hidden md:flex items-end gap-3">
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
                    {hasDraught ? `${rawDraught!.toFixed(1)} m` : '-'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!followDisabled && onFollowShip) onFollowShip(ship);
                    }}
                    disabled={followDisabled}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      isFollowed
                        ? 'border-emerald-500/40 text-emerald-200 cursor-not-allowed'
                        : followDisabled
                          ? 'border-white/10 text-white/30 cursor-not-allowed'
                          : 'border-white/20 text-white/70 hover:text-white hover:border-white/40'
                    }`}
                  >
                    {isFollowed ? '已关注' : '+关注'}
                  </button>
                  <span className="p-2 rounded-full border border-white/20 text-white/70 bg-white/5">
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
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {isShareMode ? (
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-blue-200/80">
            <span className="text-slate-500">Dockday Live Board</span>
            <span className="text-white font-semibold">
              自动翻牌 · 当前循环 {arrivalShips.length || 0} 条
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm text-slate-400">
            <button
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className={`px-3 py-1.5 rounded-lg border ${
                currentPage === 1
                  ? 'border-slate-800 text-slate-600 cursor-not-allowed'
                  : 'border-slate-700 text-slate-200 hover:border-blue-400 hover:text-white'
              }`}
            >
              上一页
            </button>
            <span>
              第 <span className="text-white font-semibold">{currentPage}</span> /{' '}
              <span className="text-white font-semibold">{totalPages}</span> 页
            </span>
            <button
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className={`px-3 py-1.5 rounded-lg border ${
                currentPage === totalPages
                  ? 'border-slate-800 text-slate-600 cursor-not-allowed'
                  : 'border-slate-700 text-slate-200 hover:border-blue-400 hover:text-white'
              }`}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
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
