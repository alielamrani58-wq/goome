import http from 'node:http';
import {readFile,open,unlink,chmod} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,ACCOUNT,PORTS,ORIGINS,WEBHOOK_PORT,credentials,privateDirs} from './config.mjs';
import {openDb,seed,verifyPassword,audit,hashPassword} from './db.mjs';
import {TestStripe} from './stripe.mjs';
import {Payments,AppError} from './payments.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const PUBLIC=new URL('../public/',import.meta.url);
const allowedAssets=new Map([['/','index.html'],['/app.js','app.js'],['/style.css','style.css'],['/logo.svg','logo.svg']]);
const messages={FORBIDDEN:'Accès refusé.',AUTH_REQUIRED:'Connectez-vous au compte de test.',LOGIN_FAILED:'Identifiants incorrects.',STRIPE_NOT_CONFIGURED:'Stripe de test doit être connecté sur ce Mac.',RECIPIENT_NOT_READY:'Terminez la configuration Stripe du chauffeur de test.',RIDE_CHANGED:'La course a changé. Actualisez la page.',CONSENT_REQUIRED:'Votre accord est nécessaire pour enregistrer une carte de test.',PAYMENT_RECONCILING:'Vérification d’un transfert en cours. Réessayez après sa confirmation.',AUTHORIZATION_EXPIRING:'La réservation du paiement expire trop tôt. Annulez et recommencez.',PAYMENT_NOT_AUTHORIZED:'La réservation du paiement doit être confirmée.',PAYMENT_NOT_CAPTURED:'Le paiement doit être confirmé avant un remboursement.',REFUND_REQUIRED:'Utilisez le remboursement pour une course terminée.',DRIVER_BUSY:'Terminez votre course en cours.',RATE_LIMIT:'Trop de tentatives. Réessayez dans quelques minutes.'};
function security(res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function body(req,max=8192) {
  const parts=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>max)throw new AppError('BODY_TOO_LARGE',413);parts.push(chunk);}
  return Buffer.concat(parts);
}
function fields(body,allowed) {
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!allowed.includes(k)))throw new AppError('INVALID_REQUEST',400);
}
export function buildHandler({db,payments,role,origin,limiter=new Map()}) {
  const dummyHash=hashPassword(randomBytes(24).toString('hex'));
  return async(req,res)=>{
    security(res);
    try {
      if(req.headers.host!==new URL(origin).host)throw new AppError('INVALID_HOST',403);
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&allowedAssets.has(url.pathname)) {
        const file=allowedAssets.get(url.pathname);let content=await readFile(new URL(file,PUBLIC));
        const type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'application/javascript; charset=utf-8';
        if(file==='index.html')content=content.toString().replaceAll('__ROLE__',role).replaceAll('__LABEL__',{passenger:'Passager',driver:'Chauffeur',admin:'Administration'}[role]);
        res.writeHead(200,{'Content-Type':type});res.end(content);return;
      }
      if(!url.pathname.startsWith('/api/'))throw new AppError('NOT_FOUND',404);
      if(req.method!=='GET'&&req.method!=='POST')throw new AppError('METHOD_NOT_ALLOWED',405);
      // Exact Origin and non-simple content type protect even HTTP loopback cookies.
      if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['content-type']!=='application/json'))throw new AppError('CROSS_ORIGIN_REJECTED',403);
      if(req.headers['sec-fetch-site']==='cross-site')throw new AppError('CROSS_ORIGIN_REJECTED',403);
      let data={};if(req.method==='POST'){try{data=JSON.parse((await body(req)).toString());}catch(e){if(e instanceof AppError)throw e;throw new AppError('INVALID_JSON',400);}}
      const cookieName=`goome_test_${role}`;
      if(url.pathname==='/api/login'&&req.method==='POST') {
        fields(data,['email','password']);
        const key=role;const current=limiter.get(key)||{attempts:0,start:Date.now()};
        if(Date.now()-current.start>300000){current.attempts=0;current.start=Date.now();}
        if(current.attempts>=10)throw new AppError('RATE_LIMIT',429);current.attempts++;limiter.set(key,current);
        const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
        const user=await payments.exclusive(()=>payments.one('SELECT * FROM users WHERE email=$1 AND role=$2',[email,role]));
        const ok=verifyPassword(data.password,user?.password_hash||dummyHash);
        if(!user||!ok)throw new AppError('LOGIN_FAILED',401);
        current.attempts=0;const token=randomBytes(32).toString('base64url');
        await payments.exclusive(()=>db.query('INSERT INTO sessions(hash,user_id,role,expires_at) VALUES($1,$2,$3,$4)',[sha(token),user.id,role,new Date(Date.now()+8*3600000)]));
        res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
        json(res,200,{ok:true});return;
      }
      const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
      const session=token&&/^[A-Za-z0-9_-]{43}$/.test(token)?await payments.exclusive(()=>payments.one('SELECT u.id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.role=$2 AND u.role=$2 AND s.expires_at>now()',[sha(token),role])):null;
      if(!session)throw new AppError('AUTH_REQUIRED',401);
      if(req.method==='GET'&&url.pathname==='/api/state'){json(res,200,await payments.snapshot(session));return;}
      if(req.method!=='POST')throw new AppError('NOT_FOUND',404);
      let result;
      if(url.pathname==='/api/logout') {fields(data,[]);await payments.exclusive(()=>db.query('DELETE FROM sessions WHERE hash=$1',[sha(token)]));res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);result={};}
      else if(url.pathname==='/api/request'){fields(data,['route']);result=await payments.request(session,data.route);}
      else if(url.pathname==='/api/setup-card'){fields(data,['consent']);result=await payments.setup(session,data.consent);}
      else if(url.pathname==='/api/driver-setup'){fields(data,[]);result=await payments.driverSetup(session);}
      else if(url.pathname==='/api/onboarding'){fields(data,[]);result=await payments.onboarding(session);}
      else if(url.pathname==='/api/accept'){fields(data,['id','version']);result=await payments.accept(session,data.id,data.version);}
      else if(url.pathname==='/api/progress'){fields(data,['id','version','target']);result=await payments.progress(session,data.id,data.version,data.target);}
      else if(url.pathname==='/api/cancel'){fields(data,['id']);result=await payments.cancel(session,data.id);}
      else if(url.pathname==='/api/refund'){fields(data,['id']);result=await payments.refund(session,data.id);}
      else if(url.pathname==='/api/reconcile'){fields(data,[]);if(session.role!=='admin')throw new AppError('FORBIDDEN',403);payments.requireStripe();await payments.tick();result={};}
      else throw new AppError('NOT_FOUND',404);
      json(res,200,result);
    }catch(e){const code=e instanceof AppError?e.message:'REQUEST_FAILED';json(res,e instanceof AppError?e.status:500,{error:messages[code]||'La demande n’a pas abouti. Vérifiez l’état puis réessayez.',code});}
  };
}
export function webhookHandler(payments,verify) {return async(req,res)=>{
  security(res);
  try {
    if(req.method!=='POST'||req.url!=='/stripe/webhook'||req.headers.host!==`127.0.0.1:${WEBHOOK_PORT}`)throw new AppError('NOT_FOUND',404);
    const raw=await body(req,256*1024);const signature=req.headers['stripe-signature'];
    if(typeof signature!=='string')throw new AppError('SIGNATURE_REQUIRED',400);
    const event=verify(raw,signature);await payments.receive(event);json(res,200,{received:true});
  }catch{json(res,400,{error:'Webhook rejected'});}
};}
export async function main() {
  await privateDirs();
  let lock;
  try {lock=await open(path.join(ROOT,'.local/server.lock'),'wx',0o600);await lock.writeFile(String(process.pid));}
  catch {throw new Error('LOCAL_DATABASE_ALREADY_LOCKED: stop the other test server. Remove .local/server.lock only after confirming it is stopped.');}
  let db;const servers=[];let timer;let stopped=false;
  const cleanup=async()=>{if(stopped)return;stopped=true;clearInterval(timer);await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));await db?.close();await lock.close();await unlink(path.join(ROOT,'.local/server.lock'));};
  try {
    db=await openDb();await seed(db);
    const c=await credentials();let stripe=null;
    if(c.key){stripe=new TestStripe(c.key,c.webhookSecret);await stripe.verify();}
    const payments=new Payments(db,stripe);
    for(const [role,port]of Object.entries(PORTS)) {
      const server=http.createServer(buildHandler({db,payments,role,origin:ORIGINS[role]}));server.requestTimeout=20000;server.headersTimeout=10000;
      await new Promise((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',resolve));servers.push(server);
      console.log(`${role}: ${ORIGINS[role]}`);
    }
    const web=http.createServer(webhookHandler(payments,(raw,sig)=>{if(!stripe)throw new Error('NO_STRIPE');return stripe.event(raw,sig);}));
    web.requestTimeout=20000;web.headersTimeout=10000;
    await new Promise((resolve,reject)=>web.once('error',reject).listen(WEBHOOK_PORT,'127.0.0.1',resolve));servers.push(web);
    let ticking=false;
    timer=setInterval(async()=>{if(ticking)return;ticking=true;try{await payments.tick();}catch{console.error('Test reconciliation paused; check the local admin page.');}finally{ticking=false;}},5000);
    await audit(db,'system','local_test_started',null,{account:ACCOUNT,stripe_connected:!!stripe});
    console.log(stripe?(stripe.webhookSecret?'Stripe TEST connected. Live payments are rejected.':'Stripe TEST verified; configure signed webhooks before payment actions are enabled.'):'Stripe not connected. Payment buttons stay disabled. Run npm run stripe:login.');
    console.log('Local test sign-in details: payment-test/.secrets/local-accounts.json (owner access only)');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await cleanup();process.exit(0);});
    return {db,payments,cleanup,servers};
  }catch(e){await cleanup();throw e;}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))main().catch(e=>{console.error(/^[A-Z_]+/.test(e.message)?e.message.split(':')[0]:'Test server could not start.');process.exitCode=1;});
