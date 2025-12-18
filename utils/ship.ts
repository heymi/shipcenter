export const getShipTypeName = (typeCode: string | number): string => {
  const code = Number(typeCode);
  if (Number.isNaN(code)) return String(typeCode || '未知类型');

  if (code === 0) return '未知类型 (0)';
  if (code >= 30 && code <= 39) return '渔船 (Fishing)';
  if (code >= 40 && code <= 49) return '高速船 (HSC)';
  if (code >= 50 && code <= 59) {
    if (code === 52) return '拖轮 (Tug)';
    return '特种船 (Special)';
  }
  if (code >= 60 && code <= 69) return '客船 (Passenger)';
  if (code >= 70 && code <= 79) return '货船 (Cargo)';
  if (code >= 80 && code <= 89) return '油轮 (Tanker)';
  if (code >= 90 && code <= 99) return '其他 (Other)';

  return `类型 ${code}`;
};

export const isMainlandFlag = (flag?: string): boolean => {
  const raw = String(flag || '').trim();
  if (!raw) return false;
  if (raw.includes('中国')) return true;

  const upper = raw.toUpperCase();
  const normalized = upper.replace(/[\s\.\-']/g, '');

  if (normalized === 'CN' || normalized === 'CHN') return true;
  if (normalized.includes('CHINA')) return true;
  if (normalized.includes('PEOPLESREPUBLICOFCHINA') || normalized.includes('PRC')) return true;

  return false;
};
