import type { ComponentType } from 'react';
import {
  Activity,
  AlarmClock,
  AlertCircle,
  Globe,
  History,
  MapPin,
  Waves,
  AlertTriangle,
} from 'lucide-react';

export const EVENT_ICON_META: Record<
  string,
  { icon: ComponentType<{ className?: string }>; className: string; label: string }
> = {
  ETA_UPDATE: {
    icon: History,
    className: 'bg-blue-500/15 text-blue-200 border border-blue-500/30',
    label: 'ETA 更新',
  },
  ARRIVAL_SOON: {
    icon: AlarmClock,
    className: 'bg-amber-500/15 text-amber-200 border border-amber-500/30',
    label: '即将到港',
  },
  ARRIVAL_IMMINENT: {
    icon: AlarmClock,
    className: 'bg-red-500/15 text-red-200 border border-red-500/30',
    label: '2 小时内到港',
  },
  ARRIVAL_URGENT: {
    icon: AlarmClock,
    className: 'bg-rose-600/20 text-rose-100 border border-rose-500/40',
    label: '30 分钟内到港',
  },
  RISK_LEVEL_CHANGE: {
    icon: AlertTriangle,
    className: 'bg-rose-500/15 text-rose-200 border border-rose-500/30',
    label: '风险级别变更',
  },
  DRAUGHT_SPIKE: {
    icon: Waves,
    className: 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30',
    label: '吃水异常',
  },
  LAST_PORT_CHANGE: {
    icon: MapPin,
    className: 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/30',
    label: '上一港调整',
  },
  STALE_SIGNAL: {
    icon: AlertCircle,
    className: 'bg-slate-500/20 text-slate-100 border border-slate-400/30',
    label: '数据陈旧',
  },
  FOREIGN_REPORT: {
    icon: Globe,
    className: 'bg-blue-500/20 text-blue-100 border border-blue-500/30',
    label: '外籍上报',
  },
  DEFAULT: {
    icon: Activity,
    className: 'bg-slate-700/30 text-slate-200 border border-slate-600/40',
    label: '动态提醒',
  },
};
