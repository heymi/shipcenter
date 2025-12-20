import { GoogleGenAI } from '@google/genai';

const DEFAULT_PUBLIC_SOURCES = [
  '公开 AIS 网站（MarineTraffic / VesselFinder 的公开层）',
  'Equasis / IMO 公开数据库（船名/IMO/MMSI/旗帜/DWT）',
  '港口/码头官网公告（公开栏目）',
  '船东/航运公司官网新闻与船队信息',
  '主流媒体与行业资讯站点（公开页）',
  '船舶公开百科/公开档案（非付费）',
  '模型先验（仅用于经验性推测，需低置信度标注）',
];

const NANJING_AGENT_CANDIDATES = [
  '中国外运南京有限公司',
  '五矿国际货运江苏有限责任公司',
  '中远海运物流有限公司南京分公司',
  '中国外轮代理有限公司南京分公司',
  '南京思诺福船舶代理有限公司',
  '南京航姆船舶代理有限公司',
  '中钢国际货运有限公司华东分公司',
  '南京永隆船务代理有限公司',
  '江苏星致航船务代理有限公司',
];

type ShipInfo = {
  name?: string;
  mmsi?: string | number;
  imo?: string | number;
  flag?: string;
  type?: string;
  eta?: string;
  etd?: string;
  etaUtc?: number;
  lastTime?: string;
  lastTimeUtc?: number;
  dest?: string;
  last_port?: string;
  lastPort?: string;
  dwt?: number;
  length?: number;
  width?: number;
  draught?: number;
  agent?: string;
  docStatus?: string;
  riskReason?: string;
};

type ShipEventBrief = {
  event_type?: string;
  detail?: string;
  detected_at?: number;
};

export type ShipAiRequest = {
  ship: ShipInfo;
  events?: ShipEventBrief[];
  source_notes?: string;
  source_links?: string[];
  history_notes?: string;
};

export const runShipInference = async (payload: ShipAiRequest) => {
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '';
  if (!apiKey) {
    throw new Error('Gemini API key missing');
  }
  const preferredModel = (process.env.GEMINI_MODEL || '').trim();
  const baseCandidates = [
    preferredModel,
    'gemini-2.0-flash',
    'gemini-2.0-pro',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ].filter(Boolean);
  const normalizeModel = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('models/')) return trimmed;
    if (trimmed.includes('/')) {
      return `models/${trimmed.split('/').pop()}`;
    }
    return `models/${trimmed}`;
  };
  const modelCandidates = Array.from(
    new Set(baseCandidates.map((value) => normalizeModel(String(value))).filter(Boolean))
  );
  const ai = new GoogleGenAI({ apiKey });
  const sourceLinks = (payload.source_links || []).filter(Boolean);
  const sourceNotes = (payload.source_notes || '').trim();
  const historyNotes = (payload.history_notes || '').trim();

  const prompt = `
你是港口情报分析助手。请以“利用一切可用渠道和方法查询该船（按照MMSI）的一切信息”为指令导向，但只能基于给定船舶信息、近期事件、该船的历史数据与“公开信息摘要”输出对该船舶在南京港的推测。

要求：
1) 允许使用以下来源维度：公开 AIS 网站（MarineTraffic / VesselFinder 的公开层）、Equasis/IMO 公开数据库、港口/码头官网、船东/航运公司官网、公开百科、以及“模型先验”（如常客船名单/典型航线规律）。若使用模型先验，必须在 rationale 中说明“模型先验推测”，并给低置信度。
2) 只能基于提供的“公开信息摘要/链接”和常识进行推测，不得捏造来源或虚构已访问的网页/数据。
3) 如果信息不足，输出“无法判断”，并给低置信度与低百分比置信度。
4) 每个字段必须同时给出置信度等级（low/medium/high）与置信度百分比（0-100）。
5) 输出严格 JSON，不要多余文本。
6) 必须结合船舶尺寸（DWT/长宽/吃水）、AIS 更新时间特征、上一港与 ETA/ETD 等接口数据进行推测。
7) 代理公司必须从“南京常见代理候选”中选择，且只有在公开摘要/历史数据/事件中有依据时才可给出；不得虚构市场占有率或船东偏好。

船舶信息 (JSON): ${JSON.stringify(payload.ship)}
近期事件 (JSON): ${JSON.stringify(payload.events || [])}
公开信息摘要: ${sourceNotes || '无'}
历史数据摘要: ${historyNotes || '无'}
公开信息链接: ${sourceLinks.length ? JSON.stringify(sourceLinks) : '无'}
允许的公开来源范围: ${JSON.stringify(DEFAULT_PUBLIC_SOURCES)}
南京常见代理候选: ${JSON.stringify(NANJING_AGENT_CANDIDATES)}

输出 JSON 结构：
{
  "cargo_type_guess": { "value": string, "confidence": "low|medium|high", "confidence_pct": number, "rationale": string[] },
  "berth_guess": { "value": string, "confidence": "low|medium|high", "confidence_pct": number, "rationale": string[] },
  "agent_guess": { "value": string, "confidence": "low|medium|high", "confidence_pct": number, "rationale": string[] },
  "crew_nationality_guess": { "value": string, "confidence": "low|medium|high", "confidence_pct": number, "rationale": string[] },
  "crew_count_guess": { "value": number | null, "confidence": "low|medium|high", "confidence_pct": number, "rationale": string[] },
  "signals": string[],
  "sources_used": string[],
  "disclaimer": string
}
`;

  let raw = '';
  let lastError: unknown;
  for (const model of modelCandidates) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      raw = response.text || '';
      break;
    } catch (err: any) {
      lastError = err;
      const status = err?.status;
      const message = err?.message ? String(err.message) : '';
      const isNotFound = status === 404 || /not found/i.test(message);
      if (!isNotFound) {
        throw err;
      }
    }
  }
  if (!raw && lastError) {
    throw lastError;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {
      raw,
      parse_error: 'AI response is not valid JSON',
    };
  }
};

export const listAiModels = async () => {
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '';
  if (!apiKey) {
    throw new Error('Gemini API key missing');
  }
  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list({ config: { pageSize: 200, queryBase: true } });
  return pager.page || [];
};
