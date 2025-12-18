const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_OFFSET_MINUTES = -8 * 60; // UTC+8

const hasExplicitTimezone = (value: string) => /[+-]\d{2}:?\d{2}$|Z$/i.test(value);

const parseBeijingDateInternal = (value?: string) => {
  if (!value) return null;
  const normalized = value.replace(' ', 'T');
  const candidates = hasExplicitTimezone(normalized)
    ? [normalized]
    : [`${normalized}+08:00`, normalized];
  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
};

const ymdFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const getYmdParts = (date: Date) => {
  const parts = ymdFormatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || '0');
  return { year: get('year'), month: get('month'), day: get('day') };
};

const getBeijingDayKey = (date: Date) => {
  const { year, month, day } = getYmdParts(date);
  return Date.UTC(year, month - 1, day);
};

const getWeekStartKey = (dayKey: number) => {
  const weekday = new Date(dayKey).getUTCDay(); // 0 Sunday
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return dayKey - daysFromMonday * DAY_MS;
};

const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];

export const formatSmartWeekdayLabel = (value?: string) => {
  const target = parseBeijingDateInternal(value);
  if (!target) return '';

  const now = new Date();
  const nowAdjusted = new Date(now.getTime() + (TARGET_OFFSET_MINUTES - now.getTimezoneOffset()) * 60000);

  const targetDayKey = getBeijingDayKey(target);
  const nowDayKey = getBeijingDayKey(nowAdjusted);
  const diffDays = Math.round((targetDayKey - nowDayKey) / DAY_MS);

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '明天';

  const weekdayChar = weekdayLabels[new Date(targetDayKey).getUTCDay()];
  const base = `周${weekdayChar}`;

  const nowWeekStart = getWeekStartKey(nowDayKey);
  const targetWeekStart = getWeekStartKey(targetDayKey);
  const weekDiff = Math.round((targetWeekStart - nowWeekStart) / (7 * DAY_MS));

  if (weekDiff === 0) return `本${base}`;
  if (weekDiff === 1) return `下${base}`;
  if (weekDiff === -1) return `上${base}`;
  return base;
};
