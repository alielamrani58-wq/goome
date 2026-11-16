import { env } from 'cloudflare:workers';
import { resolvePortal } from './goome-portals';
type GoomeEnv = { SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string; GOOME_QUOTE_SECRET?: string; GOOME_SITE_ROLE?: string; };
export function settings(): GoomeEnv { return env as GoomeEnv; }
export function getPortal() { return resolvePortal(settings().GOOME_SITE_ROLE); }
export async function signQuote(raw: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(raw));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
}
export async function upstream<T = unknown>(url: URL) {
  const response = await fetch(url, {signal: AbortSignal.timeout(12_000), headers: {Accept: 'application/json'}});
  if (!response.ok) throw new Error('Le service de cartographie est momentanément indisponible. Réessayez dans un instant.');
  return response.json() as Promise<T>;
}
