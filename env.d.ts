/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHIPXY_API_KEY?: string;
  readonly VITE_LOCAL_API?: string;
  readonly VITE_AUTO_REFRESH_MS?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_AUTH_EMAIL_ALLOWLIST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
