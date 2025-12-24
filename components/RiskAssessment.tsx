import React, { useMemo, useState } from 'react';
import { Ship, RiskLevel } from '../types';
import { AlertOctagon, AlertTriangle, ShieldCheck, Search, Filter, Map, History, X } from 'lucide-react';
import { formatPortWithCountry } from '../utils/port';
import { ShipDetailModal } from './ShipDetailModal';

interface RiskAssessmentProps {
  ships: Ship[];
}

export const RiskAssessment: React.FC<RiskAssessmentProps> = ({ ships }) => {
  const [activeShip, setActiveShip] = useState<Ship | null>(null);
  const [panelMode, setPanelMode] = useState<'track' | 'detail' | null>(null);

  // Sort ships by risk level (High -> Attention -> Normal) and then by ETA
  const sortedShips = [...ships].sort((a, b) => {
    const riskScore = {
      [RiskLevel.HIGH]: 3,
      [RiskLevel.ATTENTION]: 2,
      [RiskLevel.NORMAL]: 1,
    };
    if (riskScore[b.riskLevel] !== riskScore[a.riskLevel]) {
      return riskScore[b.riskLevel] - riskScore[a.riskLevel];
    }
    return new Date(a.eta).getTime() - new Date(b.eta).getTime();
  });

  const getRiskBadge = (level: RiskLevel) => {
    switch (level) {
      case RiskLevel.HIGH:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
            <AlertOctagon size={12} /> 重点
          </span>
        );
      case RiskLevel.ATTENTION:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
            <AlertTriangle size={12} /> 提醒
          </span>
        );
      case RiskLevel.NORMAL:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
            <ShieldCheck size={12} /> 普通
          </span>
        );
    }
  };

  const openPanel = (ship: Ship, mode: 'track' | 'detail') => {
    setActiveShip(ship);
    setPanelMode(mode);
  };

  const closePanel = () => {
    setActiveShip(null);
    setPanelMode(null);
  };

  const trackTimeline = useMemo(() => {
    if (!activeShip || panelMode !== 'track') return [];
    const eta = new Date(activeShip.eta);
    const checkpoints = [-48, -24, -6, 0]; // hours relative to ETA
    return checkpoints.map((offset, idx) => {
      const ts = new Date(eta.getTime() + offset * 60 * 60 * 1000);
      const labelMap = ['出发港离港', '途中检查', '锚地等待', '预计靠泊'];
      const statusMap = ['离港确认', 'AIS 正常', '待引航', '入港排队'];
      return {
        label: labelMap[idx] || `节点 ${idx + 1}`,
        status: statusMap[idx] || '监控中',
        time: ts,
        port: idx === 0 ? formatPortWithCountry(activeShip.lastPort) : '长江航道',
      };
    });
  }, [activeShip, panelMode]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">预抵船舶风险分层</h2>
          <p className="text-slate-500 text-sm mt-1">
            系统自动识别高风险船舶，辅助边检资源前置。
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 h-4 w-4" />
            <input 
              type="text" 
              placeholder="搜索船名/MMSI" 
              className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            />
          </div>
          <button className="flex items-center px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-700 text-sm hover:bg-slate-50">
            <Filter className="h-4 w-4 mr-2" />
            筛选
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold tracking-wider">
              <th className="px-6 py-4">风险等级</th>
              <th className="px-6 py-4">船名 / MMSI</th>
              <th className="px-6 py-4">船籍 / 类型</th>
              <th className="px-6 py-4">预抵时间 (ETA)</th>
              <th className="px-6 py-4">风险提示 / 备注</th>
              <th className="px-6 py-4 text-right">数据操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedShips.map((ship) => (
              <tr key={ship.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-6 py-4">
                  {getRiskBadge(ship.riskLevel)}
                </td>
                <td className="px-6 py-4">
                  <div className="font-medium text-slate-900">{ship.name}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    MMSI {ship.mmsi} · IMO {ship.imo || '-'}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-slate-900">{ship.flag}</div>
                  <div className="text-xs text-slate-500">{ship.type}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-slate-900">
                    {new Date(ship.eta).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(ship.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </td>
                <td className="px-6 py-4 max-w-xs">
                  {ship.riskReason ? (
                    <p className="text-sm text-slate-700">{ship.riskReason}</p>
                  ) : (
                    <span className="text-slate-400 text-sm">-</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => openPanel(ship, 'track')}
                      className="text-xs flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 rounded border border-amber-200 hover:bg-amber-100 transition-colors" 
                      title="调用历史轨迹API分析异常停靠"
                    >
                      <History size={12} />
                      轨迹溯源
                    </button>
                    <button 
                      onClick={() => openPanel(ship, 'detail')}
                      className="text-xs text-blue-600 font-medium hover:text-blue-800"
                    >
                      详情
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedShips.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            暂无符合条件的船舶
          </div>
        )}
      </div>

      {activeShip && panelMode === 'track' && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl border border-slate-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">风险操作中心</p>
                <h4 className="text-lg font-semibold text-slate-800">
                  {panelMode === 'track' ? '轨迹溯源' : '船舶详情'}
                </h4>
              </div>
              <button 
                onClick={closePanel}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-6 space-y-5">
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-sm">
                <p className="text-slate-500">正在查看</p>
                <p className="text-lg font-semibold text-slate-800">{activeShip.name}</p>
                <p className="text-xs text-slate-500 font-mono mt-1">MMSI {activeShip.mmsi}</p>
              </div>

              {panelMode === 'track' && (
                <div>
                  <h5 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-2">
                    <Map className="w-4 h-4 text-amber-500" />
                    航迹节点
                  </h5>
                  <ol className="relative border-l border-slate-200 pl-5 space-y-4">
                    {trackTimeline.map((node, idx) => (
                      <li key={idx} className="ml-2">
                        <div className="absolute -left-[10px] mt-1 w-3 h-3 rounded-full bg-amber-500 border-2 border-white shadow" />
                        <p className="text-xs text-slate-500 uppercase tracking-wide">
                          {node.label}
                        </p>
                        <p className="text-sm font-semibold text-slate-800">{node.port}</p>
                        <p className="text-xs text-slate-500">{node.time.toLocaleString()}</p>
                        <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-100">
                          {node.status}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button 
                onClick={closePanel}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      {activeShip && panelMode === 'detail' && (
        <ShipDetailModal ship={activeShip} onClose={closePanel} />
      )}
    </div>
  );
};
