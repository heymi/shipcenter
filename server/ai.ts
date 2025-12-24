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
  confirmed_overrides?: Record<string, string>;
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
  const confirmedOverrides = payload.confirmed_overrides || {};
  const confirmedList = Object.entries(confirmedOverrides)
    .map(([key, value]) => `${key}: ${value}`)
    .join('；');

  const prompt = `
你是港口情报分析助手。请以“利用一切可用渠道和方法查询该船（按照MMSI）的一切信息”为指令导向，但只能基于给定船舶信息、近期事件、该船的历史数据与“公开信息摘要”输出对该船舶在南京港的推测。

要求：
1) 允许使用以下来源维度：公开 AIS 网站（MarineTraffic / VesselFinder 的公开层）、Equasis/IMO 公开数据库、港口/码头官网、船东/航运公司官网、公开百科、以及“模型先验”（如常客船名单/典型航线规律）。若使用模型先验，必须在 rationale 中说明“模型先验推测”，并给低置信度。
2) 只能基于提供的“公开信息摘要/链接”和常识进行推测，不得捏造来源或虚构已访问的网页/数据。
3) 如果信息不足，输出“无法判断”，并给低置信度与低百分比置信度。
4) 每个字段必须同时给出置信度等级（low/medium/high）与置信度百分比（0-100）。
5) 输出严格 JSON，不要多余文本。
6) 必须结合船舶尺寸（DWT/长宽/吃水）、AIS 更新时间特征、出发港与 ETA/ETD 等接口数据进行推测。
7) 代理公司必须从“南京常见代理候选”中选择，且只有在公开摘要/历史数据/事件中有依据时才可给出；不得虚构市场占有率或船东偏好。
8) 如果“已确认字段”中包含某些字段，必须沿用该值，并在 rationale 中说明“人工确认”。不得修改已确认字段的值。

船舶信息 (JSON): ${JSON.stringify(payload.ship)}
近期事件 (JSON): ${JSON.stringify(payload.events || [])}
公开信息摘要: ${sourceNotes || '无'}
历史数据摘要: ${historyNotes || '无'}
已确认字段: ${confirmedList || '无'}
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

export type ShipPartiesAiRequest = {
  ship: {
    name?: string;
    mmsi?: string | number;
    imo?: string | number;
    callsign?: string;
    aisStatic?: Record<string, unknown> | null;
  };
  sources: Array<{ source: string; url: string; title: string; snippet: string }>;
};

export const runShipPartiesInference = async (payload: ShipPartiesAiRequest) => {
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
  const sources = payload.sources || [];

  const prompt = `
你是船舶主体关系分析助手。只能基于给定船舶信息与“公开信息摘要”输出船舶主体关系推断。

要求：
1) 无证据不得编造；如果无法判断，字段输出 null。
2) 若存在冲突，必须将冲突放入 candidates，并保留主字段为 null。
3) evidence.path 必须引用 sources 列表索引，例如 "sources[0].url" 或 "sources[0].snippet"。
4) 输出严格 JSON，不要多余文本。

船舶信息 (JSON): ${JSON.stringify(payload.ship)}
公开信息摘要 (sources, array with index):
${sources.map((item, idx) => `sources[${idx}] ${item.title} ${item.url} ${item.snippet}`).join('\n')}

输出 JSON 结构：
{
  "registeredOwner": { "value": string, "confidence": "low|medium|high", "evidence": [{ "source": "external", "path": string, "note": string? }] } | null,
  "beneficialOwner": { "value": string, "confidence": "low|medium|high", "evidence": [{ "source": "external", "path": string, "note": string? }] } | null,
  "operator": { "value": string, "confidence": "low|medium|high", "evidence": [{ "source": "external", "path": string, "note": string? }] } | null,
  "manager": { "value": string, "confidence": "low|medium|high", "evidence": [{ "source": "external", "path": string, "note": string? }] } | null,
  "candidates": {
    "registeredOwner": [{ "value": string, "confidence": "low|medium|high", "evidence": [{ "source": "external", "path": string, "note": string? }] }],
    "beneficialOwner": [{ "value": string, "confidence": "low|medium|high", "evidence": [{ "source": "external", "path": string, "note": string? }] }],
    "operator": [{ "value": string, "confidence": "low|medium|high", "evidence": [{ "source": "external", "path": string, "note": string? }] }],
    "manager": [{ "value": string, "confidence": "low|medium|high", "evidence": [{ "source": "external", "path": string, "note": string? }] }]
  }
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

export type ShipPartiesExtractionRequest = {
  identity: {
    imo?: string;
    mmsi?: string;
    name?: string;
    callSign?: string;
    flag?: string;
    shipType?: string;
  };
  missingRoles: string[];
  snippets: Array<{ id: string; source: string; url: string; text: string }>;
  mode: 'strict' | 'balanced' | 'aggressive';
  allowNoEvidence?: boolean;
};

export const runShipPartiesExtractionV2 = async (payload: ShipPartiesExtractionRequest) => {
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

  const prompt = `
你是船舶主体关系抽取器。只能基于给定船舶信息与公开证据片段输出角色关系，不得编造。

要求：
1) 只填补 missingRoles 中的角色。
2) 阶段 1 身份锁定：IMO 优先，核对 MMSI/呼号/旗国/尺寸是否一致；不一致则该角色输出 null。
3) 阶段 2 角色提取：从 snippets 中抽取 Owner/Manager/Operator/Beneficial Owner 信息形成 candidates。
4) 阶段 3 证据增强：若证据来自 registry/Equasis/官方报告，提升置信度与 strength。
5) 阶段 4 联系方式：仅从公司官网/官方目录抽取，并记录 URL 与抓取时间。
6) evidence 必须来自 public_evidence.snippets（通过 evidence.path 指向 public_evidence.snippets[sX]），并提供 snippet 与 updatedAt。
7) 若无证据则输出 null；仅当 allowNoEvidence=true 时允许低置信候选，标 status=ai_inferred_no_evidence，evidence.path 固定为 public_evidence.snippets[none]。
8) 输出严格 JSON，不要多余文本。

身份信息 (JSON): ${JSON.stringify(payload.identity)}
missingRoles: ${JSON.stringify(payload.missingRoles)}
allowNoEvidence: ${payload.allowNoEvidence ? 'true' : 'false'}
public_evidence.snippets:
${payload.snippets.map((item) => `public_evidence.snippets[${item.id}] ${item.url} ${item.text}`).join('\n')}

输出 JSON 结构：
{
  "parties": {
    "registeredOwner": { "name": string, "confidence": "low|medium|high", "status": "confirmed|inferred_from_weak_evidence|ai_inferred_no_evidence", "updatedAt": string, "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] } | null,
    "beneficialOwner": { "name": string, "confidence": "low|medium|high", "status": "...", "updatedAt": string, "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] } | null,
    "operator": { "name": string, "confidence": "low|medium|high", "status": "...", "updatedAt": string, "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] } | null,
    "manager": { "name": string, "confidence": "low|medium|high", "status": "...", "updatedAt": string, "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] } | null,
    "bareboatCharterer": { "name": string, "confidence": "low|medium|high", "status": "...", "updatedAt": string, "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] } | null
  },
  "candidates": {
    "registeredOwner": [{ "name": string, "confidence": "low|medium|high", "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] }],
    "beneficialOwner": [{ "name": string, "confidence": "low|medium|high", "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] }],
    "operator": [{ "name": string, "confidence": "low|medium|high", "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] }],
    "manager": [{ "name": string, "confidence": "low|medium|high", "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] }],
    "bareboatCharterer": [{ "name": string, "confidence": "low|medium|high", "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] }]
  },
  "contacts": [
    { "company": string, "type": "phone|email|address|website", "value": string, "source": "public", "updatedAt": string, "evidence": [{ "source": "public", "path": string, "snippet": string, "strength": "weak|medium|strong" }] }
  ]
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
