import {readFile, mkdir, chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ACCOUNT = 'acct_1UYizCE8YbSmnCes';
export const ENVIRONMENT = 'goome-local-payments-test-v1';
export const PORTS = Object.freeze({passenger:4180, driver:4181, admin:4182});
export const ORIGINS = Object.freeze(Object.fromEntries(Object.entries(PORTS).map(([r,p])=>[r,`http://127.0.0.1:${p}`])));
export const WEBHOOK_PORT = 4189;
export const ROUTES = Object.freeze({
  opera: {pickup:'Gare de Lyon, Paris', dropoff:'Opéra Garnier, Paris', fare:2475, minutes:22, km:6.1},
  defense: {pickup:'Châtelet, Paris', dropoff:'La Défense, Puteaux', fare:3850, minutes:34, km:13.8},
  orly: {pickup:'Gare Montparnasse, Paris', dropoff:'Aéroport Paris-Orly', fare:4625, minutes:39, km:17.6}
});
export function testKey(key) {
  if (typeof key !== 'string' || !/^(rk|sk)_test_[A-Za-z0-9]+$/.test(key)) throw new Error('TEST_KEY_REQUIRED');
  return key;
}
export function testObject(object) {
  if (!object || object.livemode !== false) throw new Error('LIVE_OR_UNVERIFIED_OBJECT_REJECTED');
  return object;
}
export function safeUrl(raw, hosts) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.includes(url.hostname)) throw new Error('UNTRUSTED_STRIPE_REDIRECT');
  return url.href;
}
export async function privateDirs() {
  for (const dir of ['.local','.secrets']) { const p=path.join(ROOT,dir); await mkdir(p,{recursive:true,mode:0o700}); await chmod(p,0o700); }
}
export async function credentials() {
  let text='';
  try {text=await readFile(path.join(ROOT,'.secrets/stripe.env'),'utf8');} catch(e) {if(e.code!=='ENOENT')throw e;}
  const values=Object.fromEntries(text.split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim()];}));
  // Read ONLY the named, isolated CLI profile, never a global/live profile.
  if (!values.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY) {
    try {const t=await readFile(path.join(ROOT,'.secrets/stripe-cli.toml'),'utf8'); const section=t.match(/\[goome-payments-test\]([\s\S]*?)(?=\n\[|$)/)?.[1];
      const id=section?.match(/^\s*account_id\s*=\s*"([^"]+)"/m)?.[1];
      if(id && id!==ACCOUNT) throw new Error('WRONG_STRIPE_ACCOUNT');
      values.STRIPE_SECRET_KEY=section?.match(/^\s*test_mode_api_key\s*=\s*"([^"]+)"/m)?.[1];
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const key=process.env.STRIPE_SECRET_KEY||values.STRIPE_SECRET_KEY;
  const webhookSecret=process.env.STRIPE_WEBHOOK_SECRET||values.STRIPE_WEBHOOK_SECRET;
  if(key)testKey(key);
  if(webhookSecret&&!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret))throw new Error('INVALID_WEBHOOK_SECRET');
  return {key,webhookSecret};
}
