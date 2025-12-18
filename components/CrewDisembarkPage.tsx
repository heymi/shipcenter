import React, { useEffect, useMemo, useState } from 'react';
import { Car, RefreshCcw, MapPin } from 'lucide-react';

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
  passengers: { nameEn: string; ship: string }[];
  status: '返程中' | '休息中' | '游玩中';
}

interface HoveredState {
  vehicle: Vehicle;
  x: number;
  y: number;
}

type TimeRange = 'today' | 'week' | 'month' | 'halfyear' | 'year';
type PermitStatus = '待审核' | '已通过' | '已拒绝' | '已完成';

interface LandingStats {
  permits: number;
  passRate: number;
  crewCount: number;
  spendUsd: number;
  avgHours: number;
}

interface PermitItem {
  id: string;
  ship: string;
  depart: string;
  returnTime: string;
  driver: string;
  status: PermitStatus;
  crews: { name: string; crewNo: string; passport: string; nationality: string }[];
}

const BASE_VEHICLES: Vehicle[] = [
  {
    id: 'V-001',
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
    passengers: [
      { nameEn: 'Alex Chen', ship: 'GREAT KAPPA' },
      { nameEn: 'Michael Lee', ship: 'COS LUCKY' },
      { nameEn: 'Sara Wong', ship: 'RED SAKURA' },
    ],
    status: '返程中',
  },
  {
    id: 'V-002',
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
    passengers: [
      { nameEn: 'John Smith', ship: 'COS LUCKY' },
      { nameEn: 'David Zhao', ship: 'GREAT KAPPA' },
    ],
    status: '游玩中',
  },
  {
    id: 'V-003',
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
    passengers: [
      { nameEn: 'Peter Wang', ship: 'RED SAKURA' },
      { nameEn: 'Eric Wu', ship: 'RED SAKURA' },
      { nameEn: 'Jason Lin', ship: 'RED SAKURA' },
      { nameEn: 'Ryan Gu', ship: 'COS LUCKY' },
      { nameEn: 'Leo Sun', ship: 'GREAT KAPPA' },
    ],
    status: '休息中',
  },
];

const randomJitter = (value: number, delta = 0.01) => {
  const change = (Math.random() - 0.5) * delta;
  return value + change;
};

export const CrewDisembarkPage: React.FC = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>(BASE_VEHICLES);
  const [lastRefresh, setLastRefresh] = useState<string>(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredVehicle, setHoveredVehicle] = useState<HoveredState | null>(null);
  const [viewMode, setViewMode] = useState<'overview' | 'tracking'>('overview');
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const [statusFilter, setStatusFilter] = useState<PermitStatus | 'all'>('all');
  const [permitList, setPermitList] = useState<PermitItem[]>([
    {
      id: 'P-202501',
      ship: 'GREAT KAPPA',
      depart: '12-18 10:30',
      returnTime: '12-18 18:00',
      driver: '张师傅',
      status: '待审核',
      crews: [
        { name: 'Alex Chen', crewNo: 'C12880', passport: 'E12345678', nationality: '新加坡' },
        { name: 'Michael Lee', crewNo: 'C12890', passport: 'E12778822', nationality: '菲律宾' },
        { name: 'Daniel Park', crewNo: 'C12895', passport: 'M8822113', nationality: '韩国' },
      ],
    },
    {
      id: 'P-202502',
      ship: 'COS LUCKY',
      depart: '12-18 11:10',
      returnTime: '12-18 17:40',
      driver: '王师傅',
      status: '已通过',
      crews: [
        { name: 'John Smith', crewNo: 'C12911', passport: 'K99812344', nationality: '英国' },
        { name: 'Mateo Garcia', crewNo: 'C12918', passport: 'P11884466', nationality: '西班牙' },
        { name: 'Ivan Petrov', crewNo: 'C12922', passport: 'R77123456', nationality: '俄罗斯' },
        { name: 'Kenji Sato', crewNo: 'C12925', passport: 'J55661234', nationality: '日本' },
        { name: 'Oliver Brown', crewNo: 'C12927', passport: 'G88774412', nationality: '澳大利亚' },
      ],
    },
    {
      id: 'P-202503',
      ship: 'RED SAKURA',
      depart: '12-18 12:20',
      returnTime: '12-18 19:00',
      driver: '刘师傅',
      status: '已完成',
      crews: [
        { name: 'Sara Wong', crewNo: 'C12882', passport: 'E33445566', nationality: '马来西亚' },
        { name: 'Eric Wu', crewNo: 'C12883', passport: 'E77889966', nationality: '马来西亚' },
        { name: 'Peter Wang', crewNo: 'C12884', passport: 'E22334455', nationality: '新加坡' },
        { name: 'Lucas Meyer', crewNo: 'C12885', passport: 'D77889911', nationality: '德国' },
        { name: 'Jasper Nielsen', crewNo: 'C12886', passport: 'DK1122334', nationality: '丹麦' },
      ],
    },
  ]);
  const [activePermit, setActivePermit] = useState<PermitItem | null>(null);

  useEffect(() => {
    const tick = () => {
      setVehicles((prev) =>
        prev.map((v) => ({
          ...v,
          lat: randomJitter(v.lat, 0.005),
          lng: randomJitter(v.lng, 0.005),
        }))
      );
      setLastRefresh(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    };
    tick();
    const timer = setInterval(tick, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Map area uses static image background; no external map libs needed

  const bounds = useMemo(() => {
    const latitudes = vehicles.map((v) => v.lat);
    const longitudes = vehicles.map((v) => v.lng);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    return { minLat, maxLat, minLng, maxLng };
  }, [vehicles]);

  const project = (lat: number, lng: number) => {
    const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 1)) * 100;
    const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat || 1)) * 100;
    return { x, y };
  };

  const getPosByIndex = (idx: number, v: Vehicle) => {
    let pos = project(v.lat, v.lng);
    // 16 宫格（4x4），单元中心：col/row = 12.5%, 37.5%, 62.5%, 87.5%
    // 指定前三辆：1) 2行2列 2) 3行2列 3) 1行3列
    const centers = [21.5, 38.5, 60.5, 85.5];
    if (idx === 0) pos = { x: centers[2], y: centers[1] }; // row2 col2
    if (idx === 1) pos = { x: centers[2], y: centers[0] }; // row3 col2
    if (idx === 2) pos = { x: centers[2], y: centers[2] }; // row1 col3
    return pos;
  };

  useEffect(() => {
    if (!selectedId) return;
    const idx = vehicles.findIndex((v) => v.id === selectedId);
    if (idx === -1) return;
    const v = vehicles[idx];
    const pos = getPosByIndex(idx, v);
    setHoveredVehicle({ vehicle: v, x: pos.x, y: pos.y });
  }, [selectedId, vehicles]);

  const statsByRange: Record<TimeRange, LandingStats> = {
    today: { permits: 18, passRate: 0.92, crewCount: 46, spendUsd: 3800, avgHours: 5.4 },
    week: { permits: 96, passRate: 0.9, crewCount: 228, spendUsd: 18100, avgHours: 5.7 },
    month: { permits: 360, passRate: 0.91, crewCount: 880, spendUsd: 69400, avgHours: 5.6 },
    halfyear: { permits: 1880, passRate: 0.89, crewCount: 4520, spendUsd: 351000, avgHours: 5.8 },
    year: { permits: 3680, passRate: 0.9, crewCount: 8940, spendUsd: 699000, avgHours: 5.7 },
  };
  const currentStats = statsByRange[timeRange];

  const updatePermitStatus = (id: string, status: PermitItem['status']) => {
    setPermitList((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (status === '已完成' && p.status !== '已通过') {
          return p;
        }
        return { ...p, status };
      })
    );
    setActivePermit((prev) => {
      if (!prev || prev.id !== id) return prev;
      if (status === '已完成' && prev.status !== '已通过') return prev;
      return { ...prev, status };
    });
  };

  const handleShipClick = (shipName: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-ship-detail', { detail: { shipName } }));
    }
  };

  const shipFlag = (name: string) => {
    const map: Record<string, string> = {
      'GREAT KAPPA': '🇸🇬',
      'COS LUCKY': '🇵🇦',
      'RED SAKURA': '🇯🇵',
    };
    return map[name] || '🚩';
  };

  const autoDecision = (p: PermitItem) => {
    const riskyNation = p.crews.some((c) => ['俄罗斯'].includes(c.nationality));
    if (p.status === '已拒绝') return '建议拒绝';
    if (p.status === '已完成') return '已闭环';
    if (riskyNation) return '需复核';
    return '可放行';
  };

  const filteredPermits = useMemo(
    () => (statusFilter === 'all' ? permitList : permitList.filter((p) => p.status === statusFilter)),
    [permitList, statusFilter]
  );

  const overviewContent = (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">船员下船管理</h1>
          <p className="text-sm text-slate-400">证件发放 · 车辆调度 · 订单审批</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>更新于 {lastRefresh}</span>
          <button
            onClick={() => setVehicles((prev) => [...prev])}
            className="p-1.5 rounded-full border border-slate-700 text-slate-300 hover:border-emerald-400 hover:text-white"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {[
          { id: 'today', label: '当日' },
          { id: 'week', label: '一周' },
          { id: 'month', label: '一月' },
          { id: 'halfyear', label: '半年' },
          { id: 'year', label: '一年' },
        ].map((opt) => (
          <button
            key={opt.id}
            onClick={() => setTimeRange(opt.id as TimeRange)}
            className={`px-3 py-1 rounded-full border transition ${
              timeRange === opt.id ? 'border-emerald-400 text-emerald-100 bg-emerald-500/10' : 'border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
          <p className="text-xs text-slate-400">登陆证发放</p>
          <p className="text-2xl font-semibold text-white mt-1">{currentStats.permits}</p>
          <p className="text-xs text-emerald-200 mt-1">通过率 {(currentStats.passRate * 100).toFixed(1)}%</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
          <p className="text-xs text-slate-400">下船人数</p>
          <p className="text-2xl font-semibold text-white mt-1">{currentStats.crewCount}</p>
          <p className="text-xs text-slate-500 mt-1">已完成安排行程</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
          <p className="text-xs text-slate-400">消费金额 (USD)</p>
          <p className="text-2xl font-semibold text-white mt-1">{currentStats.spendUsd.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-1">含餐饮/交通/景点</p>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
          <p className="text-xs text-slate-400">平均上岸时长 (小时)</p>
          <p className="text-2xl font-semibold text-white mt-1">{currentStats.avgHours.toFixed(1)}</p>
          <p className="text-xs text-slate-500 mt-1">签发至返回</p>
        </div>
      </div>

      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white font-semibold">在途车辆</h3>
            <p className="text-xs text-slate-400">点击进入调度与位置跟踪</p>
          </div>
          <button
            onClick={() => setViewMode('tracking')}
            className="px-3 py-1.5 rounded-full border border-emerald-400 text-emerald-100 hover:bg-emerald-500/10 text-sm"
          >
            跟踪管理
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {vehicles.map((v) => (
            <div key={v.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-200">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-white">{v.model}</div>
                <span className="px-2 py-0.5 rounded-full border border-emerald-400/50 text-emerald-100 text-xs">{v.plate}</span>
              </div>
              <p className="text-xs text-slate-400">出发 {v.departTime} · 返回 {v.returnTime}</p>
              <p className="text-xs text-slate-400">司机 {v.driver} · {v.driverPhone}</p>
              <p className="text-xs text-slate-400">翻译 {v.translator} · {v.translatorPhone}</p>
              <p className="text-xs text-slate-500">乘客 {v.passengers.length} 人 · 状态 {v.status}</p>
              <p className="text-[11px] text-emerald-200">已核对乘车人 {v.passengers.length}/{v.passengers.length}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white font-semibold">登陆证申请</h3>
            <p className="text-xs text-slate-400">每个订单含多名船员，审核基于身份与国家</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PermitStatus | 'all')}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200"
            >
              <option value="all">全部状态</option>
              <option value="待审核">待审核</option>
              <option value="已通过">已通过</option>
              <option value="已拒绝">已拒绝</option>
              <option value="已完成">已完成</option>
            </select>
            <button
              onClick={() => alert('演示环境：批量通过将上线后启用')}
              className="px-2 py-1 rounded border border-emerald-500/60 text-emerald-100 hover:bg-emerald-500/10"
            >
              批量通过
            </button>
            <button
              onClick={() => alert('演示环境：批量制作将上线后启用')}
              className="px-2 py-1 rounded border border-blue-500/60 text-blue-100 hover:bg-blue-500/10"
            >
              批量制作
            </button>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm text-slate-200">
            <thead className="text-xs text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2 text-left">订单号</th>
                <th className="py-2 text-left">船员</th>
                <th className="py-2 text-left">船名</th>
                <th className="py-2 text-left">出发/返回</th>
                <th className="py-2 text-left">状态</th>
                <th className="py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredPermits.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-slate-800/40 cursor-pointer"
                  onClick={() => setActivePermit(p)}
                >
                  <td className="py-2">{p.id}</td>
                  <td className="py-2">
                    <div className="font-semibold">共 {p.crews.length} 人</div>
                    <div className="text-xs text-slate-500">
                      {p.crews
                        .slice(0, 3)
                        .map((c) => `${c.name}(${c.nationality})`)
                        .join('，')}
                      {p.crews.length > 3 && '...'}
                    </div>
                  </td>
                  <td className="py-2">
                    <button
                      className="text-emerald-200 hover:text-emerald-100 underline underline-offset-4"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShipClick(p.ship);
                      }}
                    >
                      <span className="mr-2">{shipFlag(p.ship)}</span>
                      {p.ship}
                    </button>
                    <div className="text-[11px] text-slate-500 mt-1">
                      判定：{autoDecision(p)}
                    </div>
                  </td>
                  <td className="py-2 text-xs text-slate-300">{p.depart} / {p.returnTime}</td>
                  <td className="py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs border ${
                        p.status === '待审核'
                          ? 'border-amber-400/60 text-amber-100'
                          : p.status === '已通过'
                          ? 'border-emerald-400/60 text-emerald-100'
                          : p.status === '已完成'
                          ? 'border-blue-400/60 text-blue-100'
                          : 'border-rose-400/60 text-rose-100'
                      }`}
                    >
                      {p.status}
                    </span>
                    {p.status !== '已完成' && (
                      <div className="text-[11px] text-amber-200 mt-1">未制作 · 45 分钟</div>
                    )}
                  </td>
                  <td className="py-2 space-x-2 text-xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updatePermitStatus(p.id, '已通过');
                      }}
                      className="px-2 py-1 rounded border border-emerald-500/60 text-emerald-100 hover:bg-emerald-500/10"
                    >
                      通过
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updatePermitStatus(p.id, '已拒绝');
                      }}
                      className="px-2 py-1 rounded border border-rose-500/60 text-rose-100 hover:bg-rose-500/10"
                    >
                      拒绝
                    </button>
                    <button
                      disabled={p.status !== '已通过'}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (p.status !== '已通过') return;
                        updatePermitStatus(p.id, '已完成');
                      }}
                      className={`px-2 py-1 rounded border border-blue-500/60 text-blue-100 hover:bg-blue-500/10 ${
                        p.status !== '已通过' ? 'opacity-40 cursor-not-allowed hover:bg-transparent' : ''
                      }`}
                    >
                      制作完成
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const trackingContent = (
    <div className="flex gap-4 h-full">
      <div className="w-full lg:w-[30%] space-y-3 overflow-auto pr-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <button
                onClick={() => setViewMode('overview')}
                className="px-2 py-0.5 rounded border border-slate-700 hover:border-emerald-400 hover:text-emerald-100 text-slate-300"
              >
                返回
              </button>
              <span className="text-slate-500">/</span>
              <span>跟踪管理</span>
            </div>
            <h1 className="text-2xl font-semibold text-white">船员下船管理</h1>
            <p className="text-sm text-slate-400">车辆调度与实时位置</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>更新于 {lastRefresh}</span>
            <button
              onClick={() => setVehicles((prev) => [...prev])}
              className="p-1.5 rounded-full border border-slate-700 text-slate-300 hover:border-emerald-400 hover:text-white"
            >
              <RefreshCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {vehicles.map((v) => {
            const selected = selectedId === v.id;
            const idx = vehicles.findIndex((it) => it.id === v.id);
            const pos = idx >= 0 ? getPosByIndex(idx, v) : { x: 0, y: 0 };
            return (
            <div
              key={v.id}
              onClick={() => {
                setSelectedId(v.id);
                if (idx >= 0) setHoveredVehicle({ vehicle: v, x: pos.x, y: pos.y });
              }}
              className={`rounded-xl border p-4 shadow-lg transition cursor-pointer ${
                selected
                  ? 'border-amber-400/70 bg-amber-500/10'
                  : 'border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-900/50 to-slate-900/30 hover:border-emerald-400/60'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Car className={`w-5 h-5 ${selected ? 'text-amber-300' : 'text-emerald-300'}`} />
                <p className="text-white font-semibold">{v.model}</p>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    selected
                      ? 'text-amber-200 bg-amber-500/10 border-amber-400/50'
                      : 'text-emerald-200 bg-emerald-500/10 border-emerald-400/40'
                  }`}
                >
                  {v.plate}
                </span>
              </div>
              <div className="text-sm text-slate-300 space-y-1">
                <p className="text-xs text-slate-400">出发 {v.departTime} · 计划返回 {v.returnTime}</p>
                <p className="text-xs text-slate-400">司机 {v.driver} · {v.driverPhone}</p>
                <p className="text-xs text-slate-400">翻译 {v.translator} · {v.translatorPhone}</p>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      <div className="hidden lg:block w-[70%] rounded-2xl border border-slate-800 bg-slate-900/70 relative overflow-hidden shadow-xl">
        <div className="absolute inset-0 bg-slate-900">
          <img
            src="/dist/assets/map-nanjing.png"
            alt="南京地图"
            className="w-full h-full object-cover opacity-90"
          />
        </div>
        <div className="absolute inset-0 flex items-start justify-between px-6 py-4 z-10 pointer-events-none">
          <div className="text-white font-semibold text-lg drop-shadow">南京市 · 车辆位置</div>
          <div className="text-xs text-slate-300 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-300" />
            实时刷新 1 分钟
          </div>
        </div>
        <div className="relative w-full h-full pt-12 z-10">
          {vehicles.map((v, idx) => {
            const { x, y } = getPosByIndex(idx, v);
            const selected = selectedId === v.id;
            const badgeClass = selected ? 'bg-amber-400/95 text-slate-900 border-amber-500' : 'bg-emerald-500/90 text-slate-900 border-emerald-400/60';
            const pulseColor = selected ? 'bg-amber-300' : 'bg-emerald-300';
            return (
              <div
                key={v.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                style={{ left: `${x}%`, top: `${y}%` }}
                onClick={() => {
                  setSelectedId(v.id);
                  setHoveredVehicle({ vehicle: v, x, y });
                }}
                onMouseEnter={() => setHoveredVehicle({ vehicle: v, x, y })}
                onMouseLeave={() => {
                  if (selectedId !== v.id) {
                    setHoveredVehicle(null);
                  }
                }}
              >
                <div className="flex flex-col items-center gap-1">
                  <div className={`px-2 py-1 rounded-full text-xs font-semibold shadow-lg border ${badgeClass}`}>
                    {v.plate}
                  </div>
                  <div className="relative">
                    <div className={`absolute inset-0 rounded-full ${pulseColor} blur-md opacity-60 animate-ping`} />
                    <div className={`w-3 h-3 rounded-full ${selected ? 'bg-amber-200 border-amber-500' : 'bg-emerald-200 border-emerald-400'} border shadow-lg animate-pulse`} />
                  </div>
                </div>
              </div>
            );
          })}
          {hoveredVehicle && (
            <div
              className="absolute max-w-sm rounded-xl border border-slate-700 bg-slate-900/90 text-slate-100 shadow-2xl p-4 space-y-2 z-20"
              style={{
                left: `${hoveredVehicle.x}%`,
                top: `${hoveredVehicle.y}%`,
                transform: 'translate(-50%, -110%)',
              }}
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold">{hoveredVehicle.vehicle.model} · {hoveredVehicle.vehicle.plate}</div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/40 text-emerald-100">
                  乘客 {Math.min(5, hoveredVehicle.vehicle.passengers.length)} 人
                </span>
              </div>
              <p className="text-sm text-slate-300">
                状态：<span className="text-emerald-200">{hoveredVehicle.vehicle.status}</span>
              </p>
              <div className="text-xs text-slate-400 space-y-1">
                <p>司机 {hoveredVehicle.vehicle.driver} · {hoveredVehicle.vehicle.driverPhone}</p>
                <p>翻译 {hoveredVehicle.vehicle.translator} · {hoveredVehicle.vehicle.translatorPhone}</p>
              </div>
              <div className="space-y-2 text-sm text-slate-200">
                <div className="text-xs text-slate-400">
                  船舶：<span className="text-emerald-100 font-medium">{hoveredVehicle.vehicle.passengers[0]?.ship || '未知'}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {hoveredVehicle.vehicle.passengers.slice(0, 5).map((p, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[11px]"
                    >
                      {p.nameEn}
                    </span>
                  ))}
                </div>
              </div>
              {hoveredVehicle.vehicle.passengers.length > 5 && (
                <p className="text-xs text-slate-500">最多展示 5 人，已省略其余乘客</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const permitModal = activePermit && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4 relative">
        <button
          onClick={() => setActivePermit(null)}
          className="absolute top-3 right-3 px-2 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
        >
          关闭
        </button>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">登陆证订单</p>
            <h2 className="text-xl text-white font-semibold mt-1">{activePermit.id}</h2>
            <p className="text-sm text-slate-400 mt-1">
              船舶{' '}
              <button
                onClick={() => handleShipClick(activePermit.ship)}
                className="text-emerald-200 underline underline-offset-4 hover:text-emerald-100"
              >
                <span className="mr-2">{shipFlag(activePermit.ship)}</span>
                {activePermit.ship}
              </button>
              {' '}· 出发 {activePermit.depart} · 返回 {activePermit.returnTime}
            </p>
            <p className="text-xs text-emerald-200 mt-2">判定：{autoDecision(activePermit)} · 闭环追踪已启用（演示）</p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs border ${
              activePermit.status === '待审核'
                ? 'border-amber-400/60 text-amber-100'
                : activePermit.status === '已通过'
                ? 'border-emerald-400/60 text-emerald-100'
                : activePermit.status === '已完成'
                ? 'border-blue-400/60 text-blue-100'
                : 'border-rose-400/60 text-rose-100'
            }`}
          >
            {activePermit.status}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-200">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
              <span className="px-2 py-1 rounded-full border border-slate-700 text-slate-200">流程</span>
              <span>提交 → 审核 → 制作 → 发放 → 返回</span>
            </div>
            <div className="flex gap-2 text-xs">
              {['提交', '审核', '制作', '发放', '返回'].map((step, idx) => {
                const done =
                  activePermit.status === '已完成' ||
                  (activePermit.status === '已通过' && idx <= 2) ||
                  (activePermit.status === '待审核' && idx === 0) ||
                  (activePermit.status === '已拒绝' && idx <= 1);
                return (
                  <div
                    key={step}
                    className={`flex-1 rounded-lg border px-2 py-1 text-center ${
                      done ? 'border-emerald-500/50 text-emerald-100 bg-emerald-500/5' : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    {step}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-2">船员列表（审核依据：身份与国籍）</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activePermit.crews.map((c) => (
              <div key={c.crewNo} className="p-3 rounded-lg border border-slate-800 bg-slate-900/60 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-white">{c.name}</div>
                  <span className="text-xs px-2 py-0.5 rounded-full border border-slate-700 text-slate-200">
                    {c.nationality}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">船员号 {c.crewNo}</p>
                <p className="text-xs text-slate-400">护照 {c.passport}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">操作记录（演示）</p>
            <button
              onClick={() => alert('演示环境：@ 港方/代理 通知入口')}
              className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-200 hover:border-emerald-400 hover:text-emerald-100"
            >
              @ 通知港方/代理
            </button>
          </div>
          <div className="space-y-1 text-xs text-slate-300">
            <div>12-18 10:30 · 系统 · 订单提交</div>
            <div>12-18 10:42 · 值班员 · 审核通过</div>
            <div>12-18 11:05 · 制证岗 · 制证完成</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => updatePermitStatus(activePermit.id, '已通过')}
            className="px-3 py-2 rounded-lg border border-emerald-500/60 text-emerald-100 hover:bg-emerald-500/10 text-sm"
          >
            审核通过
          </button>
          <button
            onClick={() => updatePermitStatus(activePermit.id, '已拒绝')}
            className="px-3 py-2 rounded-lg border border-rose-500/60 text-rose-100 hover:bg-rose-500/10 text-sm"
          >
            拒绝并退回
          </button>
          <button
            disabled={activePermit.status !== '已通过'}
            onClick={() => {
              if (activePermit.status !== '已通过') return;
              updatePermitStatus(activePermit.id, '已完成');
            }}
            className={`px-3 py-2 rounded-lg border border-blue-500/60 text-blue-100 hover:bg-blue-500/10 text-sm ${
              activePermit.status !== '已通过' ? 'opacity-40 cursor-not-allowed hover:bg-transparent' : ''
            }`}
          >
            制作完成
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {viewMode === 'overview' ? overviewContent : trackingContent}
      {permitModal}
    </>
  );
};

export default CrewDisembarkPage;
