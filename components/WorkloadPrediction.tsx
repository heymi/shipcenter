import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  Legend
} from 'recharts';
import { Ship, RiskLevel } from '../types';
import { Users, Briefcase, TrendingUp } from 'lucide-react';

interface WorkloadProps {
  ships: Ship[];
}

export const WorkloadPrediction: React.FC<WorkloadProps> = ({ ships }) => {
  // Generate 6h buckets for the next 3 days
  const generateTimeSlots = () => {
    const slots = [];
    const now = new Date();
    // Round down to nearest 6h
    const startHour = Math.floor(now.getHours() / 6) * 6;
    let current = new Date(now);
    current.setHours(startHour, 0, 0, 0);

    for (let i = 0; i < 12; i++) { // 12 slots * 6h = 72h
      const end = new Date(current);
      end.setHours(current.getHours() + 6);
      
      const label = `${current.getDate()}日 ${current.getHours()}:00`;
      
      // Count ships in this slot
      const shipsInSlot = ships.filter(s => {
        const eta = new Date(s.eta);
        return eta >= current && eta < end;
      });

      const normal = shipsInSlot.filter(s => s.riskLevel === RiskLevel.NORMAL).length;
      const risk = shipsInSlot.filter(s => s.riskLevel !== RiskLevel.NORMAL).length;

      // Estimate Staff: 1 for normal, 2 for risk (simplified heuristic)
      const estimatedStaff = normal * 1 + risk * 2;

      slots.push({
        time: label,
        normal,
        risk,
        total: normal + risk,
        estimatedStaff
      });

      current = end;
    }
    return slots;
  };

  const data = generateTimeSlots();
  const peakLoad = Math.max(...data.map(d => d.estimatedStaff));
  const totalUpcoming = ships.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">检查负荷预测</h2>
          <p className="text-slate-500 text-sm mt-1">
            基于到港船量与风险等级，预测未来72小时警力需求。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl p-6 text-white shadow-lg">
           <div className="flex items-start justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium mb-1">未来72小时总船次</p>
                <h3 className="text-3xl font-bold">{totalUpcoming}</h3>
              </div>
              <div className="bg-white/20 p-2 rounded-lg">
                <Briefcase className="w-6 h-6 text-white" />
              </div>
           </div>
           <div className="mt-4 text-sm text-blue-100 bg-white/10 inline-block px-2 py-1 rounded">
              包含 {ships.filter(s => s.riskLevel === RiskLevel.HIGH).length} 艘重点船
           </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
           <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-sm font-medium mb-1">预估最大人力缺口时段</p>
                <h3 className="text-xl font-bold text-slate-800">
                  {data.reduce((prev, curr) => prev.estimatedStaff > curr.estimatedStaff ? prev : curr).time}
                </h3>
              </div>
              <div className="bg-orange-100 p-2 rounded-lg">
                <Users className="w-6 h-6 text-orange-600" />
              </div>
           </div>
           <p className="mt-4 text-sm text-slate-600">
             需备勤警力: <span className="font-bold text-slate-900">{peakLoad}</span> 组
           </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
           <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-sm font-medium mb-1">负荷趋势</p>
                <h3 className="text-xl font-bold text-slate-800">上升</h3>
              </div>
              <div className="bg-emerald-100 p-2 rounded-lg">
                <TrendingUp className="w-6 h-6 text-emerald-600" />
              </div>
           </div>
           <p className="mt-4 text-sm text-slate-600">
             下个高峰将在 12小时 后到达
           </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-6">未来 72 小时负荷推演</h3>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
              <Tooltip 
                cursor={{ fill: '#f1f5f9' }}
                contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
              <Bar name="普通船舶" dataKey="normal" stackId="a" fill="#94a3b8" radius={[0, 0, 0, 0]} barSize={30} />
              <Bar name="风险船舶" dataKey="risk" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={30} />
              <ReferenceLine y={peakLoad} label="峰值警戒" stroke="red" strokeDasharray="3 3" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};