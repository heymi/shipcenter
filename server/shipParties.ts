export type ConfidenceLevel = 'low' | 'medium' | 'high';

export type Evidence = {
  source: 'input' | 'external';
  path: string;
  note?: string;
};

export type PartyCandidate = {
  value: string;
  confidence: ConfidenceLevel;
  evidence: Evidence[];
};

export type PartyField = 'registeredOwner' | 'beneficialOwner' | 'operator' | 'manager';

export type ShipPartiesResponse = {
  query: {
    imo?: string;
    mmsi?: string;
    name?: string;
    callsign?: string;
  };
  ai_status?: 'not_requested' | 'skipped' | 'ok' | 'failed';
  registeredOwner: PartyCandidate | null;
  beneficialOwner: PartyCandidate | null;
  operator: PartyCandidate | null;
  manager: PartyCandidate | null;
  candidates: Partial<Record<PartyField, PartyCandidate[]>>;
};

export type ShipPartiesInput = {
  imo?: string;
  mmsi?: string;
  name?: string;
  callsign?: string;
  aisStatic?: Record<string, unknown> | null;
  external?: ExternalCandidate[] | Record<string, unknown> | null;
};

export type ExternalCandidate = {
  field: PartyField;
  value: string;
  confidence?: ConfidenceLevel;
  evidence?: Evidence;
  source?: string;
  path?: string;
};

export type ShipPartiesAiOutput = {
  registeredOwner: PartyCandidate | null;
  beneficialOwner: PartyCandidate | null;
  operator: PartyCandidate | null;
  manager: PartyCandidate | null;
  candidates?: Partial<Record<PartyField, PartyCandidate[]>>;
};

export const SHIP_PARTIES_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'object',
      properties: {
        imo: { type: 'string' },
        mmsi: { type: 'string' },
        name: { type: 'string' },
        callsign: { type: 'string' },
      },
    },
    registeredOwner: { $ref: '#/definitions/partyCandidate' },
    beneficialOwner: { $ref: '#/definitions/partyCandidate' },
    operator: { $ref: '#/definitions/partyCandidate' },
    manager: { $ref: '#/definitions/partyCandidate' },
    ai_status: { type: 'string', enum: ['not_requested', 'skipped', 'ok', 'failed'] },
    candidates: {
      type: 'object',
      properties: {
        registeredOwner: { type: 'array', items: { $ref: '#/definitions/partyCandidate' } },
        beneficialOwner: { type: 'array', items: { $ref: '#/definitions/partyCandidate' } },
        operator: { type: 'array', items: { $ref: '#/definitions/partyCandidate' } },
        manager: { type: 'array', items: { $ref: '#/definitions/partyCandidate' } },
      },
    },
  },
  definitions: {
    partyCandidate: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            value: { type: 'string' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  source: { type: 'string', enum: ['input', 'external'] },
                  path: { type: 'string' },
                  note: { type: 'string' },
                },
                required: ['source', 'path'],
              },
            },
          },
          required: ['value', 'confidence', 'evidence'],
        },
      ],
    },
  },
} as const;

const PARTY_FIELDS: PartyField[] = ['registeredOwner', 'beneficialOwner', 'operator', 'manager'];

const AIS_FIELD_MAP: Record<PartyField, string[]> = {
  registeredOwner: ['registeredOwner', 'registered_owner', 'owner', 'shipOwner', 'ship_owner'],
  beneficialOwner: ['beneficialOwner', 'beneficial_owner', 'beneficialowner'],
  operator: ['operator', 'shipOperator', 'operatorName', 'ship_operator'],
  manager: ['manager', 'shipManager', 'ship_manager'],
};

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const normalizeValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

const normalizeConfidence = (value?: string): ConfidenceLevel => {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'low';
};

const mergeEvidence = (list: Evidence[], incoming: Evidence) => {
  const key = `${incoming.source}:${incoming.path}:${incoming.note || ''}`;
  const exists = list.some((item) => `${item.source}:${item.path}:${item.note || ''}` === key);
  if (!exists) list.push(incoming);
};

const mergeCandidate = (
  map: Map<string, PartyCandidate>,
  candidate: PartyCandidate
) => {
  const existing = map.get(candidate.value);
  if (!existing) {
    map.set(candidate.value, { ...candidate, evidence: [...candidate.evidence] });
    return;
  }
  const best =
    CONFIDENCE_RANK[candidate.confidence] > CONFIDENCE_RANK[existing.confidence]
      ? candidate.confidence
      : existing.confidence;
  const merged: PartyCandidate = {
    value: existing.value,
    confidence: best,
    evidence: [...existing.evidence],
  };
  candidate.evidence.forEach((item) => mergeEvidence(merged.evidence, item));
  map.set(candidate.value, merged);
};

const buildAisCandidates = (aisStatic?: Record<string, unknown> | null) => {
  if (!aisStatic) return [] as ExternalCandidate[];
  const candidates: ExternalCandidate[] = [];
  PARTY_FIELDS.forEach((field) => {
    AIS_FIELD_MAP[field].forEach((key) => {
      const value = normalizeValue(aisStatic[key]);
      if (!value) return;
      candidates.push({
        field,
        value,
        confidence: 'medium',
        evidence: {
          source: 'input',
          path: `input.aisStatic.${key}`,
        },
      });
    });
  });
  return candidates;
};

const normalizeExternalCandidates = (
  external: ExternalCandidate[] | Record<string, unknown> | null | undefined
) => {
  if (!external) return [] as ExternalCandidate[];
  if (Array.isArray(external)) return external;
  const candidates: ExternalCandidate[] = [];
  PARTY_FIELDS.forEach((field) => {
    const value = normalizeValue((external as Record<string, unknown>)[field]);
    if (!value) return;
    candidates.push({
      field,
      value,
      confidence: 'low',
      evidence: {
        source: 'external',
        path: `external.${field}`,
      },
    });
  });
  return candidates;
};

const candidatesByField = (input: ShipPartiesInput, extraCandidates?: ExternalCandidate[]) => {
  const groups: Record<PartyField, Map<string, PartyCandidate>> = {
    registeredOwner: new Map(),
    beneficialOwner: new Map(),
    operator: new Map(),
    manager: new Map(),
  };

  const allCandidates = [
    ...buildAisCandidates(input.aisStatic),
    ...normalizeExternalCandidates(input.external),
    ...(extraCandidates || []),
  ];

  allCandidates.forEach((candidate, index) => {
    if (!PARTY_FIELDS.includes(candidate.field)) return;
    const value = normalizeValue(candidate.value);
    if (!value) return;
    const confidence = normalizeConfidence(candidate.confidence);
    const evidence =
      candidate.evidence && candidate.evidence.path
        ? candidate.evidence
        : {
            source: 'external',
            path: candidate.path || `external[${index}].value`,
          };
    const normalizedEvidence: Evidence = {
      source: evidence.source === 'input' ? 'input' : 'external',
      path: evidence.path,
      note: evidence.note,
    };
    mergeCandidate(groups[candidate.field], {
      value,
      confidence,
      evidence: [normalizedEvidence],
    });
  });

  return groups;
};

const resolveField = (map: Map<string, PartyCandidate>) => {
  const candidates = Array.from(map.values());
  if (candidates.length === 0) return { primary: null, conflicts: undefined as PartyCandidate[] | undefined };
  if (candidates.length === 1) return { primary: candidates[0], conflicts: undefined };
  return { primary: null, conflicts: candidates };
};

export const buildShipPartiesResponse = (
  input: ShipPartiesInput,
  extraCandidates?: ExternalCandidate[]
): ShipPartiesResponse => {
  const normalizedQuery = {
    imo: normalizeValue(input.imo) || undefined,
    mmsi: normalizeValue(input.mmsi) || undefined,
    name: normalizeValue(input.name) || undefined,
    callsign: normalizeValue(input.callsign) || undefined,
  };
  const fieldCandidates = candidatesByField(input, extraCandidates);

  const response: ShipPartiesResponse = {
    query: normalizedQuery,
    registeredOwner: null,
    beneficialOwner: null,
    operator: null,
    manager: null,
    candidates: {},
  };

  PARTY_FIELDS.forEach((field) => {
    const { primary, conflicts } = resolveField(fieldCandidates[field]);
    response[field] = primary;
    if (conflicts && conflicts.length > 0) {
      response.candidates[field] = conflicts;
    }
  });

  return response;
};

export const aiOutputToCandidates = (output?: ShipPartiesAiOutput | null) => {
  if (!output) return [] as ExternalCandidate[];
  const candidates: ExternalCandidate[] = [];
  const addCandidate = (field: PartyField, candidate: PartyCandidate | null) => {
    if (!candidate || !candidate.value || !Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
      return;
    }
    candidates.push({
      field,
      value: candidate.value,
      confidence: candidate.confidence,
      evidence: {
        source: 'external',
        path: candidate.evidence[0].path,
        note: candidate.evidence[0].note,
      },
    });
  };
  PARTY_FIELDS.forEach((field) => {
    addCandidate(field, output[field] || null);
    const conflicts = output.candidates?.[field] || [];
    conflicts.forEach((candidate) => addCandidate(field, candidate));
  });
  return candidates;
};

export const validateShipPartiesResponse = (payload: ShipPartiesResponse) => {
  if (!payload || typeof payload !== 'object') return false;
  const checkCandidate = (candidate: PartyCandidate | null) => {
    if (candidate === null) return true;
    if (!candidate || typeof candidate.value !== 'string') return false;
    if (!['low', 'medium', 'high'].includes(candidate.confidence)) return false;
    if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) return false;
    return candidate.evidence.every(
      (e) =>
        e &&
        (e.source === 'input' || e.source === 'external') &&
        typeof e.path === 'string' &&
        e.path.length > 0
    );
  };
  const aiStatus = (payload as ShipPartiesResponse).ai_status;
  const aiStatusOk =
    aiStatus === undefined || ['not_requested', 'skipped', 'ok', 'failed'].includes(aiStatus);
  return (
    checkCandidate(payload.registeredOwner) &&
    checkCandidate(payload.beneficialOwner) &&
    checkCandidate(payload.operator) &&
    checkCandidate(payload.manager)
    && aiStatusOk
  );
};
