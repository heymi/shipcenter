import React, { useMemo, useState } from 'react';
import { Car, MapPin, Activity, ClipboardList } from 'lucide-react';
import { Ship } from '../types';
import { isMainlandFlag } from '../utils/ship';
import { getRiskBadgeClass, getRiskLabel } from '../utils/risk';
import { formatSmartWeekdayLabel } from '../utils/date';

interface CrewLifecyclePageProps {
  ships: Ship[];
  allShips: Ship[];
}

interface Vehicle {
  id: string;
  model: string;
  plate: string;
  driver: string;
  driverPhone: string;
  translator: string;
  translatorPhone: string;
  departTime: string;
  returnTime: string;
  lat: number;
  lng: number;
  status: '返程中' | '休息中' | '游玩中';
  ship: string;
}

interface PermitItem {
  id: string;
  ship: string;
  status: '待审核' | '已通过' | '已拒绝' | '已完成';
  crewCount: number;
  depart: string;
  returnTime: string;
}

const BASE_VEHICLES: Vehicle[] = [
  {
    id: 'V-101',
    model: '丰田考斯特',
    plate: '苏A·9F218',
    driver: '张师傅',
    driverPhone: '13814237568',
    translator: '陈敏',
    translatorPhone: '13241896325',
    departTime: '09:45',
    returnTime: '15:20',
    lat: 32.06,
    lng: 118.78,
    status: '返程中',
    ship: 'GREAT KAPPA',
  },
  {
    id: 'V-102',
    model: '大众途安',
    plate: '苏A·6K732',
    driver: '王师傅',
    driverPhone: '13751469802',
    translator: '刘慧',
    translatorPhone: '13956728430',
    departTime: '10:30',
    returnTime: '17:00',
    lat: 32.04,
    lng: 118.75,
    status: '游玩中',
    ship: 'COS LUCKY',
  },
  {
    id: 'V-103',
    model: '别克GL8',
    plate: '苏A·3L589',
    driver: '刘师傅',
    driverPhone: '13585421076',
    translator: '周婷',
    translatorPhone: '13678120493',
    departTime: '14:10',
    returnTime: '21:30',
    lat: 32.08,
    lng: 118.82,
    status: '休息中',
    ship: 'RED SAKURA',
  },
];

const PERMITS: PermitItem[] = [
  {
    id: 'P-202501',
    ship: 'GREAT KAPPA',
    status: '待审核',
    crewCount: 3,
    depart: '12-18 10:30',
    returnTime: '12-18 18:00',
  },
  {
    id: 'P-202502',
    ship: 'COS LUCKY',
    status: '已通过',
    crewCount: 5,
    depart: '12-18 11:10',
    returnTime: '12-18 17:40',
  },
  {
    id: 'P-202503',
    ship: 'RED SAKURA',
    status: '已完成',
    crewCount: 5,
    depart: '12-18 12:20',
    returnTime: '12-18 19:00',
  },
];

const parseEta = (eta?: string | null) => {
  if (!eta) return null;
  const normalized = eta.replace(/[（(].*?[）)]/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const candidate = normalized.includes('T') ? normalized : normalized.replace(' ', 'T');
  const attempts = [candidate, `${candidate}+08:00`, `${candidate}Z`];
  for (const value of attempts) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

export const CrewLifecyclePage: React.FC<CrewLifecyclePageProps> = ({ ships, allShips }) => {
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedPermitId, setSelectedPermitId] = useState<string | null>(null);
  const fleet = BASE_VEHICLES;

  const arrivalShips = useMemo(() => {
    const now = Date.now();
    const horizon = now + 24 * 60 * 60 * 1000;
    const base = allShips.length > 0 ? allShips : ships;
    return base
      .filter((ship) => !isMainlandFlag(ship.flag || ''))
      .filter((ship) => {
        const eta = parseEta(ship.eta);
        if (!eta) return false;
        return eta >= now && eta <= horizon;
      })
      .sort((a, b) => {
        const ta = parseEta(a.eta) ?? Number.MAX_SAFE_INTEGER;
        const tb = parseEta(b.eta) ?? Number.MAX_SAFE_INTEGER;
        return ta - tb;
      })
      .slice(0, 6);
  }, [ships, allShips]);

  const selectedShip = arrivalShips.find((ship) => ship.mmsi === selectedShipId) || null;
  const selectedVehicle = fleet.find((v) => v.id === selectedVehicleId) || null;
  const selectedPermit = PERMITS.find((p) => p.id === selectedPermitId) || null;

  const stats = useMemo(() => {
    const pendingPermits = PERMITS.filter((p) => p.status === '待审核').length;
    const inTransitVehicles = fleet.filter((v) => v.status !== '休息中').length;
    const crewTotal = PERMITS.reduce((acc, p) => acc + p.crewCount, 0);
    return {
      arrivals: arrivalShips.length,
      pendingPermits,
      inTransitVehicles,
      crewTotal,
    };
  }, [arrivalShips.length, fleet]);

  const getPosByIndex = (idx: number) => {
    const centers = [21.5, 38.5, 60.5, 85.5];
    if (idx === 0) return { x: centers[2], y: centers[1] };
    if (idx === 1) return { x: centers[2], y: centers[0] };
    if (idx === 2) return { x: centers[2], y: centers[2] };
    return { x: centers[0], y: centers[3] };
  };
  const getShipPosByIndex = (idx: number) => {
    const centers = [18, 36, 54, 72, 90];
    if (idx === 0) return { x: centers[3], y: centers[1] };
    if (idx === 1) return { x: centers[4], y: centers[2] };
    if (idx === 2) return { x: centers[2], y: centers[0] };
    if (idx === 3) return { x: centers[1], y: centers[3] };
    return { x: centers[0], y: centers[2] };
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">下船全景态势</h1>
          <p className="text-sm text-slate-400">进港 · 审核 · 调度 · 上岸 · 返港全流程监控</p>
        </div>
        <div className="text-xs text-slate-400">更新时间 {new Date().toLocaleTimeString('zh-CN', { hour12: false })}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
          <p className="text-xs text-slate-400">24 小时内进港</p>
          <p className="text-2xl font-semibold text-white mt-1">{stats.arrivals}</p>
          <p className="text-xs text-slate-500 mt-1">外籍船舶</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
          <p className="text-xs text-slate-400">待审核订单</p>
          <p className="text-2xl font-semibold text-white mt-1">{stats.pendingPermits}</p>
          <p className="text-xs text-amber-200 mt-1">需边检复核</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
          <p className="text-xs text-slate-400">在途车辆</p>
          <p className="text-2xl font-semibold text-white mt-1">{stats.inTransitVehicles}</p>
          <p className="text-xs text-emerald-200 mt-1">实时调度中</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
          <p className="text-xs text-slate-400">下船人员</p>
          <p className="text-2xl font-semibold text-white mt-1">{stats.crewTotal}</p>
          <p className="text-xs text-slate-500 mt-1">累计登记</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[28%_42%_30%] gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg flex flex-col">
          <div className="flex items-center gap-2 mb-3 text-sm text-slate-200">
            <Activity className="w-4 h-4 text-emerald-300" />
            进港动态
          </div>
          <div className="space-y-3 flex-1">
            {arrivalShips.map((ship, idx) => {
              const etaTs = parseEta(ship.eta);
              const etaLabel = etaTs
                ? new Date(etaTs).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '-';
              const weekLabel = formatSmartWeekdayLabel(ship.eta || '');
              return (
                <button
                  key={ship.mmsi}
                  onClick={() => setSelectedShipId(ship.mmsi)}
                  className={`w-full text-left rounded-xl border p-3 transition ${
                    selectedShipId === ship.mmsi
                      ? 'border-emerald-400/70 bg-emerald-500/10'
                      : 'border-slate-800 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-white font-semibold">
                      {ship.name}
                      {ship.cnName && <span className="text-xs text-slate-400 ml-2">{ship.cnName}</span>}
                    </div>
                    {idx === 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-400/60 text-amber-100">
                        最近进港
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                    <span>
                      ETA {etaLabel} {weekLabel && `(${weekLabel})`}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${getRiskBadgeClass(ship.riskLevel)}`}>
                      {getRiskLabel(ship.riskLevel)}
                    </span>
                  </div>
                </button>
              );
            })}
            {arrivalShips.length === 0 && (
              <div className="text-xs text-slate-500">暂无未来 24 小时内的外籍船舶</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg overflow-hidden relative">
          <div className="absolute inset-0 bg-slate-900">
            <img src="/dist/assets/map-nanjing.png" alt="南京地图" className="w-full h-full object-cover opacity-90" />
          </div>
          <div className="absolute inset-0 flex items-start justify-between px-5 py-4 z-10 pointer-events-none">
            <div className="text-white font-semibold text-lg drop-shadow">车辆 & 船舶当前位置</div>
            <div className="text-xs text-slate-300 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-300" />
              实时刷新 1 分钟
            </div>
          </div>
          <div className="relative w-full h-full pt-14 z-10">
            {arrivalShips.map((ship, idx) => {
              const pos = getShipPosByIndex(idx);
              const selected = selectedShipId === ship.mmsi;
              return (
                <button
                  key={`ship-${ship.mmsi}`}
                  onClick={() => setSelectedShipId(ship.mmsi)}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                >
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={`px-2 py-1 rounded-full text-[10px] font-semibold shadow-lg border ${
                        selected
                          ? 'bg-amber-400/95 text-slate-900 border-amber-500'
                          : 'bg-sky-400/90 text-slate-900 border-sky-300/70'
                      }`}
                    >
                      🚢 {ship.name}
                    </div>
                    <div className="w-2.5 h-2.5 rounded-full bg-sky-200 border border-sky-400 shadow-md" />
                  </div>
                </button>
              );
            })}
            {fleet.map((vehicle, idx) => {
              const pos = getPosByIndex(idx);
              const selected = selectedVehicleId === vehicle.id;
              return (
                <button
                  key={vehicle.id}
                  onClick={() => setSelectedVehicleId(vehicle.id)}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                >
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={`px-2 py-1 rounded-full text-xs font-semibold shadow-lg border ${
                        selected
                          ? 'bg-amber-400/95 text-slate-900 border-amber-500'
                          : 'bg-emerald-500/90 text-slate-900 border-emerald-400/60'
                      }`}
                    >
                      {vehicle.plate}
                    </div>
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-emerald-300 blur-md opacity-60 animate-ping" />
                      <div className="w-3 h-3 rounded-full bg-emerald-200 border border-emerald-400 shadow-lg animate-pulse" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg flex flex-col">
          <div className="flex items-center gap-2 mb-3 text-sm text-slate-200">
            <ClipboardList className="w-4 h-4 text-emerald-300" />
            下船订单与人员
          </div>
          <div className="space-y-3 flex-1">
            {PERMITS.map((permit) => (
              <button
                key={permit.id}
                onClick={() => setSelectedPermitId(permit.id)}
                className={`w-full text-left rounded-xl border p-3 transition ${
                  selectedPermitId === permit.id
                    ? 'border-emerald-400/70 bg-emerald-500/10'
                    : 'border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-white font-semibold">{permit.ship}</div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      permit.status === '待审核'
                        ? 'border-amber-400/60 text-amber-100'
                        : permit.status === '已通过'
                        ? 'border-emerald-400/60 text-emerald-100'
                        : permit.status === '已完成'
                        ? 'border-blue-400/60 text-blue-100'
                        : 'border-rose-400/60 text-rose-100'
                    }`}
                  >
                    {permit.status}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  订单 {permit.id} · 船员 {permit.crewCount} 人
                </div>
                <div className="text-xs text-slate-500">出发 {permit.depart} · 返回 {permit.returnTime}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg">
          <div className="flex items-center gap-2 text-sm text-slate-200 mb-2">
            <Activity className="w-4 h-4 text-emerald-300" />
            进港详情
          </div>
          {selectedShip ? (
            <div className="text-sm text-slate-300 space-y-1">
              <p className="text-white font-semibold">
                {selectedShip.name}
                {selectedShip.cnName && <span className="text-xs text-slate-400 ml-2">{selectedShip.cnName}</span>}
              </p>
              <p>船籍 {selectedShip.flag || '-'}</p>
              <p>ETA {selectedShip.eta?.replace('T', ' ') || '-'}</p>
              <p>上一港 {selectedShip.lastPort || '-'}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">点击左侧进港动态查看详情</p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg">
          <div className="flex items-center gap-2 text-sm text-slate-200 mb-2">
            <Car className="w-4 h-4 text-emerald-300" />
            车辆详情
          </div>
          {selectedVehicle ? (
            <div className="text-sm text-slate-300 space-y-1">
              <p className="text-white font-semibold">{selectedVehicle.model} · {selectedVehicle.plate}</p>
              <p>司机 {selectedVehicle.driver} · {selectedVehicle.driverPhone}</p>
              <p>翻译 {selectedVehicle.translator} · {selectedVehicle.translatorPhone}</p>
              <p>出发 {selectedVehicle.departTime} · 返回 {selectedVehicle.returnTime}</p>
              <p>所属船舶 {selectedVehicle.ship}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">点击地图车辆查看详情</p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg">
          <div className="flex items-center gap-2 text-sm text-slate-200 mb-2">
            <ClipboardList className="w-4 h-4 text-emerald-300" />
            订单详情
          </div>
          {selectedPermit ? (
            <div className="text-sm text-slate-300 space-y-1">
              <p className="text-white font-semibold">{selectedPermit.ship}</p>
              <p>订单 {selectedPermit.id}</p>
              <p>状态 {selectedPermit.status}</p>
              <p>船员 {selectedPermit.crewCount} 人</p>
              <p>出发 {selectedPermit.depart}</p>
              <p>返回 {selectedPermit.returnTime}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">点击右侧订单查看详情</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CrewLifecyclePage;
