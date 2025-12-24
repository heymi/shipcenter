import React, { useState } from 'react';
import { Ship, DocStatus, RiskLevel } from '../types';
import { formatPortWithCountry } from '../utils/port';
import { FileText, CheckCircle2, Clock, AlertCircle, ChevronRight, FileCheck } from 'lucide-react';

interface PreCheckProps {
  ships: Ship[];
  onUpdateShips: (ships: Ship[]) => void;
}

export const PreCheckPool: React.FC<PreCheckProps> = ({ ships, onUpdateShips }) => {
  const [filter, setFilter] = useState<'ALL' | DocStatus>('ALL');

  const filteredShips = ships.filter(s => filter === 'ALL' || s.docStatus === filter);

  const updateStatus = (id: string, newStatus: DocStatus) => {
    const updated = ships.map(s => s.id === id ? { ...s, docStatus: newStatus } : s);
    onUpdateShips(updated);
  };

  const getStatusIcon = (status: DocStatus) => {
    switch (status) {
      case DocStatus.APPROVED: return <CheckCircle2 className="text-emerald-500 h-5 w-5" />;
      case DocStatus.REVIEWING: return <Clock className="text-blue-500 h-5 w-5" />;
      case DocStatus.MISSING_INFO: return <AlertCircle className="text-red-500 h-5 w-5" />;
      default: return <FileText className="text-slate-400 h-5 w-5" />;
    }
  };

  const getStatusLabel = (status: DocStatus) => {
     switch (status) {
      case DocStatus.APPROVED: return <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-xs font-medium">预审通过</span>;
      case DocStatus.REVIEWING: return <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-xs font-medium">审核中</span>;
      case DocStatus.MISSING_INFO: return <span className="text-red-700 bg-red-50 px-2 py-0.5 rounded text-xs font-medium">材料缺失</span>;
      default: return <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded text-xs font-medium">待提交</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">预抵材料预审池</h2>
          <p className="text-slate-500 text-sm mt-1">
            船未到，材料先审。支持到港快速通关。
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'ALL', label: '全部' },
            { id: DocStatus.PENDING, label: '待处理' },
            { id: DocStatus.REVIEWING, label: '审核中' },
            { id: DocStatus.MISSING_INFO, label: '补材中' },
            { id: DocStatus.APPROVED, label: '已通过' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id as any)}
              className={`
                whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                ${filter === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}
              `}
            >
              {tab.label}
              <span className={`ml-2 py-0.5 px-2 rounded-full text-xs ${filter === tab.id ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                {tab.id === 'ALL' 
                  ? ships.length 
                  : ships.filter(s => s.docStatus === tab.id).length}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* List */}
      <div className="space-y-4">
        {filteredShips.map((ship) => (
          <div key={ship.id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row items-start md:items-center gap-4">
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="text-base font-semibold text-slate-900 truncate">{ship.name}</h3>
                {getStatusLabel(ship.docStatus)}
                {ship.riskLevel === RiskLevel.HIGH && (
                <span className="text-[10px] bg-red-100 text-red-700 px-1.5 rounded border border-red-200">重点预警</span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
                 <span>出发港: {formatPortWithCountry(ship.lastPort)}</span>
                 <span>代理: {ship.agent}</span>
                 <span>ETA: {new Date(ship.eta).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 w-full md:w-auto border-t md:border-t-0 pt-4 md:pt-0">
              {/* Actions based on status */}
              {ship.docStatus === DocStatus.PENDING && (
                <button 
                  onClick={() => updateStatus(ship.id, DocStatus.REVIEWING)}
                  className="flex-1 md:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  开始审核
                </button>
              )}
              
              {ship.docStatus === DocStatus.REVIEWING && (
                <>
                  <button 
                    onClick={() => updateStatus(ship.id, DocStatus.MISSING_INFO)}
                    className="flex-1 md:flex-none px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors"
                  >
                    驳回补材
                  </button>
                  <button 
                    onClick={() => updateStatus(ship.id, DocStatus.APPROVED)}
                    className="flex-1 md:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center"
                  >
                    <FileCheck className="w-4 h-4 mr-1.5" />
                    通过
                  </button>
                </>
              )}
              
              {ship.docStatus === DocStatus.MISSING_INFO && (
                <button 
                  onClick={() => updateStatus(ship.id, DocStatus.REVIEWING)}
                  className="flex-1 md:flex-none px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  重审材料
                </button>
              )}

              {ship.docStatus === DocStatus.APPROVED && (
                <div className="px-4 py-2 text-emerald-600 text-sm font-medium flex items-center">
                   <CheckCircle2 className="w-5 h-5 mr-2" />
                   已完成
                </div>
              )}

              <button className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        ))}
        {filteredShips.length === 0 && (
          <div className="text-center py-12 text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-300">
            暂无任务
          </div>
        )}
      </div>
    </div>
  );
};
