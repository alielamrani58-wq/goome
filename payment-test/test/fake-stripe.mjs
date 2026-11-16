import {ENVIRONMENT,testObject} from '../src/config.mjs';
export class FakeStripe {
  constructor(){this.sessions=new Map();this.intents=new Map();this.results=new Map();this.calls={};this.failAfter=new Set();this.failBefore=new Set();this.webhookSecret='fixture';this.transfers=new Map();}
  async once(kind,op,fn){if(this.failBefore.delete(kind))throw new Error('NETWORK_TIMEOUT');if(this.results.has(op.id))return structuredClone(this.results.get(op.id));const r=fn();this.calls[kind]=(this.calls[kind]||0)+1;this.results.set(op.id,structuredClone(r));if(this.failAfter.delete(kind))throw new Error('NETWORK_TIMEOUT');return structuredClone(r);}
  customer(u,op){return this.once('customer',op,()=>({id:`cus_${u.id}`,livemode:false}));}
  recipient(u,op){return this.once('recipient',op,()=>({id:`acct_${u.id}`,livemode:false}));}
  async recipientInfo(id){return {id,livemode:false,identity:{country:'fr'},metadata:{environment:ENVIRONMENT,user_id:'driver'},configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'active'}}}}}};}
  async onboard(){return 'https://connect.stripe.com/setup/fixture';}
  checkout(r,u,route,op){return this.once('checkout',op,()=>{const s={id:`cs_test_${r.id}`,livemode:false,status:'open',payment_intent:null,url:`https://checkout.stripe.com/c/pay/cs_test_${r.id}`,client_reference_id:r.id,metadata:{environment:ENVIRONMENT,ride_id:r.id,passenger_id:r.passenger_id}};this.sessions.set(s.id,s);return s;});}
  setup(u,op){return this.once('setup',op,()=>({id:'cs_test_setup',livemode:false,url:'https://checkout.stripe.com/c/pay/cs_test_setup'}));}
  async authorize(r,status='requires_capture'){
    const id=`pi_${r.id}`;const pi={id,livemode:false,status,amount:r.fare,amount_received:0,currency:'eur',customer:`cus_${r.passenger_id}`,capture_method:'manual',metadata:{environment:ENVIRONMENT,ride_id:r.id,passenger_id:r.passenger_id},latest_charge:{id:`ch_${r.id}`,livemode:false,captured:false,amount_captured:0,amount_refunded:0,disputed:false,payment_method_details:{card:{capture_before:Math.floor(Date.now()/1000)+7*86400}}}};
    this.intents.set(id,pi);this.sessions.get(r.stripe_session).payment_intent=id;this.sessions.get(r.stripe_session).status='complete';return pi;
  }
  async session(id){return structuredClone(this.sessions.get(id));}
  async intent(id){return structuredClone(this.intents.get(id));}
  async expire(id){const s=this.sessions.get(id);if(s.status==='open')s.status='expired';return structuredClone(s);}
  capture(r,op){return this.once('capture',op,()=>{const pi=this.intents.get(r.stripe_intent);pi.status='succeeded';pi.amount_received=r.fare;pi.latest_charge.captured=true;pi.latest_charge.amount_captured=r.fare;return pi;});}
  cancel(r,op){return this.once('cancel',op,()=>{const pi=this.intents.get(r.stripe_intent);pi.status='canceled';return pi;});}
  async transferParams(r,u,pi){return {amount:r.driver_amount,currency:'eur',destination:u.stripe_recipient,source_transaction:pi.latest_charge.id};}
  transfer(r,u,pi,op){testObject(pi);return this.once('transfer',op,()=>{const t={id:`tr_${r.id}`,livemode:false,amount:r.driver_amount,reversed:false};this.transfers.set(t.id,t);return t;});}
  reverse(r,op){return this.once('reverse',op,()=>{this.transfers.get(r.stripe_transfer).reversed=true;return {id:`trr_${r.id}`};});}
  refund(r,op){return this.once('refund',op,()=>{const pi=this.intents.get(r.stripe_intent);pi.latest_charge.amount_refunded=r.fare;return {id:`re_${r.id}`,status:'succeeded'};});}
  async refundInfo(id){return {id,status:'succeeded'};}
}
