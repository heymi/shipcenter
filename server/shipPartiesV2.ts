import type { RetrievalResult, ShipIdentity } from './shipPartiesRetrieval';

export type ShipPartiesMode = 'strict' | 'balanced' | 'aggressive';

export type EvidenceStrength = 'strong' | 'medium' | 'weak' | 'none';

export type Evidence = {
  source: 'ais_static' | 'external' | 'public' | 'ai';
  path: string;
  strength: EvidenceStrength;
  snippet?: string;
  retrievedAt?: number;
  note?: string;
};

export type PartyStatus =
  | 'confirmed'
  | 'inferred_from_weak_evidence'
  | 'ai_inferred_no_evidence';

export type PartyValue = {
  name: string;
  id?: string;
  since?: string;
  updatedAt?: string;
  status?: PartyStatus;
  confidence?: 'low' | 'medium' | 'high';
  source?: string;
  evidence: Evidence[];
};

export type PartyCandidate = {
  name: string;
  score: number;
  confidence: 'low' | 'medium' | 'high';
  evidence: Evidence[];
  conflictsWith?: string[];
  status?: PartyStatus;
};

export type PartyRole =
  | 'registeredOwner'
  | 'beneficialOwner'
  | 'operator'
  | 'manager'
  | 'bareboatCharterer';

export type ShipPartiesV2Response = {
  identity: ShipIdentity;
  parties: Record<PartyRole, PartyValue | null>;
  candidates: Partial<Record<PartyRole, PartyCandidate[]>>;
  public_evidence: RetrievalResult;
  contacts: Array<{
    company: string;
    type: string;
    value: string;
    source: string;
    evidence: Evidence[];
    updatedAt?: string;
  }>;
  notes: string[];
  errors: string[];
  ai_status: 'not_requested' | 'skipped' | 'ok' | 'failed';
  retrieval_status: 'ok' | 'failed' | 'empty';
};

export type ShipPartiesV2Input = {
  imo?: string;
  mmsi?: string;
  name?: string;
  callSign?: string;
  flag?: string;
  shipType?: string;
  aisStatic?: Record<string, unknown> | null;
  external?: unknown;
};

export type AiExtraction = {
  parties?: Partial<Record<PartyRole, PartyValue | null>>;
  candidates?: Partial<Record<PartyRole, PartyCandidate[]>>;
  contacts?: Array<{
    company: string;
    type: string;
    value: string;
    source?: string;
    evidence: Evidence[];
    updatedAt?: string;
  }>;
};

const ROLES: PartyRole[] = [
  'registeredOwner',
  'beneficialOwner',
  'operator',
  'manager',
  'bareboatCharterer',
];

const STRENGTH_SCORE: Record<EvidenceStrength, number> = {
  strong: 3,
  medium: 2,
  weak: 1,
  none: 0,
};

const SOURCE_SCORE: Record<Evidence['source'], number> = {
  external: 3,
  ais_static: 2,
  public: 1,
  ai: 0,
};

const AUTHORITY_DOMAINS = ['equasis.org', 'imo.org'];

const normalizeText = (value: unknown) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const normalizeIdentity = (input: ShipPartiesV2Input): ShipIdentity => ({
  imo: normalizeText(input.imo) || undefined,
  mmsi: normalizeText(input.mmsi) || undefined,
  name: normalizeText(input.name) || undefined,
  callSign: normalizeText(input.callSign) || undefined,
  flag: normalizeText(input.flag) || undefined,
  shipType: normalizeText(input.shipType) || undefined,
});

const evidenceStrength = (evidence: Evidence) => STRENGTH_SCORE[evidence.strength] || 0;

const highestStrength = (candidates: PartyCandidate[]) => {
  if (!candidates.length) return 0;
  return Math.max(...candidates.map((candidate) => evidenceStrength(candidate.evidence[0])));
};

const buildCandidate = (
  name: string,
  evidence: Evidence[],
  confidence: PartyCandidate['confidence'],
  status?: PartyStatus
) => ({
  name,
  score: evidenceStrength(evidence[0]) * 10 + SOURCE_SCORE[evidence[0].source],
  confidence,
  evidence,
  status,
});

const recalcCandidate = (candidate: PartyCandidate) => ({
  ...candidate,
  score:
    (candidate.evidence[0]
      ? evidenceStrength(candidate.evidence[0]) * 10 + SOURCE_SCORE[candidate.evidence[0].source]
      : 0),
});

const normalizeExternal = (external: unknown): PartyCandidate[] => {
  if (!external) return [];
  if (!Array.isArray(external)) return [];
  return external
    .map((item: any, idx) => {
      const role = item.role || item.field;
      const name = normalizeText(item.name || item.value);
      if (!role || !name) return null;
      const strength = (item.strength as EvidenceStrength) || 'strong';
      const confidence = (item.confidence as PartyCandidate['confidence']) || 'medium';
      const evidence: Evidence = {
        source: 'external',
        path: item.path || `external[${idx}]`,
        strength,
        snippet: name,
        retrievedAt: Date.now(),
        note: item.note,
      };
      return { role, candidate: buildCandidate(name, [evidence], confidence) };
    })
    .filter(Boolean) as Array<{ role: PartyRole; candidate: PartyCandidate }>;
};

const normalizeAis = (aisStatic: Record<string, unknown> | null | undefined) => {
  if (!aisStatic) return [] as Array<{ role: PartyRole; candidate: PartyCandidate }>;
  const map: Record<PartyRole, string[]> = {
    registeredOwner: ['registeredOwner', 'registered_owner', 'owner', 'shipOwner', 'ship_owner'],
    beneficialOwner: ['beneficialOwner', 'beneficial_owner', 'beneficialowner'],
    operator: ['operator', 'shipOperator', 'operatorName', 'ship_operator'],
    manager: ['manager', 'shipManager', 'ship_manager'],
    bareboatCharterer: ['bareboatCharterer', 'bareboat_charterer'],
  };
  const entries: Array<{ role: PartyRole; candidate: PartyCandidate }> = [];
  ROLES.forEach((role) => {
    map[role].forEach((key) => {
      const name = normalizeText(aisStatic[key]);
      if (!name) return;
      const evidence: Evidence = {
        source: 'ais_static',
        path: `ais_static.${key}`,
        strength: 'medium',
        snippet: name,
        retrievedAt: Date.now(),
      };
      entries.push({
        role,
        candidate: buildCandidate(name, [evidence], 'medium'),
      });
    });
  });
  return entries;
};

const mergeCandidates = (
  base: Record<PartyRole, PartyCandidate[]>,
  addition: Array<{ role: PartyRole; candidate: PartyCandidate }>
) => {
  addition.forEach(({ role, candidate }) => {
    base[role] = base[role] || [];
    const existing = base[role].find((item) => item.name === candidate.name);
    if (!existing) {
      base[role].push(candidate);
    } else if (candidate.score > existing.score) {
      Object.assign(existing, candidate);
    }
  });
};

const choosePrimary = (role: PartyRole, list: PartyCandidate[], mode: ShipPartiesMode) => {
  if (!list.length) return { primary: null, candidates: [] as PartyCandidate[] };
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const strongestStrength = evidenceStrength(strongest.evidence[0]);
  const allNames = sorted.map((candidate) => candidate.name);
  if (allNames.length > 1) {
    sorted.forEach((candidate) => {
      candidate.conflictsWith = allNames.filter((name) => name !== candidate.name);
    });
  }
  if (mode === 'strict') {
    if (sorted.length > 1) {
      return { primary: null, candidates: sorted };
    }
    if (strongestStrength < STRENGTH_SCORE.medium) {
      return { primary: null, candidates: sorted };
    }
    return { primary: strongest, candidates: [] };
  }
  if (mode === 'balanced') {
    if (strongestStrength >= STRENGTH_SCORE.medium) {
      return { primary: strongest, candidates: sorted.slice(1) };
    }
    const primary = { ...strongest, status: 'inferred_from_weak_evidence' as PartyStatus };
    return { primary, candidates: sorted.slice(1) };
  }
  return { primary: strongest, candidates: sorted.slice(1) };
};

const hasStrongOrMedium = (candidates: PartyCandidate[]) =>
  highestStrength(candidates) >= STRENGTH_SCORE.medium;

export const buildShipPartiesV2 = (params: {
  input: ShipPartiesV2Input;
  retrieval: RetrievalResult;
  mode: ShipPartiesMode;
  aiExtraction?: AiExtraction | null;
  aiStatus?: ShipPartiesV2Response['ai_status'];
}): ShipPartiesV2Response => {
  const identity = normalizeIdentity(params.input);
  const mode = params.mode || 'balanced';
  const base: Record<PartyRole, PartyCandidate[]> = {
    registeredOwner: [],
    beneficialOwner: [],
    operator: [],
    manager: [],
    bareboatCharterer: [],
  };
  mergeCandidates(base, normalizeAis(params.input.aisStatic || null));
  mergeCandidates(base, normalizeExternal(params.input.external));

  if (params.aiExtraction?.parties) {
    ROLES.forEach((role) => {
      const party = params.aiExtraction?.parties?.[role] || null;
      if (!party?.name || !party.evidence?.length) return;
      const candidate = buildCandidate(
        party.name,
        party.evidence,
        party.confidence || 'low',
        party.status
      );
      base[role].push(candidate);
    });
  }
  if (params.aiExtraction?.candidates) {
    ROLES.forEach((role) => {
      const list = params.aiExtraction?.candidates?.[role] || [];
      list.forEach((candidate) => {
        if (!candidate?.name || !candidate.evidence?.length) return;
        base[role].push(candidate);
      });
    });
  }

  const parties: Record<PartyRole, PartyValue | null> = {
    registeredOwner: null,
    beneficialOwner: null,
    operator: null,
    manager: null,
    bareboatCharterer: null,
  };
  const candidates: Partial<Record<PartyRole, PartyCandidate[]>> = {};

  const snippetMap = new Map<string, { url: string; text: string; retrieved_at: number }>();
  params.retrieval.snippets.forEach((snippet) => {
    snippetMap.set(snippet.id, {
      url: snippet.url,
      text: snippet.text,
      retrieved_at: snippet.retrieved_at,
    });
  });

  const enrichEvidence = (evidence: Evidence[]) => {
    return evidence.map((item) => {
      if (item.source === 'public' && item.path.startsWith('public_evidence.snippets[')) {
        const key = item.path.replace('public_evidence.snippets[', '').replace(']', '');
        const snippet = snippetMap.get(key);
        if (snippet) {
          const isAuthority = AUTHORITY_DOMAINS.some((domain) => snippet.url.includes(domain));
          return {
            ...item,
            snippet: item.snippet || snippet.text,
            retrievedAt: item.retrievedAt || snippet.retrieved_at,
            strength: isAuthority ? 'strong' : item.strength,
          };
        }
      }
      return item;
    });
  };

  const ensureUpdatedAt = (party: PartyValue) => {
    if (party.updatedAt) return party;
    const ts = party.evidence.find((item) => item.retrievedAt)?.retrievedAt;
    if (ts) {
      return { ...party, updatedAt: new Date(ts).toISOString() };
    }
    return party;
  };

  const isPartyValid = (party: PartyValue) => {
    const hasEvidence = party.evidence.some((item) => item.path && item.snippet);
    return Boolean(party.source && hasEvidence && party.updatedAt);
  };

  ROLES.forEach((role) => {
    if (base[role]?.length) {
      base[role] = base[role].map((candidate) => {
        const enrichedEvidence = enrichEvidence(candidate.evidence);
        return recalcCandidate({ ...candidate, evidence: enrichedEvidence });
      });
    }
    const list = base[role];
    const { primary, candidates: conflict } = choosePrimary(role, list, mode);
    if (primary) {
      const enrichedEvidence = enrichEvidence(primary.evidence);
      const party: PartyValue = {
        name: primary.name,
        status: primary.status,
        confidence: primary.confidence,
        source: primary.evidence[0]?.source,
        evidence: enrichedEvidence,
      };
      const withUpdated = ensureUpdatedAt(party);
      if (isPartyValid(withUpdated)) {
        parties[role] = withUpdated;
      } else {
        candidates[role] = [...(candidates[role] || []), primary];
      }
    }
    if (conflict.length > 0) candidates[role] = conflict;
  });

  const ai_status = params.aiStatus || 'not_requested';

  return {
    identity,
    parties,
    candidates,
    public_evidence: params.retrieval,
    contacts: params.aiExtraction?.contacts || [],
    notes: [],
    errors: [],
    ai_status,
    retrieval_status: params.retrieval.status,
  };
};

export const rolesNeedingAi = (candidates: Record<PartyRole, PartyCandidate[]>) => {
  return ROLES.filter((role) => !hasStrongOrMedium(candidates[role] || []));
};

export const buildCandidatePool = (input: ShipPartiesV2Input) => {
  const base: Record<PartyRole, PartyCandidate[]> = {
    registeredOwner: [],
    beneficialOwner: [],
    operator: [],
    manager: [],
    bareboatCharterer: [],
  };
  mergeCandidates(base, normalizeAis(input.aisStatic || null));
  mergeCandidates(base, normalizeExternal(input.external));
  return base;
};

const isAllowedEvidencePath = (path: string) =>
  path.startsWith('public_evidence.snippets[') ||
  path.startsWith('external.') ||
  path.startsWith('ais_static.') ||
  path === 'public_evidence.snippets[none]';

export const sanitizeAiExtraction = (payload: any): AiExtraction => {
  if (!payload || typeof payload !== 'object') return {};
  const sanitizeParty = (party: any): PartyValue | null => {
    if (!party || typeof party !== 'object') return null;
    if (!party.name || !Array.isArray(party.evidence) || party.evidence.length === 0) return null;
    const evidence = party.evidence
      .map((item: any) => ({
        source: item.source === 'public' ? 'public' : 'ai',
        path: String(item.path || ''),
        strength: (item.strength as EvidenceStrength) || 'weak',
        snippet: item.snippet ? String(item.snippet) : undefined,
        retrievedAt: item.retrievedAt ? Number(item.retrievedAt) : undefined,
        note: item.note ? String(item.note) : undefined,
      }))
      .filter((item: Evidence) => item.path && isAllowedEvidencePath(item.path));
    if (evidence.length === 0) return null;
    return {
      name: String(party.name),
      status: party.status,
      confidence: party.confidence,
      evidence,
      updatedAt: party.updatedAt ? String(party.updatedAt) : undefined,
    };
  };
  const sanitizeCandidates = (list: any[]): PartyCandidate[] =>
    (Array.isArray(list) ? list : [])
      .map((item) => sanitizeParty(item))
      .filter(Boolean)
      .map((party) =>
        buildCandidate(party!.name, party!.evidence, party!.confidence || 'low', party!.status)
      );

  const parties: Partial<Record<PartyRole, PartyValue | null>> = {};
  const candidates: Partial<Record<PartyRole, PartyCandidate[]>> = {};
  ROLES.forEach((role) => {
    const party = sanitizeParty(payload.parties?.[role]);
    if (party) parties[role] = party;
    const list = sanitizeCandidates(payload.candidates?.[role]);
    if (list.length > 0) candidates[role] = list;
  });

  const contacts = Array.isArray(payload.contacts)
    ? payload.contacts
        .map((contact: any, idx: number) => {
          if (!contact?.value || !contact?.company || !Array.isArray(contact?.evidence)) return null;
          const evidence = contact.evidence
            .map((item: any) => ({
              source: item.source === 'public' ? 'public' : 'ai',
              path: String(item.path || ''),
              strength: (item.strength as EvidenceStrength) || 'weak',
              snippet: item.snippet ? String(item.snippet) : undefined,
              retrievedAt: item.retrievedAt ? Number(item.retrievedAt) : undefined,
              note: item.note ? String(item.note) : undefined,
            }))
            .filter((item: Evidence) => item.path && isAllowedEvidencePath(item.path));
          if (evidence.length === 0) return null;
          return {
            company: String(contact.company),
            type: String(contact.type || 'unknown'),
            value: String(contact.value),
            source: String(contact.source || 'public'),
            evidence,
            updatedAt: contact.updatedAt ? String(contact.updatedAt) : undefined,
          };
        })
        .filter(Boolean)
    : [];

  return { parties, candidates, contacts };
};
