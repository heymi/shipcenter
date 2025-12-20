type ShipInfo = {
  name?: string;
  mmsi?: string | number;
  imo?: string | number;
  flag?: string;
  type?: string;
  eta?: string;
  dest?: string;
  last_port?: string;
};

type Source = {
  id: string;
  label: string;
  baseUrl: string;
  buildUrls: (ship: ShipInfo) => string[];
};

export type SourceSnippet = {
  source: string;
  url: string;
  title: string;
  snippet: string;
};

const DEFAULT_ALLOWLIST = [
  'vesselfinder.com',
  'marinetraffic.com',
  'fleetmon.com',
  'shipspotting.com',
  'wikidata.org',
  'wikipedia.org',
  'coscoshipping.com',
  'maersk.com',
  'msc.com',
  'evergreen-marine.com',
  'cma-cgm.com',
  'hmm21.com',
  'one-line.com',
  'yangming.com',
];

const normalizeShipName = (name?: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, ' ').trim();
};

const buildSearchTerm = (ship: ShipInfo) => {
  if (ship.mmsi) return String(ship.mmsi).trim();
  if (ship.imo) return String(ship.imo).trim();
  return normalizeShipName(ship.name);
};

const safeEncode = (value: string) => encodeURIComponent(value.trim());

const SOURCES: Source[] = [
  {
    id: 'vesselfinder',
    label: 'VesselFinder',
    baseUrl: 'https://www.vesselfinder.com',
    buildUrls: (ship) => {
      const term = buildSearchTerm(ship);
      if (!term) return [];
      return [`https://www.vesselfinder.com/vessels?name=${safeEncode(term)}`];
    },
  },
  {
    id: 'marinetraffic',
    label: 'MarineTraffic',
    baseUrl: 'https://www.marinetraffic.com',
    buildUrls: (ship) => {
      const term = buildSearchTerm(ship);
      if (!term) return [];
      return [
        `https://www.marinetraffic.com/en/global_search/search?term=${safeEncode(term)}`,
      ];
    },
  },
  {
    id: 'fleetmon',
    label: 'FleetMon',
    baseUrl: 'https://www.fleetmon.com',
    buildUrls: (ship) => {
      const term = buildSearchTerm(ship);
      if (!term) return [];
      return [`https://www.fleetmon.com/vessels/?name=${safeEncode(term)}`];
    },
  },
  {
    id: 'shipspotting',
    label: 'Shipspotting',
    baseUrl: 'https://www.shipspotting.com',
    buildUrls: (ship) => {
      const term = buildSearchTerm(ship);
      if (!term) return [];
      return [`https://www.shipspotting.com/photos/search?keywords=${safeEncode(term)}`];
    },
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    baseUrl: 'https://en.wikipedia.org',
    buildUrls: (ship) => {
      const term = buildSearchTerm(ship);
      if (!term) return [];
      return [`https://en.wikipedia.org/wiki/Special:Search?search=${safeEncode(term)}`];
    },
  },
  {
    id: 'wikidata',
    label: 'Wikidata',
    baseUrl: 'https://www.wikidata.org',
    buildUrls: (ship) => {
      const term = buildSearchTerm(ship);
      if (!term) return [];
      return [`https://www.wikidata.org/w/index.php?search=${safeEncode(term)}`];
    },
  },
];

const getAllowlist = () => {
  const raw = process.env.PUBLIC_SOURCE_ALLOWLIST || '';
  const list = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_ALLOWLIST;
};

const isAllowedDomain = (url: string, allowlist: string[]) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return allowlist.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
};

const stripHtml = (html: string) => {
  const withoutScripts = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
  return withoutScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

const extractTitle = (html: string) => {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
};

const buildCacheKey = (ship: ShipInfo) =>
  `${ship.name || ''}|${ship.mmsi || ''}|${ship.imo || ''}`.trim();

const cache = new Map<string, { expiresAt: number; data: SourceSnippet[] }>();

export const fetchPublicSources = async (
  ship: ShipInfo,
  options?: { maxSources?: number; maxPerSource?: number; ttlMs?: number }
) => {
  const key = buildCacheKey(ship);
  const ttlMs = options?.ttlMs ?? 6 * 60 * 60 * 1000;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const allowlist = getAllowlist();
  const maxSources = Math.max(1, options?.maxSources ?? 6);
  const maxPerSource = Math.max(1, options?.maxPerSource ?? 1);

  const snippets: SourceSnippet[] = [];
  const sources = SOURCES.filter((source) => allowlist.some((domain) =>
    source.baseUrl.includes(domain)
  )).slice(0, maxSources);

  for (const source of sources) {
    const urls = source.buildUrls(ship).slice(0, maxPerSource);
    for (const url of urls) {
      if (!isAllowedDomain(url, allowlist)) continue;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, {
          headers: { 'User-Agent': 'DockdayBot/1.0 (+https://dockday.local)' },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) continue;
        const html = await res.text();
        const title = extractTitle(html) || source.label;
        const text = stripHtml(html);
        const snippet = text.slice(0, 800);
        if (snippet) {
          snippets.push({ source: source.label, url, title, snippet });
        }
      } catch (err) {
        continue;
      }
    }
  }

  cache.set(key, { expiresAt: Date.now() + ttlMs, data: snippets });
  return snippets;
};
