import {randomUUID} from 'node:crypto';
import {ENVIRONMENT,ROUTES,testObject,safeUrl} from './config.mjs';
import {audit} from './db.mjs';

const ref=o=>typeof o==='string'?o:o?.id;
export class AppError extends Error {constructor(code,status=409){super(code);this.status=status;}}
const fail=(code,status)=>{throw new AppError(code,status);};
export class Payments {
  constructor(db,stripe) {this.db=db;this.stripe=stripe;this.tail=Promise.resolve();}
  exclusive(fn){const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next;}
  async one(sql,args=[]){return (await this.db.query(sql,args)).rows[0];}
  async user(id){return this.one('SELECT * FROM users WHERE id=$1',[id]);}
  async ride(id){return this.one('SELECT * FROM rides WHERE id=$1',[id]);}
  requireStripe(){if(!this.stripe)fail('STRIPE_NOT_CONFIGURED',503);if(!this.stripe.webhookSecret)fail('WEBHOOK_NOT_CONFIGURED',503);}
  async queue(id,kind,rideId=null,userId=null,payload={}) {
    await this.db.query('INSERT INTO operations(id,kind,ride_id,user_id,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,kind,rideId,userId,JSON.stringify(payload)]);
  }
  async customer(user) {
    if(!user.stripe_customer)await this.queue(`customer:${user.id}`,'customer',null,user.id);
  }
  async request(actor,routeCode) {return this.exclusive(async()=>{
    this.requireStripe();if(actor.role!=='passenger')fail('FORBIDDEN',403);
    const route=Object.hasOwn(ROUTES,routeCode)&&ROUTES[routeCode];if(!route)fail('UNKNOWN_ROUTE',400);
    const existing=await this.one("SELECT * FROM rides WHERE passenger_id=$1 AND status NOT IN ('completed','cancelled')",[actor.id]);
    if(existing)return {rideId:existing.id};
    const id=randomUUID();
    await this.db.transaction(async tx=>{
      await tx.query('INSERT INTO rides(id,passenger_id,route_code,fare,driver_amount) VALUES($1,$2,$3,$4,$5)',[id,actor.id,routeCode,route.fare,Math.floor(route.fare*0.8)]);
      await tx.query("INSERT INTO operations(id,kind,user_id) VALUES($1,'customer',$2) ON CONFLICT DO NOTHING",[`customer:${actor.id}`,actor.id]);
      await tx.query("INSERT INTO operations(id,kind,ride_id) VALUES($1,'checkout',$2)",[`checkout:${id}`,id]);
      await audit(tx,actor.id,'ride_requested',id,{route:routeCode,fare:route.fare});
    });return {rideId:id};
  });}
  async setup(actor,consent){return this.exclusive(async()=>{
    this.requireStripe();if(actor.role!=='passenger')fail('FORBIDDEN',403);if(consent!==true)fail('CONSENT_REQUIRED',400);
    await this.customer(await this.user(actor.id));
    // One durable setup request per user until its hosted session expires.
    const id=`setup:${actor.id}:${Math.floor(Date.now()/86400000)}`;
    await this.queue(id,'setup',null,actor.id);await audit(this.db,actor.id,'test_card_storage_consent',null,{version:'test-v1'});return {operationId:id};
  });}
  async driverSetup(actor){return this.exclusive(async()=>{
    this.requireStripe();if(actor.role!=='driver')fail('FORBIDDEN',403);
    await this.queue(`recipient:${actor.id}`,'recipient',null,actor.id);return {};
  });}
  async onboarding(actor){return this.exclusive(async()=>{
    this.requireStripe();if(actor.role!=='driver')fail('FORBIDDEN',403);
    const u=await this.user(actor.id);if(!u.stripe_recipient)fail('RECIPIENT_NOT_READY');
    return {url:await this.stripe.onboard(u)};
  });}
  async accept(actor,id,version){return this.exclusive(async()=>{
    this.requireStripe();if(actor.role!=='driver')fail('FORBIDDEN',403);
    const u=await this.user(actor.id);if(!u.stripe_recipient)fail('RECIPIENT_NOT_READY');
    const recipient=testObject(await this.stripe.recipientInfo(u.stripe_recipient));
    if(recipient.metadata?.environment!==ENVIRONMENT||recipient.metadata?.user_id!==u.id||recipient.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status!=='active')fail('RECIPIENT_NOT_READY');
    const r=await this.ride(id);if(!r||r.status!=='requested'||r.payment!=='authorized'||r.version!==version)fail('RIDE_CHANGED');
    await this.sync(r);const fresh=await this.ride(id);
    if(fresh.payment!=='authorized'||(fresh.capture_before&&new Date(fresh.capture_before).getTime()<Date.now()+60*60*1000))fail('AUTHORIZATION_EXPIRING');
    if(await this.one("SELECT id FROM rides WHERE driver_id=$1 AND status NOT IN ('completed','cancelled')",[actor.id]))fail('DRIVER_BUSY');
    await this.db.query("UPDATE rides SET driver_id=$1,status='accepted',version=version+1,updated_at=now() WHERE id=$2",[actor.id,id]);await audit(this.db,actor.id,'ride_accepted',id);return {};
  });}
  async progress(actor,id,version,target){return this.exclusive(async()=>{
    this.requireStripe();const r=await this.ride(id);
    if(actor.role!=='driver'||!r||r.driver_id!==actor.id)fail('FORBIDDEN',403);
    if(r.version!==version||({accepted:'arrived',arrived:'in_progress',in_progress:'completed'})[r.status]!==target)fail('RIDE_CHANGED');
    if(r.payment!=='authorized')fail('PAYMENT_NOT_AUTHORIZED');
    await this.sync(r);if((await this.ride(id)).payment!=='authorized')fail('PAYMENT_NOT_AUTHORIZED');
    await this.db.transaction(async tx=>{
      await tx.query("UPDATE rides SET status=$1,desired=$2,version=version+1,updated_at=now() WHERE id=$3",[target,target==='completed'?'capture':'authorize',id]);
      if(target==='completed')await tx.query("INSERT INTO operations(id,kind,ride_id) VALUES($1,'capture',$2) ON CONFLICT DO NOTHING",[`capture:${id}`,id]);
      await audit(tx,actor.id,`ride_${target}`,id);
    });return {};
  });}
  async cancel(actor,id){return this.exclusive(async()=>{
    this.requireStripe();const r=await this.ride(id);if(!r||!(actor.role==='admin'||r.passenger_id===actor.id||r.driver_id===actor.id))fail('FORBIDDEN',403);
    if(r.status==='completed')fail('REFUND_REQUIRED');if(r.status==='cancelled')return {};
    await this.db.transaction(async tx=>{
      await tx.query("UPDATE rides SET status='cancelled',desired='cancel',version=version+1,updated_at=now() WHERE id=$1",[id]);
      await tx.query("INSERT INTO operations(id,kind,ride_id) VALUES($1,'cancel',$2) ON CONFLICT DO NOTHING",[`cancel:${id}`,id]);await audit(tx,actor.id,'ride_cancelled',id);
    });return {};
  });}
  async refund(actor,id){return this.exclusive(async()=>{
    this.requireStripe();if(actor.role!=='admin')fail('FORBIDDEN',403);const r=await this.ride(id);if(!r)fail('NOT_FOUND',404);
    if(r.refunded===r.fare)return {};if(r.captured!==r.fare)fail('PAYMENT_NOT_CAPTURED');
    if(await this.one("SELECT id FROM operations WHERE ride_id=$1 AND kind='transfer' AND attempts>0 AND state<>'done'",[id]))fail('PAYMENT_RECONCILING');
    const customer=(await this.user(r.passenger_id)).stripe_customer;
    await this.db.transaction(async tx=>{
      await tx.query("UPDATE rides SET desired='refund',payment='refund_pending',version=version+1,updated_at=now() WHERE id=$1",[id]);
      await tx.query("INSERT INTO operations(id,kind,ride_id,payload) VALUES($1,'refund',$2,$3) ON CONFLICT DO NOTHING",[`refund:${id}`,id,JSON.stringify({customer})]);
      await audit(tx,actor.id,'refund_requested',id);
    });return {};
  });}
  validateIntent(pi,ride,user) {
    testObject(pi);
    if(pi.id!==ride.stripe_intent||pi.currency!=='eur'||pi.amount!==ride.fare||ref(pi.customer)!==user.stripe_customer||pi.capture_method!=='manual'||pi.metadata?.environment!==ENVIRONMENT||pi.metadata?.ride_id!==ride.id||pi.metadata?.passenger_id!==ride.passenger_id)fail('INTENT_MISMATCH');
  }
  async sync(ride) {
    if(!ride.stripe_intent&&ride.stripe_session) {
      const s=await this.stripe.session(ride.stripe_session);
      if(s.metadata?.ride_id!==ride.id||s.metadata?.environment!==ENVIRONMENT||s.client_reference_id!==ride.id)fail('SESSION_MISMATCH');
      const intent=ref(s.payment_intent);
      if(intent){await this.db.query('UPDATE rides SET stripe_intent=$1 WHERE id=$2',[intent,ride.id]);ride=await this.ride(ride.id);}
      else if(s.status==='expired'){await this.db.query("UPDATE rides SET payment='cancelled',status='cancelled',desired='cancel' WHERE id=$1",[ride.id]);return null;}
    }
    if(!ride.stripe_intent)return null;
    const pi=await this.stripe.intent(ride.stripe_intent);const user=await this.user(ride.passenger_id);this.validateIntent(pi,ride,user);
    const charge=pi.latest_charge&&typeof pi.latest_charge==='object'?testObject(pi.latest_charge):null;
    const refunded=charge?.amount_refunded||0;
    let payment=({requires_capture:'authorized',succeeded:'paid',canceled:'cancelled',requires_payment_method:'card_required',requires_action:'authentication_required',processing:'processing',requires_confirmation:'checkout_pending'})[pi.status]||'review';
    if(refunded===ride.fare)payment='refunded';else if(refunded>0)payment='review';
    if(charge?.disputed)payment='disputed';
    const captured=pi.amount_received||0;
    if(payment==='paid'&&ride.desired==='refund')payment='refund_pending';
    if(captured>ride.fare||refunded>captured)fail('PAYMENT_AMOUNT_MISMATCH');
    const deadline=charge?.payment_method_details?.card?.capture_before;
    await this.db.query("UPDATE rides SET payment=$1,captured=$2,refunded=$3,capture_before=$4,status=CASE WHEN status='awaiting_payment' AND $1='authorized' AND desired='authorize' THEN 'requested' WHEN $1='cancelled' AND status<>'completed' THEN 'cancelled' ELSE status END,updated_at=now() WHERE id=$5",[payment,captured,refunded,deadline?new Date(deadline*1000):null,ride.id]);
    const r=await this.ride(ride.id);
    if(payment==='paid'&&r.status==='completed'&&r.desired==='capture'&&r.driver_id&&!r.stripe_transfer)await this.queue(`transfer:${r.id}`,'transfer',r.id,r.driver_id);
    if(['cancel','refund'].includes(r.desired)&&captured===r.fare&&refunded===0)await this.queue(`refund:${r.id}`,'refund',r.id,null,{customer:user.stripe_customer});
    if((refunded>0||charge?.disputed)&&r.stripe_transfer&&!r.transfer_reversed)await this.queue(`reverse:${r.id}`,'reverse',r.id);
    return pi;
  }
  async done(op,externalId=null) {
    await this.db.query("UPDATE operations SET state='done',external_id=$1,last_error=NULL WHERE id=$2",[externalId,op.id]);
    await audit(this.db,'system',`${op.kind}_confirmed`,op.ride_id,{operation:op.id,external_id:externalId});
  }
  async perform(op) {
    let r=op.ride_id?await this.ride(op.ride_id):null;let u=op.user_id?await this.user(op.user_id):null;
    if(op.kind==='customer') {
      if(u.stripe_customer)return this.done(op,u.stripe_customer);
      const c=testObject(await this.stripe.customer(u,op));await this.db.query('UPDATE users SET stripe_customer=$1 WHERE id=$2',[c.id,u.id]);return this.done(op,c.id);
    }
    if(op.kind==='recipient') {
      if(u.stripe_recipient)return this.done(op,u.stripe_recipient);
      const a=testObject(await this.stripe.recipient(u,op));await this.db.query('UPDATE users SET stripe_recipient=$1,recipient_status=$2 WHERE id=$3',[a.id,'onboarding_required',u.id]);return this.done(op,a.id);
    }
    if(op.kind==='setup') {
      if(!u.stripe_customer)throw new Error('CUSTOMER_PENDING');
      const s=await this.stripe.setup(u,op);await this.db.query('UPDATE operations SET payload=$1 WHERE id=$2',[JSON.stringify({url:safeUrl(s.url,['checkout.stripe.com'])}),op.id]);return this.done(op,s.id);
    }
    if(op.kind==='checkout') {
      // An ambiguous earlier response must be recovered before cancelling its session.
      if(r.desired!=='authorize'&&op.attempts===0)return this.done(op);
      if(r.stripe_session)return this.done(op,r.stripe_session);
      u=await this.user(r.passenger_id);if(!u.stripe_customer)throw new Error('CUSTOMER_PENDING');
      const s=testObject(await this.stripe.checkout(r,u,ROUTES[r.route_code],op));
      await this.db.query('UPDATE rides SET stripe_session=$1,checkout_url=$2 WHERE id=$3',[s.id,safeUrl(s.url,['checkout.stripe.com']),r.id]);return this.done(op,s.id);
    }
    if(op.kind==='cancel') {
      if(r.stripe_session)await this.stripe.expire(r.stripe_session,op);
      const pi=await this.sync(r);r=await this.ride(r.id);
      if(pi&&pi.status==='requires_capture'){await this.stripe.cancel(r,op);await this.sync(r);}
      else if(pi&&pi.status==='succeeded'){await this.queue(`refund:${r.id}`,'refund',r.id,null,{customer:(await this.user(r.passenger_id)).stripe_customer});}
      else if(pi&&!['canceled','requires_payment_method'].includes(pi.status))throw new Error('PAYMENT_STILL_PENDING');
      else if(!pi)await this.db.query("UPDATE rides SET payment='cancelled' WHERE id=$1",[r.id]);
      return this.done(op,r.stripe_intent);
    }
    const pi=await this.sync(r);r=await this.ride(r.id);
    if(op.kind==='capture') {
      if(r.desired!=='capture'||r.status!=='completed')return this.done(op);
      if(pi?.status==='requires_capture') {await this.stripe.capture(r,op);await this.sync(r);}
      else if(pi?.status!=='succeeded')throw new Error('AUTHORIZATION_UNAVAILABLE');
      return this.done(op,r.stripe_intent);
    }
    if(op.kind==='transfer') {
      if(r.stripe_transfer)return this.done(op,r.stripe_transfer);
      const driver=await this.user(r.driver_id);
      if(!op.payload.stripe_params){
        if(r.desired!=='capture'||r.payment!=='paid'||r.status!=='completed'||r.refunded!==0)return this.done(op);
        const params=await this.stripe.transferParams(r,driver,pi);
        op.payload={stripe_params:params};
        await this.db.query('UPDATE operations SET payload=$1 WHERE id=$2',[JSON.stringify(op.payload),op.id]);
      }
      const t=testObject(await this.stripe.transfer(r,driver,pi,op));
      await this.db.query('UPDATE rides SET stripe_transfer=$1 WHERE id=$2',[t.id,r.id]);
      await this.sync(await this.ride(r.id));return this.done(op,t.id);
    }
    if(op.kind==='reverse') {
      if(!r.stripe_transfer||r.transfer_reversed)return this.done(op);
      const reversal=await this.stripe.reverse(r,op);await this.db.query('UPDATE rides SET transfer_reversed=true WHERE id=$1',[r.id]);return this.done(op,reversal.id);
    }
    if(op.kind==='refund') {
      if(r.refunded===r.fare)return this.done(op,r.stripe_refund);
      if(r.captured!==r.fare)throw new Error('PAYMENT_NOT_CAPTURED');
      // Reverse first; failure leaves an explicit pending refund and durable retry.
      if(r.stripe_transfer&&!r.transfer_reversed) {
        await this.queue(`reverse:${r.id}`,'reverse',r.id);throw new Error('REVERSAL_PENDING');
      }
      let result;
      if(r.stripe_refund)result=await this.stripe.refundInfo(r.stripe_refund);
      else {result=await this.stripe.refund(r,op);await this.db.query('UPDATE rides SET stripe_refund=$1 WHERE id=$2',[result.id,r.id]);}
      if(result.status!=='succeeded')throw new Error(result.status==='failed'?'REFUND_FAILED':'REFUND_PENDING');
      await this.sync(r);return this.done(op,result.id);
    }
    throw new Error('UNKNOWN_OPERATION');
  }
  async tick(){if(!this.stripe?.webhookSecret)return;return this.exclusive(async()=>{
    // Signed events are an inbox, not a payment ledger. Always retrieve current Stripe state.
    const events=(await this.db.query('SELECT * FROM webhook_events WHERE processed_at IS NULL LIMIT 30')).rows;
    for(const event of events) {
      try {
        const r=await this.one('SELECT * FROM rides WHERE stripe_intent=$1 OR stripe_session=$1 OR stripe_transfer=$1',[event.object_id]);
        if(r)await this.sync(r);
        await this.db.query('UPDATE webhook_events SET processed_at=now() WHERE id=$1',[event.id]);
      }catch {/* Persist pending and retry; never log raw Stripe payloads. */}
    }
    const ops=(await this.db.query("SELECT * FROM operations WHERE state='queued' AND retry_at<=now() ORDER BY created_at,id LIMIT 30")).rows;
    for(const op of ops) {
      // Stripe only promises idempotency keys for >=24 h. Stop before that window expires.
      if(op.first_attempt_at&&Date.now()-new Date(op.first_attempt_at).getTime()>23*60*60*1000) {
        await this.db.query("UPDATE operations SET state='review',last_error='IDEMPOTENCY_WINDOW_EXPIRED' WHERE id=$1",[op.id]);continue;
      }
      await this.db.query('UPDATE operations SET attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()) WHERE id=$1',[op.id]);
      try{await this.perform(op);}catch(e) {
        const code=/^[A-Z_]{3,70}$/.test(e.message)?e.message:typeof e.code==='string'&&/^[a-z_]{3,70}$/.test(e.code)?e.code:'STRIPE_REQUEST_FAILED';
        const review=/MISMATCH|LIVE_|UNVERIFIED|UNKNOWN_OPERATION|REFUND_FAILED|PARTIAL_REVERSAL/.test(code)||['permission_error','account_invalid','idempotency_key_in_use'].includes(code);
        await this.db.query('UPDATE operations SET state=$1,last_error=$2,retry_at=$3 WHERE id=$4',[review?'review':'queued',code,new Date(Date.now()+Math.min(60000,1000*2**Math.min(op.attempts,6))),op.id]);
      }
    }
    // Reconcile even if the webhook listener is disconnected or an event arrived out of order.
    const rides=(await this.db.query("SELECT * FROM rides WHERE stripe_session IS NOT NULL AND (payment NOT IN ('refunded','cancelled') OR desired IN ('cancel','refund')) ORDER BY updated_at LIMIT 50")).rows;
    for(const r of rides){try{await this.sync(r);}catch {/* Operations and admin reconciliation expose failures without secrets. */}}
    const expired=(await this.db.query("SELECT * FROM rides WHERE status IN ('awaiting_payment','requested') AND expires_at<now() AND desired='authorize'")).rows;
    for(const r of expired){await this.db.query("UPDATE rides SET status='cancelled',desired='cancel' WHERE id=$1",[r.id]);await this.queue(`cancel:${r.id}`,'cancel',r.id);}
  });}
  async receive(event){return this.exclusive(async()=>{
    testObject(event);if(event.account||event.context)fail('UNEXPECTED_CONNECTED_EVENT',400);
    if(!/^evt_[A-Za-z0-9]+$/.test(event.id)||typeof event.data?.object?.id!=='string')fail('INVALID_EVENT',400);
    await this.db.query('INSERT INTO webhook_events(id,type,object_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[event.id,event.type,event.data.object.id]);
  });}
  async snapshot(actor){return this.exclusive(async()=>{
    const user=await this.user(actor.id);
    const select='SELECT id,passenger_id,driver_id,route_code,fare,driver_amount,status,payment,desired,version,captured,refunded,transfer_reversed,stripe_transfer,stripe_refund,created_at FROM rides';
    const rides=(await this.db.query(select+(actor.role==='passenger'?' WHERE passenger_id=$1':actor.role==='driver'?" WHERE driver_id=$1 OR (status='requested' AND payment='authorized')":'')+' ORDER BY created_at DESC LIMIT 100',actor.role==='admin'?[]:[actor.id])).rows;
    const visible=rides.map(r=>({...r,passenger_id:undefined,route:ROUTES[r.route_code],driver_amount:actor.role==='passenger'?undefined:r.driver_amount}));
    if(actor.role==='passenger')for(const r of visible){const raw=await this.ride(r.id);if(raw.status==='awaiting_payment'&&raw.desired==='authorize')r.checkout_url=raw.checkout_url;}
    const operations=(await this.db.query('SELECT id,kind,state,last_error,external_id,payload FROM operations'+(actor.role==='admin'?'':actor.role==='passenger'?" WHERE user_id=$1 OR ride_id IN (SELECT id FROM rides WHERE passenger_id=$1)":" WHERE user_id=$1 OR ride_id IN (SELECT id FROM rides WHERE driver_id=$1)")+' ORDER BY created_at DESC LIMIT 100',actor.role==='admin'?[]:[actor.id])).rows;
    return {user:{name:user.name,role:user.role,email:user.email,recipient:!!user.stripe_recipient},rides:visible,
      operations:operations.map(o=>({...o,payload:undefined,url:o.kind==='setup'&&actor.role==='passenger'?o.payload.url:undefined})),
      audit:actor.role==='admin'?(await this.db.query('SELECT actor,action,ride_id,detail,created_at FROM audit ORDER BY id DESC LIMIT 60')).rows:[],
      stripeReady:!!this.stripe?.webhookSecret,webhookReady:!!this.stripe?.webhookSecret,environment:'test',account:actor.role==='admin'?'acct_1UYizCE8YbSmnCes':undefined,routes:ROUTES};
  });}
}
