import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Ship, RiskLevel } from '../types';
import { 
  Bot, 
  Send, 
  Loader2, 
  Sparkles, 
  FileText, 
  AlertTriangle, 
  RefreshCw,
  MessageSquare,
  ShieldAlert,
  ChevronRight,
  TrendingUp,
  BrainCircuit
} from 'lucide-react';

interface SmartAnalysisProps {
  ships: Ship[];
}

export const SmartAnalysis: React.FC<SmartAnalysisProps> = ({ ships }) => {
  const [analysisResult, setAnalysisResult] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Helper to safely get API Key
  const getApiKey = () => {
    // Prefer Vite-exposed env vars; fall back to process/window polyfills
    const viteEnv = (typeof import.meta !== 'undefined' ? (import.meta as any).env : {}) || {};
    if (viteEnv.VITE_GEMINI_API_KEY) return viteEnv.VITE_GEMINI_API_KEY;
    if (viteEnv.GEMINI_API_KEY) return viteEnv.GEMINI_API_KEY;

    const nodeEnv = (typeof process !== 'undefined' ? process.env : {}) || {};
    if (nodeEnv.GEMINI_API_KEY || nodeEnv.API_KEY) {
      return nodeEnv.GEMINI_API_KEY || nodeEnv.API_KEY || '';
    }

    const browserEnv = (typeof window !== 'undefined' && (window as any).process?.env) || {};
    return browserEnv.GEMINI_API_KEY || browserEnv.API_KEY || '';
  };

  // Prepare data context for the AI
  const prepareDataContext = () => {
    const summary = {
      timestamp: new Date().toISOString(),
      totalShips: ships.length,
      highRiskCount: ships.filter(s => s.riskLevel === RiskLevel.HIGH).length,
      highRiskShips: ships.filter(s => s.riskLevel === RiskLevel.HIGH).map(s => ({
        name: s.name, 
        mmsi: s.mmsi,
        reason: s.riskReason,
        eta: s.eta,
        flag: s.flag,
        lastPort: s.lastPort
      })),
      trafficSample: ships.slice(0, 10).map(s => ({
        name: s.name,
        type: s.type,
        eta: s.eta,
      }))
    };
    return JSON.stringify(summary);
  };

  const summarizeLocally = (reason?: string) => {
    if (!ships.length) {
      return `${reason ? `${reason}\n` : ''}当前没有可分析的预抵船舶数据。`;
    }

    const total = ships.length;
    const highRiskShips = ships.filter(s => s.riskLevel === RiskLevel.HIGH);
    const attentionShips = ships.filter(s => s.riskLevel === RiskLevel.ATTENTION);
    const typeBucket = ships.reduce((acc: Record<string, number>, ship) => {
      acc[ship.type] = (acc[ship.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const majorTypes = Object.entries(typeBucket)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 2)
      .map(([type, count]) => `${type} ${count}艘`)
      .join('，') || '类型分布均衡';

    const sortedEtas = [...ships].sort(
      (a, b) => new Date(a.eta).getTime() - new Date(b.eta).getTime()
    );
    const nextWindow = sortedEtas.slice(0, 3).map(s => {
      const eta = new Date(s.eta).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `${s.name} (${eta})`;
    }).join('；') || '暂无抵港计划';

    const highRiskList = highRiskShips.slice(0, 3).map(s => {
      const eta = new Date(s.eta).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `${s.name}•${s.flag}，ETA ${eta}${s.riskReason ? `，${s.riskReason}` : ''}`;
    }).join('；') || '暂无重点船舶';

    return `${reason ? `【离线分析】${reason}\n` : ''}【通航概览】未来72小时预计到港 ${total} 艘，主力船型：${majorTypes}。\n【风险研判】重点 ${highRiskShips.length} 艘、预警 ${attentionShips.length} 艘。重点示例：${highRiskList}。\n【部署建议】近期抵港时段：${nextWindow}，可提前布控查验力量。`;
  };

  const localChatReply = (question?: string) => {
    const q = (question || '').toLowerCase();
    const now = Date.now();
    const withinHours = (hrs: number) => ships.filter(s => {
      const eta = new Date(s.eta).getTime();
      return eta >= now && eta <= now + hrs * 3600 * 1000;
    });

    const tankers = ships.filter(s => s.type.toLowerCase().includes('tanker') || s.type.includes('油'));
    const cargos = ships.filter(s => s.type.toLowerCase().includes('cargo') || s.type.includes('货'));
    const highRisk = ships.filter(s => s.riskLevel === RiskLevel.HIGH);
    const nextDay = withinHours(24);

    if (q.includes('油轮')) {
      const nextDayTankers = nextDay.filter(s => tankers.includes(s));
      return `离线解答：未来24小时预计有 ${nextDayTankers.length} 艘油轮到港，整体油轮数量 ${tankers.length} 艘，高风险 ${tankers.filter(s => s.riskLevel !== RiskLevel.NORMAL).length} 艘。`;
    }

    if (q.includes('高风险') || q.includes('重点')) {
      const list = highRisk.slice(0, 3).map(s => `${s.name} (${s.flag}) ETA ${new Date(s.eta).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' })}`).join('；');
      return `离线解答：当前识别到 ${highRisk.length} 艘高风险船舶${list ? `：${list}` : ''}。建议提前布控、核验证件。`;
    }

    if (q.includes('明天') || q.includes('24')) {
      return `离线解答：未来24小时计划到港 ${nextDay.length} 艘，其中高风险 ${nextDay.filter(s => s.riskLevel === RiskLevel.HIGH).length} 艘。`;
    }

      return `离线解答：未来72小时预计到港 ${ships.length} 艘（高风险 ${highRisk.length} 艘，预警 ${ships.filter(s => s.riskLevel === RiskLevel.ATTENTION).length} 艘）。油轮 ${tankers.length} 艘，货船 ${cargos.length} 艘。`;
  };

  const generateBriefing = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      setAnalysisResult(summarizeLocally('未检测到 Gemini API Key，已使用本地数据生成。'));
      return;
    }
    
    setIsAnalyzing(true);
    setAnalysisResult('');
    
    try {
      // Initialize client here to avoid render crashes
      const ai = new GoogleGenAI({ apiKey });
      const dataContext = prepareDataContext();
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `
          You are an expert Port Operations Analyst for Dockday.
          Analyze the following ship data for Nanjing Port (CNNJG).
          
          Ship Data (JSON): ${dataContext}
          
          Generate a "Daily Port Operation Briefing" (今日港口研报) in Chinese.
          
          Structure the report as follows:
          1. **Traffic Overview (通航概览)**: Brief summary of volume and main ship types.
          2. **Risk Analysis (风险研判)**: Specific analysis of the high-risk ships listed. Why are they risky? What checks are recommended?
          3. **Operational Focus (重点部署)**: Recommendations for border control (e.g., "Prepare 2 teams for chemical tanker inspection at 14:00").
          
          Keep it professional, concise, and actionable for border control officers.
          Format with clear headers and bullet points.
        `,
      });
      
      setAnalysisResult(response.text || '未能生成分析报告，请重试。');
    } catch (error) {
      console.error('AI Error:', error);
      setAnalysisResult(summarizeLocally('Gemini 服务不可用，已回退到本地分析。'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatting) return;
    
    const apiKey = getApiKey();
    if (!apiKey) {
      const userMsg = chatInput;
      setChatInput('');
      setChatHistory(prev => [...prev, { role: 'user', text: userMsg }, { role: 'model', text: localChatReply(userMsg) }]);
      return;
    }

    const userMsg = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsChatting(true);

    try {
       const ai = new GoogleGenAI({ apiKey });
       const dataContext = prepareDataContext();
       
       const prompt = `
         Context: You are a Port Assistant. Here is the current ship data: ${dataContext}
         
         Chat History:
         ${chatHistory.map(h => `${h.role}: ${h.text}`).join('\n')}
         User: ${userMsg}
         
         Answer the user's question based on the ship data. Be helpful and concise.
       `;

       const response = await ai.models.generateContent({
         model: 'gemini-2.5-flash',
         contents: prompt
       });

       setChatHistory(prev => [...prev, { role: 'model', text: response.text || 'Sorry, I could not understand that.' }]);

    } catch (error) {
       console.error(error);
       setChatHistory(prev => [...prev, { role: 'model', text: `${localChatReply(userMsg)}（Gemini 服务暂不可用）` }]);
    } finally {
       setIsChatting(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  return (
    <div className="h-full flex flex-col gap-6 animate-fade-in">
      <div className="flex justify-between items-start shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BrainCircuit className="text-blue-600" />
            智能分析指挥舱
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            基于 Gemini 2.5 Flash 模型的实时船舶态势分析与决策辅助。
          </p>
        </div>
        {!analysisResult && !isAnalyzing && (
            <button 
              onClick={generateBriefing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-all"
            >
              <Sparkles size={16} />
              生成今日简报
            </button>
        )}
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden min-h-0">
        {/* Left Panel: Analysis Report */}
        <div className="flex-[2] bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
             <div className="flex items-center gap-2">
               <FileText className="text-slate-500 w-5 h-5" />
               <h3 className="font-semibold text-slate-800">智能研判报告</h3>
             </div>
             {analysisResult && (
               <button 
                 onClick={generateBriefing}
                 disabled={isAnalyzing}
                 className="text-xs flex items-center gap-1 text-slate-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
               >
                 <RefreshCw size={12} className={isAnalyzing ? 'animate-spin' : ''} />
                 刷新数据
               </button>
             )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 bg-white">
            {isAnalyzing ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                <p className="animate-pulse">正在分析预抵船舶数据...</p>
                <div className="text-xs bg-slate-100 px-3 py-1 rounded-full text-slate-500 mt-2">
                  Analyzing {ships.length} vessels via Gemini Flash
                </div>
              </div>
            ) : analysisResult ? (
              <div className="prose prose-slate max-w-none text-sm leading-relaxed">
                <div className="whitespace-pre-wrap">{analysisResult}</div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <Sparkles className="w-16 h-16 text-slate-200 mb-4" />
                <p>点击右上角“生成今日简报”获取 AI 分析结果</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Chat Assistant */}
        <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
            <Bot className="text-indigo-500 w-5 h-5" />
            <h3 className="font-semibold text-slate-800">数据助手</h3>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30">
             {chatHistory.length === 0 && (
               <div className="text-center mt-10">
                 <div className="inline-flex p-3 bg-indigo-50 text-indigo-500 rounded-full mb-3">
                    <MessageSquare size={20} />
                 </div>
                 <p className="text-sm text-slate-500 mb-4">我可以回答关于当前预抵船舶的问题。</p>
                 <div className="flex flex-col gap-2 px-4">
                    <button onClick={() => setChatInput("明天有多少艘油轮到港？")} className="text-xs text-left p-2 bg-white border border-slate-200 rounded hover:border-indigo-300 transition-colors text-slate-600">
                      "明天有多少艘油轮到港？"
                    </button>
                    <button onClick={() => setChatInput("有没有来自高风险地区的船？")} className="text-xs text-left p-2 bg-white border border-slate-200 rounded hover:border-indigo-300 transition-colors text-slate-600">
                      "有没有来自高风险地区的船？"
                    </button>
                 </div>
               </div>
             )}
             
             {chatHistory.map((msg, idx) => (
               <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                   msg.role === 'user' 
                     ? 'bg-blue-600 text-white rounded-br-none' 
                     : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm'
                 }`}>
                   {msg.text}
                 </div>
               </div>
             ))}
             {isChatting && (
                <div className="flex justify-start">
                   <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                   </div>
                </div>
             )}
          </div>

          <div className="p-3 bg-white border-t border-slate-100">
            <div className="relative">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="询问关于船舶的数据..."
                className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
              />
              <button 
                onClick={handleSendMessage}
                disabled={!chatInput.trim() || isChatting}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md disabled:opacity-50 transition-colors"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
