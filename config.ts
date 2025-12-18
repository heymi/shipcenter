// API Key should come from环境变量，避免硬编码泄露
const env = typeof import.meta !== 'undefined' ? (import.meta as any).env ?? {} : {};
const apiKey = (env?.VITE_SHIPXY_API_KEY as string) || '';

// 如果未显式配置，尝试用当前主机 + :4000 作为本地后端默认地址，方便本地开发
const deriveLocalApi = () => {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4000`;
};

const localApi = (env?.VITE_LOCAL_API as string) || deriveLocalApi();

export const API_CONFIG = {
  API_KEY: apiKey,
  LOCAL_API: localApi,
  BASE_URL: 'https://api.shipxy.com/apicall/v3',
  ENDPOINTS: {
    GET_ETA_SHIPS: '/GetETAShips'
  }
};
