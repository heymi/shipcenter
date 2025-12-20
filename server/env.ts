import fs from 'fs';
import path from 'path';

const ENV_LOADED_KEY = '__dockdayEnvLoaded';

const loadEnvFile = () => {
  const globalAny = globalThis as Record<string, unknown>;
  if (globalAny[ENV_LOADED_KEY]) return;
  globalAny[ENV_LOADED_KEY] = true;

  const envPath = path.resolve(process.cwd(), '.env.server');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = normalized.indexOf('=');
    if (eqIndex <= 0) return;
    const key = normalized.slice(0, eqIndex).trim();
    let value = normalized.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
};

loadEnvFile();
