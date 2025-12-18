import { API_CONFIG } from './config';
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
  agent_contact_name?: string | null;
  agent_contact_phone?: string | null;
  remark?: string | null;
  updated_at?: number;
  is_target?: boolean;
  crew_income_level?: string | null;
  disembark_intent?: string | null;
  email_status?: string | null;
  crew_count?: number | null;
  expected_disembark_count?: number | null;
  actual_disembark_count?: number | null;
  disembark_date?: string | null;
};

const getLocalBase = () => {
  const base = resolveLocalApi();
  if (!base) return null;
  return base.endsWith('/') ? base.slice(0, -1) : base;
};

export const fetchFollowedShips = async (): Promise<FollowedShipMeta[]> => {
  try {
    const base = getLocalBase();
    if (!base) throw new Error('Local API not configured');
    const resp = await fetch(`${base}/followed-ships`, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`followed-ships error ${resp.status}`);
    const payload = await resp.json();
    return Array.isArray(payload) ? payload : [];
  } catch (err) {
    console.warn('Failed to load followed ships', err);
    return [];
  }
};

export const upsertFollowedShip = async (meta: FollowedShipMeta) => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const resp = await fetch(`${base}/followed-ships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  if (!resp.ok) throw new Error(`followed-ships save error ${resp.status}`);
  return resp.json();
};

export const deleteFollowedShip = async (mmsi: string) => {
  const base = getLocalBase();
  if (!base) throw new Error('Local API not configured');
  const resp = await fetch(`${base}/followed-ships/${encodeURIComponent(mmsi)}`, {
    method: 'DELETE',
  });
  if (!resp.ok) throw new Error(`followed-ships delete error ${resp.status}`);
  return resp.json();
};
