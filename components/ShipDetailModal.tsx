import React from 'react';
import { Ship } from '../types';
import { getRiskBadgeClass, getRiskLabel } from '../utils/risk';

interface ShipDetailModalProps {
  ship: Ship | null;
  onClose: () => void;
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

const formatUtcSeconds = (seconds?: number) => {
  if (!seconds || Number.isNaN(seconds)) return '-';
  const date = new Date(seconds * 1000);
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
};

const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col gap-1 border-b border-slate-800 pb-2 text-xs sm:text-sm md:flex-row md:justify-between">
    <span className="text-slate-400">{label}</span>
    <span className="text-white font-medium md:text-right">{value}</span>
  </div>
);

export const ShipDetailModal: React.FC<ShipDetailModalProps> = ({ ship, onClose }) => {
  if (!ship) return null;
  const rawDraught =
    typeof ship.draught === 'number'
      ? ship.draught
      : typeof ship.draught === 'string'
        ? Number(ship.draught)
        : undefined;
  const hasDraught = typeof rawDraught === 'number' && Number.isFinite(rawDraught);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center px-4 py-6 md:py-8 bg-slate-900/70 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl h-[90vh] md:h-auto bg-slate-950 border border-slate-800 rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950">
          <div className="md:hidden flex flex-col gap-3">
            <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-700/80" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Vessel</p>
                <p className="text-xl font-semibold text-white mt-1 leading-tight break-words">
                  {ship.name}
                </p>
                {ship.cnName && <p className="text-xs text-slate-400 mt-1">{ship.cnName}</p>}
              </div>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-[11px] font-medium text-white/80 border border-white/15 rounded-full"
              >
                关闭
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/15 text-slate-200">
                {ship.type}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getRiskBadgeClass(
                  ship.riskLevel
                )}`}
              >
                {getRiskLabel(ship.riskLevel)}
              </span>
            </div>
            {ship.riskReason && (
              <p className="text-[11px] text-slate-400">风险提示：{ship.riskReason}</p>
            )}
          </div>
          <div className="hidden md:flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-slate-400">Vessel Detail</p>
              <p className="text-lg sm:text-2xl font-semibold text-white mt-1 flex flex-wrap items-center gap-2">
                <span className="truncate">{ship.name}</span>
                <span className="text-[10px] sm:text-sm font-medium text-slate-300 px-2.5 py-0.5 rounded-full border border-white/15">
                  {ship.type}
                </span>
              </p>
              {ship.cnName && <p className="text-xs sm:text-sm text-slate-400 mt-1">{ship.cnName}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium ${getRiskBadgeClass(
                    ship.riskLevel
                  )}`}
                >
                  {getRiskLabel(ship.riskLevel)}
                </span>
                {ship.riskReason && <p className="text-[11px] sm:text-xs text-slate-300">原因：{ship.riskReason}</p>}
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-500 mt-1">
                风险提示基于规则引擎，供参考，不代表行政结论。
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] sm:text-sm font-medium text-white/80 border border-white/20 rounded-full hover:text-white hover:border-white/40 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
        <div className="p-4 sm:p-6 space-y-5 text-xs sm:text-sm text-slate-200 overflow-y-auto">
          <p className="hidden md:block text-xs text-slate-500">
            以下字段直接取自 Shipxy 接口原始数据，未做任何模拟。
          </p>
          <div className="md:hidden space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">基础信息</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">MMSI</p>
                  <p className="text-white font-semibold">{ship.mmsi}</p>
                </div>
                <div>
                  <p className="text-slate-400">船籍</p>
                  <p className="text-white font-semibold">{ship.flag || '-'}</p>
                </div>
                <div>
                  <p className="text-slate-400">目的地</p>
                  <p className="text-white font-semibold">{ship.dest || '南京港'}</p>
                </div>
                <div>
                  <p className="text-slate-400">上一港</p>
                  <p className="text-white font-semibold">{ship.lastPort || '-'}</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">尺寸与吃水</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">尺寸</p>
                  <p className="text-white font-semibold">
                    {ship.length && ship.width ? `${ship.length}×${ship.width}m` : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">载重</p>
                  <p className="text-white font-semibold">
                    {ship.dwt ? `${Number(ship.dwt).toLocaleString()} DWT` : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">吃水</p>
                  <p className="text-white font-semibold">{hasDraught ? `${rawDraught!.toFixed(1)} m` : '-'}</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">时间信息</p>
              <DetailRow
                label="最后更新时间"
                value={<span className="text-slate-300">{formatBeijingWithWeek(ship.lastTime)}</span>}
              />
              <DetailRow label="ETA" value={formatBeijingWithWeek(ship.eta.replace('T', ' '))} />
              <DetailRow label="ETA (UTC)" value={formatUtcSeconds(ship.etaUtc)} />
            </div>
          </div>
          <div className="hidden md:grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/50">
              <p className="text-xs text-slate-400">MMSI</p>
              <p className="text-base sm:text-lg font-semibold text-white">{ship.mmsi}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/50">
              <p className="text-xs text-slate-400">船籍</p>
              <p className="text-base sm:text-lg font-semibold text-white">{ship.flag || '-'}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/50">
              <p className="text-xs text-slate-400">目的地</p>
              <p className="text-base sm:text-lg font-semibold text-white">{ship.dest || '南京港'}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/50">
              <p className="text-xs text-slate-400">尺寸 / 载重</p>
              <p className="text-base sm:text-lg font-semibold text-white">
                {ship.length && ship.width ? `${ship.length} m × ${ship.width} m` : '-'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                载重 {ship.dwt ? `${Number(ship.dwt).toLocaleString()} DWT` : '-'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/50">
              <p className="text-xs text-slate-400">吃水</p>
              <p className="text-base sm:text-lg font-semibold text-white">
                {hasDraught ? `${rawDraught!.toFixed(1)} m` : '-'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 p-4 bg-slate-900/50">
              <p className="text-xs text-slate-400">上一港</p>
              <p className="text-base sm:text-lg font-semibold text-white">{ship.lastPort || '-'}</p>
            </div>
          </div>
          <div className="hidden md:grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-2xl border border-slate-800 p-4 bg-white/5">
              <p className="text-xs text-slate-400 mb-2">北京时间 (UTC+8)</p>
              <div className="space-y-2">
                <DetailRow
                  label="最后更新时间"
                  value={<span className="text-slate-400">{formatBeijingWithWeek(ship.lastTime)}</span>}
                />
                <DetailRow label="ETA" value={formatBeijingWithWeek(ship.eta.replace('T', ' '))} />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 p-4 bg-white/5">
              <p className="text-xs text-slate-400 mb-2">UTC</p>
              <div className="space-y-2">
                <DetailRow label="ETA (UTC)" value={formatUtcSeconds(ship.etaUtc)} />
                <DetailRow label="最后更新时间 (UTC)" value={formatUtcSeconds(ship.lastTimeUtc)} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
