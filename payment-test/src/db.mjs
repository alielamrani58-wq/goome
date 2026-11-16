import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {ROOT,ENVIRONMENT,privateDirs} from './config.mjs';

export function hashPassword(password,salt=randomBytes(16).toString('hex')) {return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function verifyPassword(password,stored) {
  if(typeof password!=='string'||password.length>256)return false;
  const [salt,digest]=stored.split(':'); const actual=scryptSync(password,salt,64);const expected=Buffer.from(digest,'hex');
  return expected.length===actual.length&&timingSafeEqual(actual,expected);
}
export async function openDb(memory=false) {
  if(!memory)await privateDirs();
  const db = new PGlite(memory?'memory://':path.join(ROOT,'.local/postgres'));
  await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  const {rows}=await db.query("SELECT value FROM app_metadata WHERE key='environment'");
  if(rows[0]?.value!==ENVIRONMENT)throw new Error('WRONG_DATABASE_ENVIRONMENT');
  return db;
}
export async function seed(db) {
  const {rows}=await db.query('SELECT id FROM users');
  const file=path.join(ROOT,'.secrets/local-accounts.json');let accounts;
  try{accounts=JSON.parse(await readFile(file,'utf8'));}catch(e){
    if(e.code!=='ENOENT')throw e;if(rows.length)throw new Error('LOCAL_ACCOUNT_CREDENTIALS_MISSING');
    accounts=Object.fromEntries(['passenger','driver','admin'].map(role=>[role,{email:`${role}@goome.test`,password:randomBytes(18).toString('base64url')}]));
    // Write recoverable credentials before the transaction, so a crash cannot strand users.
    await writeFile(file,JSON.stringify(accounts,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  await chmod(file,0o600);
  for(const role of ['passenger','driver','admin'])if(accounts[role]?.email!==`${role}@goome.test`||typeof accounts[role]?.password!=='string'||accounts[role].password.length<24)throw new Error('INVALID_LOCAL_ACCOUNTS');
  if(rows.length)return;
  await db.transaction(async tx=>{for(const role of ['passenger','driver','admin'])await tx.query('INSERT INTO users(id,role,name,email,password_hash) VALUES($1,$2,$3,$4,$5)',[role,role,{passenger:'Camille · test',driver:'Alex · test',admin:'Administration · test'}[role],accounts[role].email,hashPassword(accounts[role].password)]);});
}
export async function audit(db,actor,action,rideId=null,detail={}) {
  await db.query('INSERT INTO audit(actor,action,ride_id,detail) VALUES($1,$2,$3,$4)',[actor,action,rideId,JSON.stringify(detail)]);
}
