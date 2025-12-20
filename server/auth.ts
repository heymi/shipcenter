import { createClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';
import './env';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const authClient =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const getAuthClient = () => {
  if (!authClient) {
    throw new Error('Supabase env missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return authClient;
};

const parseAllowlist = (raw: string) =>
  raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const isEmailAllowed = (email: string, allowlist: string[]) => {
  const normalized = email.trim().toLowerCase();
  return allowlist.some((entry) => {
    if (entry.startsWith('*@')) {
      const domain = entry.slice(2);
      return normalized.endsWith(`@${domain}`);
    }
    return normalized === entry;
  });
};

export const getUserFromRequest = async (req: Request) => {
  const header = req.header('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const client = getAuthClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ status: -1, msg: 'unauthorized' });
    }
    const allowlist = parseAllowlist(process.env.AUTH_EMAIL_ALLOWLIST || '');
    if (allowlist.length && user.email && !isEmailAllowed(user.email, allowlist)) {
      return res.status(403).json({ status: -1, msg: 'email not allowed' });
    }
    (req as Request & { userId?: string }).userId = user.id;
    next();
  } catch (err) {
    console.error('Auth check failed', err);
    res.status(500).json({ status: -1, msg: 'auth failed' });
  }
};
