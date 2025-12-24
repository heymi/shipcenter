import { fetchPublicSources } from './publicSources';

export type ShipIdentity = {
  imo?: string;
  mmsi?: string;
  name?: string;
  callSign?: string;
  flag?: string;
  shipType?: string;
  historicalNames?: string[];
};

export type PublicSnippet = {
  id: string;
  source: string;
  url: string;
  text: string;
  retrieved_at: number;
};

export type RetrievalResult = {
  status: 'ok' | 'empty' | 'failed';
  snippets: PublicSnippet[];
};

const normalizeText = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const retrievalCache = new Map<string, { expiresAt: number; result: RetrievalResult }>();

const buildQueries = (identity: ShipIdentity) => {
  const queries: string[] = [];
  const parts = [
    normalizeText(identity.imo),
    normalizeText(identity.name),
    normalizeText(identity.callSign),
    normalizeText(identity.mmsi),
    normalizeText(identity.flag),
  ].filter(Boolean);
  const base = parts.join(' ');
  if (base) queries.push(base);
  if (identity.imo && identity.name) queries.push(`${identity.imo} ${identity.name}`);
  if (identity.name && identity.callSign) queries.push(`${identity.name} ${identity.callSign}`);
  if (identity.name && identity.flag) queries.push(`${identity.name} ${identity.flag}`);
  if (identity.mmsi && identity.name) queries.push(`${identity.mmsi} ${identity.name}`);
  if (identity.imo) {
    queries.push(`${identity.imo} registered owner`);
    queries.push(`${identity.imo} operator`);
    queries.push(`${identity.imo} manager`);
    queries.push(`${identity.imo} beneficial owner`);
  }
  if (identity.name) {
    queries.push(`${identity.name} registered owner`);
    queries.push(`${identity.name} operator`);
    queries.push(`${identity.name} manager`);
    queries.push(`${identity.name} beneficial owner`);
  }
  if (Array.isArray(identity.historicalNames)) {
    identity.historicalNames.forEach((name) => {
      const cleaned = normalizeText(name);
      if (cleaned) queries.push(`${cleaned} ${identity.imo || ''}`.trim());
    });
  }
  return Array.from(new Set(queries)).slice(0, 10);
};

export const retrievePublicEvidence = async (identity: ShipIdentity): Promise<RetrievalResult> => {
  const queries = buildQueries(identity);
  if (queries.length === 0) return { status: 'empty', snippets: [] };
  const cacheKey = queries.join('|');
  const cached = retrievalCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  try {
    const snippets: PublicSnippet[] = [];
    const retrievedAt = Date.now();
    for (const query of queries) {
      const payload = await fetchPublicSources({
        name: query,
        mmsi: identity.mmsi,
        imo: identity.imo,
        flag: identity.flag,
        type: identity.shipType,
      }, { maxSources: 8, maxPerSource: 1, ttlMs: 24 * 60 * 60 * 1000 });
      payload.forEach((item) => {
        const id = `s${snippets.length}`;
        snippets.push({
          id,
          source: item.source,
          url: item.url,
          text: item.snippet,
          retrieved_at: retrievedAt,
        });
      });
      if (snippets.length >= 12) break;
    }
    const result: RetrievalResult =
      snippets.length === 0 ? { status: 'empty', snippets: [] } : { status: 'ok', snippets };
    retrievalCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return result;
  } catch (err) {
    const result = { status: 'failed', snippets: [] } as RetrievalResult;
    retrievalCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return result;
  }
};
