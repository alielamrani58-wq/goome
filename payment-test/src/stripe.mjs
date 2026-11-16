import StripeClient from 'stripe';
import {ACCOUNT,ENVIRONMENT,ORIGINS,testKey,testObject,safeUrl} from './config.mjs';

export const API_VERSION='2026-10-28.endive';
const ref=value=>typeof value==='string'?value:value?.id;
export class TestStripe {
  constructor(key,webhookSecret) {
    this.client=new StripeClient(testKey(key),{apiVersion:API_VERSION,maxNetworkRetries:2,timeout:15000,appInfo:{name:'Goöme local test',version:'0.1.0'}});
    this.webhookSecret=webhookSecret;
  }
  async verify() {
    const balance=testObject(await this.client.balance.retrieve());
    const account=await this.client.accounts.retrieve();
    if(account.id!==ACCOUNT)throw new Error('WRONG_STRIPE_ACCOUNT');
    return {account:account.id,test:balance.livemode===false};
  }
  options(id){return {idempotencyKey:`${ENVIRONMENT}:${id}`};}
  metadata(ride){return {environment:ENVIRONMENT,ride_id:ride.id,passenger_id:ride.passenger_id};}
  async customer(user,op) {
    return testObject(await this.client.customers.create({name:user.name,email:user.email,metadata:{environment:ENVIRONMENT,user_id:user.id}},this.options(op.id)));
  }
  async checkout(ride,user,route,op) {
    const session=testObject(await this.client.checkout.sessions.create({
      mode:'payment',ui_mode:'hosted_page',customer:user.stripe_customer,allowed_payment_method_types:['card'],
      integration_identifier:'goome_local_test_payments_vnqpsxrt',
      adaptive_pricing:{enabled:false},
      line_items:[{quantity:1,price_data:{currency:'eur',unit_amount:ride.fare,product_data:{name:`TEST · ${route.pickup} → ${route.dropoff}`}}}],
      payment_intent_data:{capture_method:'manual',metadata:this.metadata(ride),transfer_group:`goome_test_${ride.id}`},
      saved_payment_method_options:{payment_method_save:'enabled',payment_method_remove:'enabled'},
      custom_text:{submit:{message:'TEST UNIQUEMENT. Le montant est réservé puis débité après la course. Aucun argent réel. L’enregistrement de la carte pour de futurs paiements est facultatif.'}},
      client_reference_id:ride.id,metadata:this.metadata(ride),
      expires_at:Math.floor(new Date(ride.expires_at).getTime()/1000),
      success_url:`${ORIGINS.passenger}/?return=checkout&ride=${ride.id}`,
      cancel_url:`${ORIGINS.passenger}/?return=cancel&ride=${ride.id}`
    },this.options(op.id)));
    safeUrl(session.url,['checkout.stripe.com']);return session;
  }
  async setup(user,op) {
    const s=testObject(await this.client.checkout.sessions.create({mode:'setup',ui_mode:'hosted_page',currency:'eur',customer:user.stripe_customer,allowed_payment_method_types:['card'],
      integration_identifier:'goome_local_test_setup_vnqpsxrt',
      setup_intent_data:{metadata:{environment:ENVIRONMENT,user_id:user.id}},
      custom_text:{submit:{message:'TEST : j’autorise Stripe à enregistrer cette carte de test pour mes futures courses Goöme. Aucun paiement réel.'}},
      success_url:`${ORIGINS.passenger}/?return=setup`,cancel_url:`${ORIGINS.passenger}/?return=cancel`,
      metadata:{environment:ENVIRONMENT,user_id:user.id}},this.options(op.id)));
    safeUrl(s.url,['checkout.stripe.com']);return s;
  }
  async session(id){return testObject(await this.client.checkout.sessions.retrieve(id,{expand:['payment_intent']}));}
  async expire(id,op) {
    const session=await this.session(id);
    if(session.status==='open') {
      try{await this.client.checkout.sessions.expire(id,{},this.options(`${op.id}:expire`));}
      catch(e){if(e.code!=='checkout_session_not_open')throw e;}
    }
    return this.session(id);
  }
  async intent(id){return testObject(await this.client.paymentIntents.retrieve(id,{expand:['latest_charge']}));}
  async capture(ride,op) {
    return testObject(await this.client.paymentIntents.capture(ride.stripe_intent,{amount_to_capture:ride.fare},this.options(op.id)));
  }
  async cancel(ride,op) {
    return testObject(await this.client.paymentIntents.cancel(ride.stripe_intent,{cancellation_reason:'requested_by_customer'},this.options(`${op.id}:intent`)));
  }
  async recipient(user,op) {
    return testObject(await this.client.v2.core.accounts.create({display_name:user.name,contact_email:user.email,
      identity:{country:'fr'},dashboard:'express',
      defaults:{responsibilities:{fees_collector:'application',losses_collector:'application'}},
      configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{requested:true}}}}},
      metadata:{environment:ENVIRONMENT,user_id:user.id},include:['configuration.recipient','identity','requirements']},this.options(op.id)));
  }
  async recipientInfo(id) {
    return testObject(await this.client.v2.core.accounts.retrieve(id,{include:['configuration.recipient','identity','requirements']}));
  }
  async onboard(user) {
    const account=await this.recipientInfo(user.stripe_recipient);
    if(account.metadata?.environment!==ENVIRONMENT||account.metadata?.user_id!==user.id||account.identity?.country?.toLowerCase()!=='fr')throw new Error('RECIPIENT_MISMATCH');
    const link=await this.client.v2.core.accountLinks.create({account:account.id,use_case:{type:'account_onboarding',account_onboarding:{refresh_url:`${ORIGINS.driver}/?onboarding=refresh`,return_url:`${ORIGINS.driver}/?onboarding=return`}}});
    return safeUrl(link.url,['connect.stripe.com']);
  }
  async transferParams(ride,user,intent) {
    const account=await this.recipientInfo(user.stripe_recipient);
    if(account.metadata?.environment!==ENVIRONMENT||account.metadata?.user_id!==user.id||account.identity?.country?.toLowerCase()!=='fr')throw new Error('RECIPIENT_MISMATCH');
    if(account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status!=='active')throw new Error('RECIPIENT_NOT_READY');
    const charge=testObject(intent.latest_charge);
    if(!charge.captured||charge.amount_captured!==ride.fare||charge.amount_refunded!==0||charge.disputed)throw new Error('CHARGE_NOT_SETTLED');
    return {amount:ride.driver_amount,currency:'eur',destination:account.id,source_transaction:charge.id,transfer_group:`goome_test_${ride.id}`,metadata:this.metadata(ride)};
  }
  async transfer(ride,user,intent,op) {
    const params=op.payload.stripe_params;
    if(!params||params.destination!==user.stripe_recipient||params.amount!==ride.driver_amount||params.currency!=='eur'||params.metadata?.ride_id!==ride.id||params.metadata?.environment!==ENVIRONMENT)throw new Error('TRANSFER_MISMATCH');
    // Replay exactly the persisted request even if an external refund/dispute occurred
    // after a lost response. The recovered transfer is then reversed by reconciliation.
    return testObject(await this.client.transfers.create(params,this.options(op.id)));
  }
  async reverse(ride,op) {
    const transfer=testObject(await this.client.transfers.retrieve(ride.stripe_transfer));
    if(transfer.metadata?.environment!==ENVIRONMENT||transfer.metadata?.ride_id!==ride.id||transfer.amount!==ride.driver_amount)throw new Error('TRANSFER_MISMATCH');
    if(transfer.amount_reversed===transfer.amount)return {id:transfer.id};
    if(transfer.amount_reversed!==0)throw new Error('PARTIAL_REVERSAL_REQUIRES_REVIEW');
    // TransferReversal has no livemode field: its verified parent binds it to test mode.
    return this.client.transfers.createReversal(transfer.id,{amount:transfer.amount,metadata:{environment:ENVIRONMENT,ride_id:ride.id}},this.options(op.id));
  }
  async refund(ride,op) {
    // Refund has no livemode field: retrieve and validate its test PaymentIntent first.
    const pi=await this.intent(ride.stripe_intent);
    if(ref(pi.customer)!==op.payload.customer||pi.amount!==ride.fare||pi.metadata?.ride_id!==ride.id||pi.metadata?.environment!==ENVIRONMENT)throw new Error('REFUND_MISMATCH');
    return this.client.refunds.create({payment_intent:pi.id,amount:ride.fare,metadata:this.metadata(ride)},this.options(op.id));
  }
  async refundInfo(id){return this.client.refunds.retrieve(id);}
  event(raw,signature) {
    if(!this.webhookSecret)throw new Error('WEBHOOK_NOT_CONFIGURED');
    const event=testObject(this.client.webhooks.constructEvent(raw,signature,this.webhookSecret,300));
    if(event.account||event.context)throw new Error('UNEXPECTED_CONNECTED_EVENT');
    return event;
  }
}
