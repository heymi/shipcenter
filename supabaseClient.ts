import { createClient } from '@supabase/supabase-js';

const env = typeof import.meta !== 'undefined' ? (import.meta as any).env ?? {} : {};
const supabaseUrl = (env.VITE_SUPABASE_URL as string) || '';
const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY as string) || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env missing: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
