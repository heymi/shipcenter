import { API_CONFIG } from './config';
import { supabase } from './supabaseClient';
import { ShipxyResponse, ShipxyShip, ShipEvent } from './types';

// Helper to generate realistic mock data matching Shipxy structure
// This ensures the app is usable even if the API Key is invalid or CORS blocks the request
const getMockShips = (startTime: number): ShipxyShip[] => {
    const baseTime = startTime * 1000;
    const hour = 3600 * 1000;

    return [
        {
            mmsi: 412345678,
            ship_name: 'COSCO STAR',
            imo: 9123456,
            dwt: 50000,
            ship_type: '70', // Cargo
            length: 200,
            width: 32,
            draught: 10,
            preport_cnname: 'Singapore',
            last_time: new Date().toISOString(),
            last_time_utc: Date.now() / 1000,
            eta: new Date(baseTime + hour * 2).toISOString().replace('T', ' ').substring(0, 19),
            eta_utc: startTime + 7200,
            dest: 'NANJING',
            ship_flag: 'China' // Note: UI Logic might filter this out based on "Mainland" checks
        },
        {
            mmsi: 356789123,
            ship_name: 'EVER GIVEN',
            imo: 9811000,
            dwt: 200000,
            ship_type: '70',
            length: 400,
            width: 59,
            draught: 16,
            preport_cnname: 'Suez',
            last_time: new Date().toISOString(),
            last_time_utc: Date.now() / 1000,
            eta: new Date(baseTime + hour * 5).toISOString().replace('T', ' ').substring(0, 19),
            eta_utc: startTime + 18000,
            dest: 'NANJING',
            ship_flag: 'Panama'
        },
        {
            mmsi: 567890123,
            ship_name: 'OCEAN PIONEER',
            imo: 1234567,
            dwt: 80000,
            ship_type: '80', // Tanker
            length: 250,
            width: 44,
            draught: 14,
            preport_cnname: 'Bandar Abbas',
            last_time: new Date().toISOString(),
            last_time_utc: Date.now() / 1000,
            eta: new Date(baseTime + hour * 14).toISOString().replace('T', ' ').substring(0, 19),
            eta_utc: startTime + 50400,
            dest: 'NANJING',
            ship_flag: 'Liberia'
        },
        {
            mmsi: 890123456,
            ship_name: 'PACIFIC RUBY',
            imo: 5556667,
            dwt: 60000,
            ship_type: '70',
            length: 190,
            width: 30,
            draught: 11,
            preport_cnname: 'Tokyo',
            last_time: new Date().toISOString(),
            last_time_utc: Date.now() / 1000,
            eta: new Date(baseTime + hour * 28).toISOString().replace('T', ' ').substring(0, 19),
            eta_utc: startTime + 100800,
            dest: 'NANJING',
            ship_flag: 'Hong Kong' // Should be kept by filter
        },
        {
            mmsi: 999888777,
            ship_name: 'GOLDEN RAY',
            imo: 4443332,
            dwt: 40000,
            ship_type: '60', // Passenger/Ro-Ro
            length: 180,
            width: 28,
            draught: 9,
            preport_cnname: 'Jacksonville',
            last_time: new Date().toISOString(),
            last_time_utc: Date.now() / 1000,
            eta: new Date(baseTime + hour * 50).toISOString().replace('T', ' ').substring(0, 19),
            eta_utc: startTime + 180000,
            dest: 'NANJING',
            ship_flag: 'Marshall Islands'
        },
        {
            mmsi: 123123123,
            ship_name: 'NORDIC STRIDER',
            imo: 1112223,
            dwt: 35000,
            ship_type: '70',
            length: 175,
            width: 28,
            draught: 10,
            preport_cnname: 'Rotterdam',
            last_time: new Date().toISOString(),
            last_time_utc: Date.now() / 1000,
            eta: new Date(baseTime + hour * 45).toISOString().replace('T', ' ').substring(0, 19),
            eta_utc: startTime + 162000,
            dest: 'NANJING',
            ship_flag: 'Norway'
        }
    ];
}

const resolveLocalApi = () => {
  if (API_CONFIG.LOCAL_API) return API_CONFIG.LOCAL_API;
  if (typeof window === 'undefined') return '';
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4000`;
};

const normalizePortCode = (code?: string) => {
  const cleaned = (code || '').trim().toUpperCase();
  return cleaned || 'CNNJG';
};

const buildLocalUrl = (base: string, portCode: string) => {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const url = new URL(`${trimmedBase}/ships`);
  url.searchParams.set('port', portCode);
  return url;
};

const formatLocalResponse = (payload: any, fallbackStart: number): ShipxyResponse => {
  if (Array.isArray(payload)) {
    return { status: 0, msg: 'Local Cache', total: payload.length, data: payload };
  }
  if (payload?.data && Array.isArray(payload.data)) {
    return {
      status: payload.status ?? 0,
      msg: payload.msg ?? 'Local Cache',
      total: payload.total ?? payload.data.length,
      data: payload.data,
    };
  }
  console.warn('Local API payload unexpected, falling back to mock data');
  return {
    status: 0,
    msg: 'Mock Data (Fallback Mode)',
    total: 6,
    data: getMockShips(fallbackStart),
  };
};

export const fetchETAShips = async (
  portCode: string,
  startTime: number,
  endTime: number,
  shipTypeCode?: number
): Promise<ShipxyResponse> => {
  const normalizedCode = normalizePortCode(portCode);
  const localApiBase = resolveLocalApi();

  if (localApiBase) {
    try {
      const localUrl = buildLocalUrl(localApiBase, normalizedCode);
      localUrl.searchParams.set('start_time', String(startTime));
      localUrl.searchParams.set('end_time', String(endTime));
      if (shipTypeCode !== undefined) {
        localUrl.searchParams.set('ship_type', String(shipTypeCode));
      }

      const response = await fetch(localUrl.toString(), { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`Local API error: ${response.status}`);
      }
      const payload = await response.json();
      return formatLocalResponse(payload, startTime);
    } catch (err) {
      console.warn('Local API fetch failed, falling back to Shipxy', err);
    }
  }

  const url = new URL(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.GET_ETA_SHIPS}`);
  url.searchParams.set('key', API_CONFIG.API_KEY || '');
  url.searchParams.set('port_code', normalizedCode);
  url.searchParams.set('start_time', String(startTime));
  url.searchParams.set('end_time', String(endTime));
  if (shipTypeCode !== undefined) {
    url.searchParams.set('ship_type', String(shipTypeCode));
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(id);

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    if (data?.status === 0) {
      return data;
    }

    console.warn('Shipxy API returned error, falling back to mock data:', data?.msg || 'Unknown error');
    return {
      status: 0,
      msg: data?.msg || 'Mock Data (Fallback Mode)',
      total: 6,
      data: getMockShips(startTime),
    };
  } catch (error) {
    console.warn('API Fetch failed (likely CORS or Network), falling back to Mock Data:', error);

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          status: 0,
          msg: 'Mock Data (Fallback Mode)',
          total: 6,
          data: getMockShips(startTime),
        });
      }, 600);
    });
  }
};

export const fetchShipEvents = async (since?: number, limit?: number): Promise<ShipEvent[]> => {
  const localApiBase = resolveLocalApi();
  if (!localApiBase) {
    console.warn('Local API not configured, ship events unavailable');
    return [];
  }
  try {
    const trimmedBase = localApiBase.endsWith('/') ? localApiBase.slice(0, -1) : localApiBase;
    const url = new URL(`${trimmedBase}/ship-events`);
    if (since) {
      url.searchParams.set('since', String(since));
    }
    if (limit) {
      url.searchParams.set('limit', String(limit));
    }
    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Local events API error: ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  } catch (err) {
    console.warn('Failed to load ship events:', err);
    return [];
  }
};

export type FollowedShipMeta = {
  mmsi: string;
  berth?: string | null;
  agent?: string | null;
  material_status?: string | null;
  arrival_remark?: string | null;
  expected_berth?: string | null;
  arrival_window?: string | null;
  risk_note?: string | null;
  cargo_type?: string | null;
  crew_nationality?: string | null;
  crew_nationality_distribution?: string | null;
  agent_contact_name?: string | null;
  agent_contact_phone?: string | null;
  remark?: string | null;
  updated_at?: number;
  is_target?: boolean;
  status?: string | null;
  owner?: string | null;
  crew_income_level?: string | null;
  disembark_intent?: string | null;
  email_status?: string | null;
  crew_count?: number | null;
  expected_disembark_count?: number | null;
  actual_disembark_count?: number | null;
  disembark_date?: string | null;
  last_followed_at?: number | null;
  next_followup_at?: number | null;
};

const getLocalBase = () => {
  const base = resolveLocalApi();
  if (!base) return null;
  return base.endsWith('/') ? base.slice(0, -1) : base;
};

const getAuthHeaders = async () => {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (err) {
    console.warn('Failed to resolve auth token', err);
    return {};
  }
};

export const fetchFollowedShips = async (): Promise<FollowedShipMeta[]> => {
  try {
    const base = getLocalBase();
    if (!base) throw new Error('Local API not configured');
    const authHeaders = await getAuthHeaders();
    const resp = await fetch(`${base}/followed-ships`, {
      headers: { Accept: 'application/json', ...authHeaders },
    });
    if (!resp.ok) throw new Error(`followed-ships error ${resp.status}`);
    const payload = await resp.json();
    return Array.isArray(payload) ? payload : [];
  } catch (err) {
    console.warn('Failed to load followed ships', err);
    return [];
  }
};

export const fetchSharedFollowedShips = async (shareToken: string): Promise<FollowedShipMeta[]> => {
  try {
    const base = getLocalBase();
    if (!base) throw new Error('Local API not configured');
    const resp = await fetch(`${base}/share-links/${encodeURIComponent(shareToken)}/followed-ships`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`share-followed-ships error ${resp.status}`);
    const payload = await resp.json();
    return Array.isArray(payload) ? payload : [];
  } catch (err) {
    console.warn('Failed to load shared followed ships', err);
    return [];
  }
};

export const fetchShipConfirmedFields = async (
  mmsi: string
): Promise<
  Array<{
    field_key: string;
    field_value: string | null;
    source?: string | null;
    note?: string | null;
    updated_at?: number | null;
    created_at?: number | null;
  }>
> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/ship-confirmed-fields/${encodeURIComponent(mmsi)}`, {
    headers: { Accept: 'application/json', ...authHeaders },
  });
  if (!resp.ok) throw new Error(`confirmed-fields error ${resp.status}`);
  const payload = await resp.json();
  return Array.isArray(payload) ? payload : [];
};

export const saveShipConfirmedField = async (
  mmsi: string,
  payload: {
    field_key: string;
    field_value: string;
    source?: string;
    ai_value?: string | null;
    confidence_pct?: number | null;
  }
) => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/ship-confirmed-fields/${encodeURIComponent(mmsi)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    let msg = `confirmed-fields save error ${resp.status}`;
    try {
      const errPayload = await resp.json();
      if (errPayload?.msg) msg = String(errPayload.msg);
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
};

export const deleteShipConfirmedField = async (mmsi: string, fieldKey: string) => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(
    `${base}/ship-confirmed-fields/${encodeURIComponent(mmsi)}/${encodeURIComponent(fieldKey)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json', ...authHeaders },
    }
  );
  if (!resp.ok) throw new Error(`confirmed-fields delete error ${resp.status}`);
};

export const fetchSharedShipConfirmedFields = async (
  shareToken: string,
  mmsi: string
): Promise<
  Array<{
    field_key: string;
    field_value: string | null;
    source?: string | null;
    note?: string | null;
    updated_at?: number | null;
    created_at?: number | null;
  }>
> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const resp = await fetch(
    `${base}/share-links/${encodeURIComponent(shareToken)}/confirmed-fields/${encodeURIComponent(mmsi)}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!resp.ok) throw new Error(`share confirmed-fields error ${resp.status}`);
  const payload = await resp.json();
  return Array.isArray(payload) ? payload : [];
};

export const fetchSharedShipAiAnalysis = async (
  shareToken: string,
  mmsi: string
): Promise<{
  data: ShipAiInference | null;
  updated_at?: number | null;
  created_at?: number | null;
}> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const resp = await fetch(
    `${base}/share-links/${encodeURIComponent(shareToken)}/ai-analysis/${encodeURIComponent(mmsi)}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!resp.ok) throw new Error(`share ai analysis fetch error ${resp.status}`);
  const payload = await resp.json();
  return {
    data: payload?.data || null,
    updated_at: payload?.updated_at ?? null,
    created_at: payload?.created_at ?? null,
  };
};

export const upsertFollowedShip = async (meta: FollowedShipMeta) => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/followed-ships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(meta),
  });
  if (!resp.ok) throw new Error(`followed-ships save error ${resp.status}`);
  return resp.json();
};

export const deleteFollowedShip = async (mmsi: string) => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/followed-ships/${encodeURIComponent(mmsi)}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  if (!resp.ok) throw new Error(`followed-ships delete error ${resp.status}`);
  return resp.json();
};

export type FollowedShipFollowup = {
  id?: number;
  mmsi: string;
  status?: string | null;
  note?: string | null;
  next_action?: string | null;
  next_action_at?: number | null;
  operator?: string | null;
  created_at?: number;
};

export const fetchFollowups = async (mmsi: string, limit = 50): Promise<FollowedShipFollowup[]> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const url = new URL(`${base}/followed-ships/${encodeURIComponent(mmsi)}/followups`);
  url.searchParams.set('limit', String(limit));
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(url.toString(), { headers: { Accept: 'application/json', ...authHeaders } });
  if (!resp.ok) throw new Error(`followups error ${resp.status}`);
  const payload = await resp.json();
  return Array.isArray(payload) ? payload : [];
};

export const createFollowup = async (mmsi: string, payload: FollowedShipFollowup) => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/followed-ships/${encodeURIComponent(mmsi)}/followups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`followups create error ${resp.status}`);
  return resp.json();
};

export const updateFollowedShipStatus = async (
  mmsi: string,
  payload: { status?: string | null; owner?: string | null; next_followup_at?: number | null }
) => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/followed-ships/${encodeURIComponent(mmsi)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`followed-ships status error ${resp.status}`);
  return resp.json();
};

export type ShipAggregate = {
  day?: string;
  week_start?: string;
  arrival_event_count?: number;
  arrival_ship_count?: number;
  risk_change_count?: number;
  risk_change_ship_count?: number;
  updated_at?: number;
};

export type ShipAiInference = {
  cargo_type_guess?: {
    value?: string;
    confidence?: 'low' | 'medium' | 'high';
    confidence_pct?: number;
    rationale?: string[];
  };
  berth_guess?: {
    value?: string;
    confidence?: 'low' | 'medium' | 'high';
    confidence_pct?: number;
    rationale?: string[];
  };
  agent_guess?: {
    value?: string;
    confidence?: 'low' | 'medium' | 'high';
    confidence_pct?: number;
    rationale?: string[];
  };
  crew_nationality_guess?: {
    value?: string;
    confidence?: 'low' | 'medium' | 'high';
    confidence_pct?: number;
    rationale?: string[];
  };
  crew_count_guess?: {
    value?: number | null;
    confidence?: 'low' | 'medium' | 'high';
    confidence_pct?: number;
    rationale?: string[];
  };
  signals?: string[];
  sources_used?: string[];
  disclaimer?: string;
  raw?: string;
  parse_error?: string;
  citations?: {
    source?: string;
    url?: string;
    title?: string;
    snippet?: string;
  }[];
};

export const analyzeShipWithAI = async (payload: {
  ship: {
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
  events?: { event_type?: string; detail?: string; detected_at?: number }[];
  source_notes?: string;
  source_links?: string[];
}): Promise<ShipAiInference> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/ai/ship-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    let msg = `ai analysis error ${resp.status}`;
    try {
      const errPayload = await resp.json();
      if (errPayload?.msg) {
        msg = String(errPayload.msg);
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }
  const data = await resp.json();
  return data?.data || {};
};

export const autoAnalyzeShipWithAI = async (payload: {
  ship: {
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
  events?: { event_type?: string; detail?: string; detected_at?: number }[];
  max_sources?: number;
  max_per_source?: number;
}): Promise<ShipAiInference> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/ai/ship-analysis/auto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    let msg = `ai auto analysis error ${resp.status}`;
    try {
      const errPayload = await resp.json();
      if (errPayload?.msg) {
        msg = String(errPayload.msg);
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }
  const data = await resp.json();
  return data?.data || {};
};

export const batchAnalyzeShipAi = async (payload: {
  scope?: 'events' | 'ships';
  limit?: number;
  since_hours?: number;
  port?: string;
  max_sources?: number;
  max_per_source?: number;
}): Promise<{
  total: number;
  analyzed: number;
  skipped: number;
  failed: number;
  results: Array<{ mmsi: string; status: string; reason?: string }>;
}> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/ai/ship-analysis/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    let msg = `ai batch analysis error ${resp.status}`;
    try {
      const errPayload = await resp.json();
      if (errPayload?.msg) {
        msg = String(errPayload.msg);
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }
  const data = await resp.json();
  return {
    total: data?.total ?? 0,
    analyzed: data?.analyzed ?? 0,
    skipped: data?.skipped ?? 0,
    failed: data?.failed ?? 0,
    results: Array.isArray(data?.results) ? data.results : [],
  };
};

export const fetchShipAiAnalysis = async (mmsi: string): Promise<{
  data: ShipAiInference | null;
  updated_at?: number | null;
  created_at?: number | null;
}> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/ai/ship-analysis/${encodeURIComponent(mmsi)}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders },
  });
  if (!resp.ok) throw new Error(`ai analysis fetch error ${resp.status}`);
  const payload = await resp.json();
  return {
    data: payload?.data || null,
    updated_at: payload?.updated_at ?? null,
    created_at: payload?.created_at ?? null,
  };
};

export const saveShipAiAnalysis = async (mmsi: string, analysis: ShipAiInference) => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const authHeaders = await getAuthHeaders();
  const resp = await fetch(`${base}/ai/ship-analysis/${encodeURIComponent(mmsi)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ analysis }),
  });
  if (!resp.ok) {
    let msg = `ai analysis save error ${resp.status}`;
    try {
      const errPayload = await resp.json();
      if (errPayload?.msg) msg = String(errPayload.msg);
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }
};

export const fetchDailyAggregates = async (start?: string, end?: string): Promise<ShipAggregate[]> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const url = new URL(`${base}/stats/daily`);
  if (start) url.searchParams.set('start', start);
  if (end) url.searchParams.set('end', end);
  const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`stats daily error ${resp.status}`);
  const payload = await resp.json();
  return Array.isArray(payload) ? payload : [];
};

export const fetchWeeklyAggregates = async (start?: string, end?: string): Promise<ShipAggregate[]> => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const url = new URL(`${base}/stats/weekly`);
  if (start) url.searchParams.set('start', start);
  if (end) url.searchParams.set('end', end);
  const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`stats weekly error ${resp.status}`);
  const payload = await resp.json();
  return Array.isArray(payload) ? payload : [];
};
