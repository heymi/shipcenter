const PORT_COUNTRY_MAP: Record<string, string> = {
  SINGAPORE: '新加坡',
  TOKYO: '日本',
  ROTTERDAM: '荷兰',
  SUEZ: '埃及',
  'BANDAR ABBAS': '伊朗',
  JACKSONVILLE: '美国',
  HONGKONG: '中国香港',
  HONG: '中国香港',
  BUSAN: '韩国',
  OSAKA: '日本',
  SHANGHAI: '中国',
  NINGBO: '中国',
  QINGDAO: '中国',
  TIANJIN: '中国',
  DALIAN: '中国',
};

const normalizePort = (name?: string) => (name || '').trim().toUpperCase().replace(/\s+/g, ' ');

export const formatPortWithCountry = (portName?: string) => {
  if (!portName) return '-';
  const normalized = normalizePort(portName);
  const country = PORT_COUNTRY_MAP[normalized];
  if (!country) return portName;
  return `${portName} · ${country}`;
};
