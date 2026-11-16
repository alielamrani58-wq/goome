import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';

// Ephemeral test accounts are supplied only through hidden stdin. This script
// never creates accounts, sends email, or logs passwords/access tokens.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write('Ready for test identities on stdin (input hidden).\n');
const input = await new Promise(resolve => {
  let data = '';
  process.stdin.on('data', chunk => { data += chunk.toString(); if (data.includes('\n')) {process.stdin.pause(); resolve(JSON.parse(data.trim()));} });
});
const env = Object.fromEntries((await readFile('.dev.vars','utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const clients=[];
try {
  const accounts={};
  for (const person of input.accounts) {
    const db=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    clients.push(db);
    const {error}=await db.auth.signInWithPassword({email:person.email,password:person.password});
    if(error) throw new Error(`Auth ${person.role}: ${error.message}`);
    accounts[person.role]=db;
  }
  const call=async(db,name,args={})=>{const {data,error}=await db.rpc(name,args);if(error)throw new Error(`${name}: ${error.message}`);return data;};
  for(const role of ['passenger','driver','admin']) await call(accounts[role],'goome_register',{p_name:`Live test ${role}`,p_role:role==='admin'?'passenger':role,p_phone:'+33600000000'});
  await call(accounts.driver,'goome_vehicle',{p_vehicle:'Temporary verification vehicle',p_plate:'TEST-ONLY',p_color:'Noir',p_class:'standard'});
  const driverId=input.accounts.find(a=>a.role==='driver').id;
  await call(accounts.admin,'goome_admin_driver',{p_user:driverId,p_approved:true});
  await call(accounts.driver,'goome_location',{p_lat:48.8566,p_lng:2.3522,p_accuracy:5});
  await call(accounts.driver,'goome_online',{p_online:true});
  const response=await fetch('http://localhost:5173/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pickup:{latitude:48.8566,longitude:2.3522,label:'Hôtel de Ville, Paris'},dropoff:{latitude:48.8449,longitude:2.3735,label:'Gare de Lyon, Paris'},rideClass:'standard'})});
  assert.equal(response.status,200);
  const quote=await response.json(); assert.ok(quote.signature);
  const rideId=await call(accounts.passenger,'goome_request',{p_quote:quote.raw,p_signature:quote.signature});
  let state=await call(accounts.driver,'goome_snapshot'); assert.ok(state.requests.some(r=>r.id===rideId));
  for(const [action,version] of [['accept',0],['arrive',1],['start',2],['complete',3]]) await call(accounts.driver,'goome_trip_action',{p_ride:rideId,p_action:action,p_version:version});
  await call(accounts.driver,'goome_trip_action',{p_ride:rideId,p_action:'confirm_cash',p_version:4});
  await call(accounts.passenger,'goome_rate',{p_ride:rideId,p_rating:5});
  state=await call(accounts.passenger,'goome_snapshot');
  const completed=state.rides.find(r=>r.id===rideId); assert.equal(completed.status,'completed');assert.equal(completed.payment_status,'paid');assert.equal(completed.rating,5);
  const denied=await accounts.passenger.rpc('goome_admin_driver',{p_user:driverId,p_approved:false});assert.ok(denied.error);
  const outsider=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});clients.push(outsider);
  const anonymous=await outsider.rpc('goome_snapshot');assert.ok(anonymous.error);
  console.log('PASS: real Auth login, three roles, signed website quote, driver matching, trip completion, cash confirmation, rating, and API access restrictions.');
} catch(error) {console.error(error.message);process.exitCode=1;}
finally {for(const db of clients){await db.auth.signOut().catch(()=>{}); await db.removeAllChannels();} if(process.stdin.isTTY) process.stdin.setRawMode(false);}
