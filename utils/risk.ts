import { RiskLevel, ShipxyShip } from '../types';

const normalizeFlagText = (flag?: string) =>
  String(flag || '')
    .trim()
    .toUpperCase()
    .replace(/[\s\.\-']/g, '');

const isHighRiskFlag = (flag?: string, keywords: string[] = []) => {
  if (!flag) return false;
  const raw = flag.trim();
  if (!raw) return false;
  const normalized = normalizeFlagText(raw);
  return keywords.some((keyword) => {
    const normalizedKeyword = normalizeFlagText(keyword);
    return (
      normalized.includes(normalizedKeyword) ||
      raw.includes(keyword) ||
      normalizedKeyword.includes(normalized)
    );
  });
};

export const RISK_RULE_CONFIG = {
  enabled: true,
  thresholds: {
    high: 4,
    attention: 2,
  },
  highRiskFlagKeywords: [
    'PANAMA',
    'LIBERIA',
    'MARSHALL ISLANDS',
    '巴拿马',
    '利比里亚',
    '马绍尔群岛',
    '马绍尔',
  ],
  draught: {
    level1: 12,
    level2: 18,
    score1: 1,
    score2: 2,
  },
  staleness: {
    warnHours: 6,
    criticalHours: 12,
    scoreWarn: 1,
    scoreCritical: 2,
  },
};

const parseDraughtNumber = (value?: number | string) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
};

const extractShipTypeCode = (value: string | number) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const evaluateRiskRules = (ship: ShipxyShip) => {
  if (!RISK_RULE_CONFIG.enabled) {
    return { level: RiskLevel.NORMAL, reason: undefined as string | undefined };
  }

  let score = 0;
  const reasons: string[] = [];

  const flagText = ship.ship_flag?.trim();
  if (!flagText) {
    score += 2;
    reasons.push('船籍未知');
  } else if (isHighRiskFlag(flagText, RISK_RULE_CONFIG.highRiskFlagKeywords)) {
    score += 2;
    reasons.push('重点国家/地区船籍');
  }

  const typeCode = extractShipTypeCode(ship.ship_type);
  const typeStr = typeof ship.ship_type === 'string' ? ship.ship_type : '';
  const lowerType = typeStr.toLowerCase();
  const isUnknownType =
    typeCode === null ||
    typeCode === 0 ||
    !typeStr.trim() ||
    typeStr.includes('未知') ||
    lowerType.includes('unknown');
  const isSensitiveType =
    (typeCode !== null && typeCode >= 80 && typeCode <= 89) ||
    (typeCode !== null && typeCode >= 50 && typeCode <= 59) ||
    typeStr.includes('化') ||
    typeStr.includes('油') ||
    typeStr.includes('特种') ||
    lowerType.includes('chemical') ||
    lowerType.includes('tanker') ||
    lowerType.includes('special') ||
    isUnknownType;
  if (isSensitiveType) {
    score += 2;
    reasons.push('重点船型（化学品/油轮/特种/未知）');
  }

  const draught = parseDraughtNumber(ship.draught);
  if (draught !== null) {
    if (draught > RISK_RULE_CONFIG.draught.level2) {
      score += RISK_RULE_CONFIG.draught.score2;
      reasons.push(`吃水>${RISK_RULE_CONFIG.draught.level2}m`);
    } else if (draught > RISK_RULE_CONFIG.draught.level1) {
      score += RISK_RULE_CONFIG.draught.score1;
      reasons.push(`吃水>${RISK_RULE_CONFIG.draught.level1}m`);
    }
  }

  let lastUpdateMs: number | null = null;
  if (ship.last_time_utc) {
    lastUpdateMs = ship.last_time_utc * 1000;
  } else if (ship.last_time) {
    const parsed = Date.parse(ship.last_time.replace(' ', 'T'));
    if (!Number.isNaN(parsed)) lastUpdateMs = parsed;
  }
  if (lastUpdateMs) {
    const diffHours = (Date.now() - lastUpdateMs) / (1000 * 60 * 60);
    if (diffHours > RISK_RULE_CONFIG.staleness.criticalHours) {
      score += RISK_RULE_CONFIG.staleness.scoreCritical;
      reasons.push(`数据>${RISK_RULE_CONFIG.staleness.criticalHours}h未更新`);
    } else if (diffHours > RISK_RULE_CONFIG.staleness.warnHours) {
      score += RISK_RULE_CONFIG.staleness.scoreWarn;
      reasons.push(`数据>${RISK_RULE_CONFIG.staleness.warnHours}h未更新`);
    }
  }

  if (!ship.preport_cnname) {
    score += 1;
    reasons.push('出发港缺失');
  }

  let level = RiskLevel.NORMAL;
  if (score >= RISK_RULE_CONFIG.thresholds.high) level = RiskLevel.HIGH;
  else if (score >= RISK_RULE_CONFIG.thresholds.attention) level = RiskLevel.ATTENTION;

  return { level, reason: reasons.length ? reasons.join('；') : undefined };
};

export const getRiskLabel = (level: RiskLevel) => {
  switch (level) {
    case RiskLevel.HIGH:
      return '重点';
    case RiskLevel.ATTENTION:
      return '提醒';
    default:
      return '常规';
  }
};

export const getRiskBadgeClass = (level: RiskLevel) => {
  switch (level) {
    case RiskLevel.HIGH:
      return 'bg-red-600/25 text-red-200 border border-red-400/40';
    case RiskLevel.ATTENTION:
      return 'bg-amber-500/20 text-amber-200 border border-amber-400/40';
    default:
      return 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40';
  }
};
