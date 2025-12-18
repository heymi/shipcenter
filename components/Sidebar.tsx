import React from 'react';
import { Radar, Anchor, Database, Activity, Briefcase, Users, LayoutGrid } from 'lucide-react';

interface SidebarProps {
  currentView: string;
  setView: (view: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, setView }) => {
  const menuItems = [
    { id: 'dashboard', label: '港口雷达', icon: Radar },
    { id: 'workspace', label: '工作台', icon: Briefcase },
    { id: 'events', label: '实时动态', icon: Activity },
    { id: 'crew-lifecycle', label: '下船全景态势', icon: LayoutGrid },
    { id: 'crew', label: '船员下船管理', icon: Users },
    { id: 'data', label: '预抵查询', icon: Database },
  ];

  return (
    <div className="w-64 bg-slate-900 text-slate-300 flex flex-col h-full shadow-xl z-20 flex-shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-slate-800 bg-slate-950">
        <Anchor className="text-blue-500 mr-2 h-6 w-6" />
        <span className="text-white font-bold text-lg tracking-tight">Dockday</span>
        <span className="text-xs ml-2 bg-blue-900 text-blue-200 px-1.5 py-0.5 rounded">V1.0</span>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              currentView === item.id
                ? 'bg-blue-600 text-white shadow-md'
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <item.icon
              className={`mr-3 h-5 w-5 ${
                currentView === item.id ? 'text-white' : 'text-slate-400 group-hover:text-white'
              }`}
            />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="text-xs text-slate-500 leading-relaxed">
          仅展示港口预抵数据和基础分析，更多能力请连接后台服务。
        </div>
      </div>
    </div>
  );
};
